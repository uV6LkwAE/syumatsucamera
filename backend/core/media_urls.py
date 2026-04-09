"""
メディアURLのCDN変換を行う。
"""
from urllib.parse import urljoin

from django.conf import settings


def build_cdn_media_url(media_path: str | None) -> str | None:
    """
    保存済みメディアパスをCDN URLへ変換する。
    """
    if media_path is None:
        return None

    normalized_path = media_path.strip()
    if normalized_path == "":
        return None
    if normalized_path.startswith(("http://", "https://")):
        return normalized_path
    return urljoin(settings.CDN_BASE_URL, normalized_path.lstrip("/"))


def build_public_asset_url(*, site_origin: str, asset_path: str) -> str:
    """
    公開アセットの絶対URLを返す。
    """
    normalized_path = asset_path.strip()
    if normalized_path == "":
        raise RuntimeError("公開アセットパスが設定されていません。")
    return urljoin(site_origin.rstrip("/") + "/", normalized_path.lstrip("/"))
