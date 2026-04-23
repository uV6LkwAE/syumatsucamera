"""
OGP キャッシュサービスを定義する。
"""
import json
import re
from html import unescape
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag
from django.db import transaction

from cms.models import Article, ArticleOgpInfo, SaveLogStatus
from cms.services.article_save_log_services import ArticleSaveLogService

REQUEST_TIMEOUT_SECONDS = 5
REQUEST_HEADERS = {
    "User-Agent": "syumatsucamera-bot/1.0 (+https://syumatsucamera.com)",
}
AMAZON_HOST_MARKERS = (
    "amazon.",
    "amzn.to",
)
AMAZON_THUMBNAIL_ARRAY_PATTERN = re.compile(
    r"colorImages\s*[:=]\s*\{\s*.*?initial\s*[:=]\s*\[(?P<body>.*?)\]\s*\}",
    re.IGNORECASE | re.DOTALL,
)
AMAZON_THUMBNAIL_URL_PATTERN = re.compile(
    r'"thumb"\s*:\s*"(?P<url>(?:\\.|[^"])*)"',
    re.IGNORECASE | re.DOTALL,
)


class OgpService:
    """
    記事本文リンクの OGP キャッシュを同期する。
    """

    @staticmethod
    def sync_article_ogp_cache(*, article: Article, request_user_id: str, lock_token: str) -> None:
        """
        本文HTMLからリンクを抽出して OGP キャッシュを同期する。
        """
        urls = OgpService.extract_supported_urls(body_html=article.body_html)
        current_urls = set(urls)

        with transaction.atomic():
            article.ogp_infos.exclude(url__in=current_urls).delete()

        for url in urls:
            try:
                payload = OgpService.fetch_ogp(url=url)
                with transaction.atomic():
                    ArticleOgpInfo.objects.update_or_create(
                        article=article,
                        url=url,
                        defaults=payload,
                    )
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    article_id=article.id,
                    lock_token=lock_token,
                    target=url,
                    status=SaveLogStatus.COMPLETED,
                    message="OGP取得が完了しました。",
                )
            except Exception as exc:
                with transaction.atomic():
                    ArticleOgpInfo.objects.update_or_create(
                        article=article,
                        url=url,
                        defaults={
                            "title": None,
                            "summary": None,
                            "thumbnail": None,
                            "price": None,
                            "is_associates": None,
                            "site_name": None,
                        },
                    )
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    article_id=article.id,
                    lock_token=lock_token,
                    target=url,
                    status=SaveLogStatus.FAILED,
                    message=f"OGP取得に失敗しました。 {exc}",
                )

    @staticmethod
    def extract_supported_urls(*, body_html: str) -> list[str]:
        """
        本文HTMLから OGP 取得対象 URL を抽出する。
        """
        soup = BeautifulSoup(body_html, "lxml")
        urls: list[str] = []
        seen: set[str] = set()
        for anchor in soup.find_all("a"):
            href = str(anchor.get("href", "")).strip()
            if href == "":
                continue
            if not href.startswith(("http://", "https://")):
                continue
            if OgpService.contains_embedded_media(anchor=anchor):
                continue
            if href in seen:
                continue
            seen.add(href)
            urls.append(href)
        return urls

    @staticmethod
    def fetch_ogp(*, url: str) -> dict:
        """
        URL から OGP 情報を取得して返す。
        """
        if OgpService.is_amazon_url(url=url):
            return OgpService.fetch_amazon_ogp(url=url)

        return OgpService.fetch_standard_ogp(url=url)

    @staticmethod
    def fetch_standard_ogp(*, url: str) -> dict:
        """
        通常ページの OGP 情報を取得して返す。
        """
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers=REQUEST_HEADERS,
        )
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        soup = BeautifulSoup(response.text, "lxml")

        title = OgpService._find_meta_content(soup=soup, key="og:title")
        if title is None:
            title_tag = soup.find("title")
            if title_tag is not None:
                title = title_tag.get_text(strip=True) or None

        summary = OgpService._find_meta_content(soup=soup, key="og:description")
        if summary is None:
            summary = OgpService._find_meta_name_content(soup=soup, key="description")

        thumbnail = OgpService._find_meta_content(soup=soup, key="og:image")
        site_name = OgpService._find_meta_content(soup=soup, key="og:site_name")

        return {
            "title": title,
            "summary": summary,
            "thumbnail": thumbnail,
            "price": None,
            "is_associates": None,
            "site_name": site_name,
        }

    @staticmethod
    def fetch_amazon_ogp(*, url: str) -> dict:
        """
        Amazon ページの情報を独自に抽出して返す。
        """
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers=REQUEST_HEADERS,
        )
        response.raise_for_status()
        response.encoding = response.apparent_encoding or response.encoding
        soup = BeautifulSoup(response.text, "lxml")

        title = None
        if soup.title is not None:
            title = soup.title.get_text(strip=True) or None

        price_element = soup.select_one("span.a-price-whole")
        price = None
        if price_element is not None:
            price = price_element.get_text(" ", strip=True) or None

        thumbnail = OgpService._extract_amazon_thumbnail(soup=soup)

        return {
            "title": title,
            "summary": None,
            "thumbnail": thumbnail,
            "price": price,
            "is_associates": OgpService.is_associate_url(url=url),
            "site_name": None,
        }

    @staticmethod
    def is_amazon_url(*, url: str) -> bool:
        """
        Amazon 系 URL かどうかを返す。
        """
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        return any(marker in host for marker in AMAZON_HOST_MARKERS)

    @staticmethod
    def is_associate_url(*, url: str) -> bool:
        """
        Amazon アソシエイト URL かどうかを返す。
        """
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        if host.endswith("amzn.to"):
            return True
        if not any(marker in host for marker in AMAZON_HOST_MARKERS if marker != "amzn.to"):
            return False
        return "tag" in parse_qs(parsed.query, keep_blank_values=True)

    @staticmethod
    def contains_embedded_media(*, anchor: Tag) -> bool:
        """
        リンク内に埋め込みメディア要素が含まれるかを返す。
        """
        return anchor.find(["img", "picture", "video", "iframe"]) is not None

    @staticmethod
    def _find_meta_content(*, soup: BeautifulSoup, key: str) -> str | None:
        """
        property 属性の meta content を返す。
        """
        tag = soup.find("meta", attrs={"property": key})
        if tag is None:
            return None
        value = str(tag.get("content", "")).strip()
        return value or None

    @staticmethod
    def _find_meta_name_content(*, soup: BeautifulSoup, key: str) -> str | None:
        """
        name 属性の meta content を返す。
        """
        tag = soup.find("meta", attrs={"name": key})
        if tag is None:
            return None
        value = str(tag.get("content", "")).strip()
        return value or None

    @staticmethod
    def _extract_amazon_thumbnail(*, soup: BeautifulSoup) -> str | None:
        """
        Amazon の ImageBlockATF から thumb URL を抽出する。
        """
        for script in soup.find_all("script"):
            script_text = script.get_text()
            if "ImageBlockATF" not in script_text or "colorImages" not in script_text:
                continue

            array_match = AMAZON_THUMBNAIL_ARRAY_PATTERN.search(script_text)
            if array_match is None:
                continue

            thumb_match = AMAZON_THUMBNAIL_URL_PATTERN.search(array_match.group("body"))
            if thumb_match is None:
                continue

            raw_url = thumb_match.group("url")
            try:
                decoded_url = json.loads(f'"{raw_url}"')
            except json.JSONDecodeError:
                decoded_url = raw_url
            normalized_url = unescape(decoded_url).strip()
            if normalized_url != "":
                return normalized_url
        return None
