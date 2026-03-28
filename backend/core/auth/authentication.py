"""
DRF 向けの認証クラスを定義する。
"""
from rest_framework.authentication import BaseAuthentication


class MiddlewareUserAuthentication(BaseAuthentication):
    """
    Django middleware で解決済みの user を DRF に引き渡す。
    """

    def authenticate(self, request):
        """
        middleware でセットされた user と auth を返す。
        """
        user = getattr(request._request, "user", None)
        if user is None:
            return None

        if not getattr(user, "is_authenticated", False):
            return None

        auth = getattr(request._request, "auth", None)
        return (user, auth)
