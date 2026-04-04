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
