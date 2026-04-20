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


@shared_task(name="cms.process_article_save_new_image", acks_late=True, reject_on_worker_lost=True)
def process_article_save_new_image(
    article_id: str,
    request_user_id: str,
    lock_token: str,
    new_image: dict,
) -> dict:
    """
    記事画像1件の保存後処理を実行する。
    """
    return ArticlePostprocessService.process_new_image_job(
        article_id=article_id,
        request_user_id=request_user_id,
        lock_token=lock_token,
        new_image=new_image,
    )


@shared_task(name="cms.process_article_save_thumbnail", acks_late=True, reject_on_worker_lost=True)
def process_article_save_thumbnail(
    article_id: str,
    request_user_id: str,
    lock_token: str,
    thumbnail_request: dict,
    thumbnail_asset_id: str | None,
) -> dict:
    """
    記事サムネイル1件の保存後処理を実行する。
    """
    return ArticlePostprocessService.process_thumbnail_job(
        article_id=article_id,
        request_user_id=request_user_id,
        lock_token=lock_token,
        thumbnail_request=thumbnail_request,
        thumbnail_asset_id=thumbnail_asset_id,
    )


@shared_task(name="cms.finalize_article_save_flow")
def finalize_article_save_flow(task_results: list[dict], article_id: str, request_user_id: str, image_diff: dict) -> None:
    """
    分割実行された保存後処理の結果を反映する。
    """
    ArticlePostprocessService.finalize_article_save_flow(
        task_results=task_results,
        article_id=article_id,
        request_user_id=request_user_id,
        image_diff=image_diff,
    )
