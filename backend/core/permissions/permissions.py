
from typing import Any

from rest_framework.permissions import BasePermission


def _is_authenticated(user: Any) -> bool:
    """
    認証済み user かどうかを返す。
    """
    return bool(user and getattr(user, "is_authenticated", False))


def _is_active(user: Any) -> bool:
    """
    有効ユーザーかどうかを返す。
    """
    return bool(getattr(user, "is_active", True))


def _get_role(user: Any) -> str | None:
    """
    user の role を返す。
    """
    role = getattr(user, "role", None)
    if role:
        return str(role)

    if getattr(user, "is_superuser", False):
        return "admin"

    return None


def _is_admin(user: Any) -> bool:
    """
    admin 権限を持つかどうかを返す。
    """
    return _get_role(user) == "admin"


def _is_author(user: Any) -> bool:
    """
    author 権限を持つかどうかを返す。
    """
    return _get_role(user) == "author"


def _is_article_author(user: Any, obj: Any) -> bool:
    """
    対象オブジェクトの author 本人かどうかを返す。
    """
    user_id = getattr(user, "pk", None)
    if user_id is None:
        user_id = getattr(user, "id", None)

    author_id = getattr(obj, "author_id", None)
    if author_id is not None and user_id is not None:
        return str(author_id) == str(user_id)

    author = getattr(obj, "author", None)
    if author is None:
        return False

    author_pk = getattr(author, "pk", None)
    if author_pk is None:
        author_pk = getattr(author, "id", None)

    if author_pk is None or user_id is None:
        return False

    return str(author_pk) == str(user_id)


class AdminOnlyReadWrite(BasePermission):
    """
    admin のみ読み書きを許可する。
    """

    message = "管理者権限が必要です。"

    def has_permission(self, request, view) -> bool:
        """
        request 単位の許可判定を行う。
        """
        if not _is_authenticated(request.user):
            self.message = "認証が必要です。"
            return False

        if not _is_active(request.user):
            self.message = "このユーザーは無効です。"
            return False

        return _is_admin(request.user)


class AuthorAdminReadWrite(BasePermission):
    """
    author と admin の読み書きを許可する。
    """

    message = "author または admin 権限が必要です。"

    def has_permission(self, request, view) -> bool:
        """
        request 単位の許可判定を行う。
        """
        if not _is_authenticated(request.user):
            self.message = "認証が必要です。"
            return False

        if not _is_active(request.user):
            self.message = "このユーザーは無効です。"
            return False

        return _is_admin(request.user) or _is_author(request.user)


class ArticleAuthorAdminReadWrite(BasePermission):
    """
    記事の author と admin のみ読み書きを許可する。
    """

    message = "対象記事の author または admin 権限が必要です。"

    def has_permission(self, request, view) -> bool:
        """
        object 判定前の大枠の許可判定を行う。
        """
        if not _is_authenticated(request.user):
            self.message = "認証が必要です。"
            return False

        if not _is_active(request.user):
            self.message = "このユーザーは無効です。"
            return False

        return _is_admin(request.user) or _is_author(request.user)

    def has_object_permission(self, request, view, obj) -> bool:
        """
        object 単位の許可判定を行う。
        """
        if _is_admin(request.user):
            return True

        return _is_article_author(request.user, obj)


class SelfActivationPermission(BasePermission):
    """
    本登録対象ユーザー本人のみを許可する。
    """

    message = "本登録対象のユーザー本人のみ操作できます。"

    def has_permission(self, request, view) -> bool:
        """
        principal の email と仮登録ユーザーを照合して判定する。
        """
        principal = getattr(request, "cloudflare_access_principal", None)
        if principal is None:
            principal = getattr(request._request, "cloudflare_access_principal", None)

        if principal is None:
            self.message = "Cloudflare Access の認証情報がありません。"
            return False

        user_id = view.kwargs.get("user_id")
        if user_id is None:
            self.message = "本登録対象ユーザーIDが不正です。"
            return False

        from users.models import User

        normalized_email = User.objects.normalize_required_email(principal.email)
        is_target = User.objects.filter(
            id=user_id,
            is_active=False,
            email=normalized_email,
        ).exists()
        if not is_target:
            self.message = "本登録対象ユーザーが存在しません。"
            return False

        return True
