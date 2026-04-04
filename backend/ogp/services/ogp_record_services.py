"""
OGPキャッシュ管理サービスを定義する。
"""
import logging
from uuid import UUID

from django.db import transaction
from rest_framework.exceptions import NotFound

from cms.models import ArticleOgpInfo
from cms.services.common import build_pagination_payload
from cms.services.ogp_services import OgpService as ArticleBodyOgpService


logger = logging.getLogger("app")


class OgpRecordService:
    """
    OGPキャッシュの管理操作を担当する。
    """

    @staticmethod
    def list_records(*, page: int, limit: int) -> dict:
        """
        OGPキャッシュ一覧をページングして返す。
        """
        queryset = (
            ArticleOgpInfo.objects.select_related("article")
            .order_by("-updated_at", "-created_at", "url")
        )
        return build_pagination_payload(page=page, limit=limit, queryset=queryset)

    @staticmethod
    def get_record(*, ogp_id: str | UUID) -> ArticleOgpInfo:
        """
        OGPキャッシュ詳細を取得する。
        """
        try:
            return ArticleOgpInfo.objects.select_related("article").get(id=ogp_id)
        except ArticleOgpInfo.DoesNotExist as exc:
            raise NotFound("OGPレコードが存在しません。") from exc

    @staticmethod
    @transaction.atomic
    def update_record(*, ogp_record: ArticleOgpInfo, payload: dict) -> ArticleOgpInfo:
        """
        OGPキャッシュを手動更新する。
        """
        update_fields = []
        for field_name in ("title", "summary", "thumbnail", "site_name"):
            if field_name not in payload:
                continue
            value = payload[field_name]
            if isinstance(value, str):
                value = value.strip()
            setattr(ogp_record, field_name, value if value != "" else None)
            update_fields.append(field_name)

        if update_fields:
            update_fields.append("updated_at")
            ogp_record.save(update_fields=update_fields)

        return OgpRecordService.get_record(ogp_id=ogp_record.id)

    @staticmethod
    @transaction.atomic
    def delete_record(*, ogp_record: ArticleOgpInfo) -> None:
        """
        OGPキャッシュを削除する。
        """
        ogp_record.delete()

    @staticmethod
    def enqueue_refetch(*, ogp_id: str | UUID) -> dict:
        """
        OGP再取得タスクを投入する。
        """
        normalized_ogp_id = str(ogp_id)

        def _enqueue() -> None:
            from ogp.tasks import refetch_ogp_record

            refetch_ogp_record.delay(normalized_ogp_id)

        transaction.on_commit(_enqueue)
        return {
            "job_name": "ogp.refetch_ogp_record",
            "status": "accepted",
        }

    @staticmethod
    @transaction.atomic
    def refetch_record(*, ogp_id: str | UUID) -> ArticleOgpInfo:
        """
        OGPキャッシュを再取得して保存する。
        """
        ogp_record = OgpRecordService.get_record(ogp_id=ogp_id)
        ogp_payload = ArticleBodyOgpService.fetch_ogp(ogp_record.url)
        ogp_record.title = ogp_payload["title"]
        ogp_record.summary = ogp_payload["summary"]
        ogp_record.thumbnail = ogp_payload["thumbnail"]
        ogp_record.site_name = ogp_payload["site_name"]
        ogp_record.save(
            update_fields=[
                "title",
                "summary",
                "thumbnail",
                "site_name",
                "updated_at",
            ]
        )
        return ogp_record

    @staticmethod
    def refetch_all_records() -> dict[str, int]:
        """
        全OGPキャッシュを順に再取得する。
        """
        succeeded = 0
        failed = 0
        for ogp_id in ArticleOgpInfo.objects.order_by("id").values_list("id", flat=True):
            try:
                OgpRecordService.refetch_record(ogp_id=ogp_id)
                succeeded += 1
            except Exception:
                failed += 1
                logger.exception("Failed to refetch OGP record: %s", ogp_id)

        logger.info(
            "OGP full refetch finished. succeeded=%s failed=%s",
            succeeded,
            failed,
        )
        return {
            "succeeded": succeeded,
            "failed": failed,
        }
