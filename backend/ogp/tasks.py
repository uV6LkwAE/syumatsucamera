"""
ogp アプリの Celery タスクを定義する。
"""
import logging

from celery import shared_task
from rest_framework.exceptions import NotFound

from ogp.services.ogp_record_services import OgpRecordService


logger = logging.getLogger("app")


@shared_task(name="ogp.refetch_ogp_record")
def refetch_ogp_record(ogp_id: str) -> None:
    """
    OGPキャッシュを1件再取得する。
    """
    try:
        OgpRecordService.refetch_record(ogp_id=ogp_id)
    except NotFound:
        logger.warning("OGP record does not exist. ogp_id=%s", ogp_id)
    except Exception:
        logger.exception("Failed to refetch OGP record. ogp_id=%s", ogp_id)
        raise
