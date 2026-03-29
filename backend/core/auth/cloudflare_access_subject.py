"""
Cloudflare Access の sub を安全に扱う処理を定義する。
"""
import hmac
from hashlib import sha256

from django.conf import settings


def hash_cloudflare_access_sub(sub: str) -> str:
    """
    Cloudflare Access の sub をHMAC-SHA256でハッシュ化して返す。
    """
    normalized_sub = sub.strip()
    if normalized_sub == "":
        raise ValueError("sub は必須です。")

    digest = hmac.new(
        key=settings.CLOUDFLARE_ACCESS_SUB_HASH_SECRET.encode("utf-8"),
        msg=normalized_sub.encode("utf-8"),
        digestmod=sha256,
    )
    return digest.hexdigest()
