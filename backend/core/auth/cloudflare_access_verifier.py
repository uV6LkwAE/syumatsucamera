"""
Cloudflare Access JWT の検証処理を提供する。
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

import jwt
from django.conf import settings
from django.utils import timezone
from jwt import PyJWKClient


@dataclass(slots=True)
class CloudflareAccessPrincipal:
    """
    検証済みの Cloudflare Access principal を表す。
    """

    sub: str
    email: str
    claims: dict[str, Any]

    @property
    def is_authenticated(self) -> bool:
        """
        検証済み principal として認証済みを返す。
        """
        return True

    @property
    def is_anonymous(self) -> bool:
        """
        principal は匿名ではない。
        """
        return False


@lru_cache(maxsize=1)
def get_cloudflare_access_jwk_client() -> PyJWKClient:
    """
    Cloudflare Access の JWK client を返す。
    """
    return PyJWKClient(settings.CLOUDFLARE_ACCESS_CERTS_URL)


def _decode_production_cloudflare_access_token(token: str) -> dict[str, Any]:
    """
    本番の Cloudflare Access JWT を検証して claims を返す。
    """
    signing_key = get_cloudflare_access_jwk_client().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.CLOUDFLARE_ACCESS_AUD,
        issuer=settings.CLOUDFLARE_ACCESS_ISSUER,
        options={
            "require": [
                "aud",
                "email",
                "exp",
                "iat",
                "iss",
                "nbf",
                "sub",
            ]
        },
    )


def _decode_development_cloudflare_access_token(token: str) -> dict[str, Any]:
    """
    開発用の JWT を検証して claims を返す。
    """
    return jwt.decode(
        token,
        settings.DEV_ACCESS_JWT_SECRET,
        algorithms=["HS256"],
        audience=settings.CLOUDFLARE_ACCESS_AUD,
        issuer=settings.CLOUDFLARE_ACCESS_ISSUER,
        options={
            "require": [
                "aud",
                "email",
                "exp",
                "iat",
                "iss",
                "nbf",
                "sub",
            ]
        },
    )


def issue_development_access_token(*, sub: str, email: str) -> tuple[str, datetime]:
    """
    開発環境向けの Access JWT を発行する。
    """
    now = timezone.now()
    expires_at = now + timedelta(seconds=settings.DEV_ACCESS_JWT_EXPIRES_IN_SECONDS)
    claims = {
        "aud": settings.CLOUDFLARE_ACCESS_AUD,
        "email": email,
        "exp": int(expires_at.timestamp()),
        "iat": int(now.timestamp()),
        "iss": settings.CLOUDFLARE_ACCESS_ISSUER,
        "nbf": int(now.timestamp()),
        "sub": sub,
    }
    token = jwt.encode(
        claims,
        settings.DEV_ACCESS_JWT_SECRET,
        algorithm="HS256",
    )
    return token, expires_at


def verify_cloudflare_access_token(token: str) -> CloudflareAccessPrincipal:
    """
    Cloudflare Access JWT を検証し principal を返す。
    """
    if settings.DEBUG:
        claims = _decode_development_cloudflare_access_token(token)
    else:
        claims = _decode_production_cloudflare_access_token(token)

    return CloudflareAccessPrincipal(
        sub=str(claims["sub"]),
        email=str(claims["email"]),
        claims=claims,
    )
