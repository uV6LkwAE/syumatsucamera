"""
Cloudflare Access ヘッダーを検証して request.user を解決する。
"""
from django.conf import settings
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin
from jwt import InvalidTokenError

from core.auth.cloudflare_access_verifier import (
    CloudflareAccessPrincipal,
    verify_cloudflare_access_token,
)
from users.models import User


def _is_protected_path(path: str) -> bool:
    """
    Access 保護対象パスかどうかを返す。
    """
    for prefix in settings.CLOUDFLARE_ACCESS_PROTECTED_PATH_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def resolve_cloudflare_access_user(
    principal: CloudflareAccessPrincipal,
) -> object | None:
    """
    principal.sub に一致する user レコードを返す。
    """
    try:
        return User.objects.get(cf_access_sub=principal.sub)
    except User.DoesNotExist:
        return None


class CloudflareAccessMiddleware(MiddlewareMixin):
    """
    Access 保護対象 API の JWT を検証し sub 一致で request.user を解決する。
    """

    def process_request(self, request):
        """
        保護対象リクエストの principal と user を解決する。
        """
        if request.method == "OPTIONS":
            return None

        if not _is_protected_path(request.path):
            return None

        token = request.headers.get(settings.CLOUDFLARE_ACCESS_JWT_HEADER)
        if token is None:
            return JsonResponse(
                {
                    "detail": "Cloudflare Access の認証情報がありません。",
                    "code": "AUTH_REQUIRED",
                },
                status=401,
            )

        try:
            principal = verify_cloudflare_access_token(token)
        except InvalidTokenError:
            return JsonResponse(
                {
                    "detail": "Cloudflare Access の認証に失敗しました。",
                    "code": "AUTH_TOKEN_INVALID",
                },
                status=401,
            )
        except Exception:
            return JsonResponse(
                {
                    "detail": "Cloudflare Access の検証中にエラーが発生しました。",
                    "code": "INTERNAL_ERROR",
                },
                status=500,
            )

        request.cloudflare_access_principal = principal
        request.cloudflare_access_claims = principal.claims
        request.auth = principal.claims

        resolved_user = resolve_cloudflare_access_user(principal)

        if request.path.startswith("/api/users/activate/"):
            request.cloudflare_access_user = None
            return None

        request.cloudflare_access_user = resolved_user

        if resolved_user is None:
            return JsonResponse(
                {
                    "detail": "対応するユーザーが存在しません。",
                    "code": "AUTH_USER_NOT_FOUND",
                },
                status=401,
            )

        request.user = resolved_user
        return None
