"""
記事保存ログサービスを定義する。
"""
import uuid

from django.utils import timezone

from cms.models import ArticleSaveLog, SaveLogStatus
from cms.services.common import build_pagination_payload
from users.models import User, UserRole


class ArticleSaveLogService:
    """
    記事保存ログの業務ロジックを扱う。
    """

    @staticmethod
    def create_log(
        *,
        request_user_id,
        lock_token: str,
        status: str,
        target: str | None = None,
        message: str | None = None,
    ) -> ArticleSaveLog:
        """
        保存ログを記録する。
        """
        return ArticleSaveLog.objects.create(
            request_user_id=request_user_id,
            lock_token=uuid.UUID(str(lock_token)),
            target=target,
            status=status,
            message=message,
        )

    @staticmethod
    def list_logs(
        *,
        user: User,
        page: int,
        limit: int,
        request_user_id=None,
        occurred_at_from=None,
        occurred_at_to=None,
        lock_token=None,
        target=None,
        status=None,
    ) -> dict:
        """
        条件に一致する保存ログ一覧を返す。
        """
        queryset = ArticleSaveLog.objects.select_related("request_user").all()

        if user.role != UserRole.ADMIN:
            queryset = queryset.filter(request_user=user)
        elif request_user_id is not None:
            queryset = queryset.filter(request_user_id=request_user_id)

        if occurred_at_from is not None:
            queryset = queryset.filter(occurred_at__gte=occurred_at_from)
        if occurred_at_to is not None:
            queryset = queryset.filter(occurred_at__lte=occurred_at_to)
        if lock_token is not None:
            queryset = queryset.filter(lock_token=lock_token)
        if target:
            queryset = queryset.filter(target=target)
        if status in SaveLogStatus.values:
            queryset = queryset.filter(status=status)

        return build_pagination_payload(page=page, limit=limit, queryset=queryset.order_by("-occurred_at"))
