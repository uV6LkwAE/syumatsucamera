"""
公開申請サービスを定義する。
"""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from cms.models import (
    Article,
    ArticlePublishRequest,
    ArticleStatus,
    ImageJobStatus,
    PublishRequestStatus,
)
from cms.services.common import build_pagination_payload
from users.models import User, UserRole


class PublishRequestService:
    """
    公開申請フローの業務ロジックを扱う。
    """

    @staticmethod
    def list_requests(*, page: int, limit: int, status: str | None) -> dict:
        """
        公開申請一覧を返す。
        """
        queryset = ArticlePublishRequest.objects.select_related(
            "article",
            "article__author",
            "article__category",
            "requested_by",
            "handled_by",
        ).order_by("-requested_at")
        if status is not None:
            queryset = queryset.filter(status=status)
        return build_pagination_payload(page=page, limit=limit, queryset=queryset)

    @staticmethod
    @transaction.atomic
    def create_request(*, article: Article, user: User, note: str | None) -> ArticlePublishRequest:
        """
        公開申請を作成する。
        """
        if user.role == UserRole.ADMIN:
            raise ValidationError("管理者は公開申請ではなく公開状態を直接変更してください。")
        if article.status == ArticleStatus.PUBLISH and article.published_at is not None:
            raise ValidationError("すでに公開済みの記事には公開申請できません。")
        if article.publish_requests.filter(status=PublishRequestStatus.PENDING).exists():
            raise ValidationError("未処理の公開申請がすでに存在します。")

        return ArticlePublishRequest.objects.create(
            article=article,
            requested_by=user,
            note=note,
        )

    @staticmethod
    @transaction.atomic
    def approve_request(*, publish_request_id, user: User) -> ArticlePublishRequest:
        """
        公開申請を承認して記事を公開する。
        """
        publish_request = PublishRequestService._get_pending_request(publish_request_id=publish_request_id)
        article = publish_request.article
        if article.image_job_status != ImageJobStatus.COMPLETED:
            raise ValidationError("画像処理が完了していない記事は公開できません。")

        article.status = ArticleStatus.PUBLISH
        if article.published_at is None:
            article.published_at = timezone.now()
        article.save(update_fields=["status", "published_at"])

        publish_request.status = PublishRequestStatus.APPROVED
        publish_request.handled_by = user
        publish_request.handled_at = timezone.now()
        publish_request.save(update_fields=["status", "handled_by", "handled_at"])
        return publish_request

    @staticmethod
    @transaction.atomic
    def reject_request(*, publish_request_id, user: User, note: str | None) -> ArticlePublishRequest:
        """
        公開申請を却下する。
        """
        publish_request = PublishRequestService._get_pending_request(publish_request_id=publish_request_id)
        publish_request.status = PublishRequestStatus.REJECTED
        publish_request.handled_by = user
        publish_request.handled_at = timezone.now()
        publish_request.note = note
        publish_request.save(update_fields=["status", "handled_by", "handled_at", "note"])
        return publish_request

    @staticmethod
    def _get_pending_request(*, publish_request_id) -> ArticlePublishRequest:
        """
        未処理の公開申請を取得する。
        """
        try:
            publish_request = ArticlePublishRequest.objects.select_related(
                "article",
                "requested_by",
                "handled_by",
            ).get(id=publish_request_id)
        except ArticlePublishRequest.DoesNotExist as exc:
            raise NotFound("公開申請が存在しません。") from exc

        if publish_request.status != PublishRequestStatus.PENDING:
            raise ValidationError("この公開申請はすでに処理済みです。")
        return publish_request
