"""
Cloudflare Access JWT の検証処理を提供する。
"""
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from django.conf import settings
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


def verify_cloudflare_access_token(token: str) -> CloudflareAccessPrincipal:
    """
    Cloudflare Access JWT を検証し principal を返す。
    """
    signing_key = get_cloudflare_access_jwk_client().get_signing_key_from_jwt(token)
    claims = jwt.decode(
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
    return CloudflareAccessPrincipal(
        sub=str(claims["sub"]),
        email=str(claims["email"]),
        claims=claims,
    )
