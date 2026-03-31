"""
cms アプリの Celery タスクを定義する。
"""
from celery import shared_task

from cms.services.postprocess_services import ArticlePostprocessService


@shared_task(name="cms.process_article_save_flow")
def process_article_save_flow(article_id: str, request_user_id: str, image_diff: dict) -> None:
    """
    記事保存後処理タスクを起動する。
    """
    ArticlePostprocessService.process_article_save_flow(
        article_id=article_id,
        request_user_id=request_user_id,
        image_diff=image_diff,
    )
