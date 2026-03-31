"""
記事保存後処理サービスを定義する。
"""
from django.db import transaction
from django.utils import timezone

from cms.models import (
    Article,
    ImageJobStatus,
    SaveLogStatus,
)
from cms.services.article_save_log_services import ArticleSaveLogService
from cms.services.article_session_services import ArticleSessionService
from cms.services.media_services import MediaService
from cms.services.ogp_services import OgpService
from users.models import User


class ArticlePostprocessService:
    """
    記事保存後の画像処理と目次生成を扱う。
    """

    @staticmethod
    def process_article_save_flow(*, article_id: str, request_user_id: str, image_diff: dict) -> None:
        """
        記事保存後処理を実行する。
        """
        article = Article.objects.select_related("thumbnail_asset").get(id=article_id)
        lock_token = str(image_diff["lock_token"])
        overall_failed = False

        article.image_job_status = ImageJobStatus.PROCESSING
        article.save(update_fields=["image_job_status", "updated_at"])

        try:
            ArticlePostprocessService._delete_requested_assets(
                article=article,
                request_user_id=request_user_id,
                lock_token=lock_token,
                delete_image_ids=image_diff["delete_images"],
            )
            ArticlePostprocessService._process_new_images(
                article=article,
                request_user_id=request_user_id,
                lock_token=lock_token,
                new_images=image_diff["new_images"],
            )
            ArticlePostprocessService._process_thumbnail(
                article=article,
                request_user_id=request_user_id,
                lock_token=lock_token,
                thumbnail_request=image_diff["thumbnail_request"],
            )
            OgpService.sync_article_ogp_cache(
                article=article,
                request_user_id=request_user_id,
                lock_token=lock_token,
            )
            article.toc_json = MediaService.build_toc(body_html=article.body_html)
            article.image_job_status = ImageJobStatus.COMPLETED
            if article.status == "publish" and article.published_at is None:
                article.published_at = timezone.now()
            article.save(update_fields=["toc_json", "image_job_status", "published_at", "updated_at"])
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                lock_token=lock_token,
                target="article",
                status=SaveLogStatus.COMPLETED,
                message="記事保存後処理が完了しました。",
            )
        except Exception as exc:
            overall_failed = True
            article.image_job_status = ImageJobStatus.FAILED
            article.save(update_fields=["image_job_status", "updated_at"])
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                lock_token=lock_token,
                target="article",
                status=SaveLogStatus.FAILED,
                message=str(exc),
            )
            raise
        finally:
            MediaService.cleanup_temp_dir(lock_token=lock_token)
            try:
                user = User.objects.get(id=request_user_id)
                ArticleSessionService.release_session(user=user, lock_token=lock_token)
            except Exception:
                if not overall_failed:
                    ArticleSaveLogService.create_log(
                        request_user_id=request_user_id,
                        lock_token=lock_token,
                        target="lock",
                        status=SaveLogStatus.FAILED,
                        message="編集ロックの解放に失敗しました。",
                    )

    @staticmethod
    @transaction.atomic
    def _delete_requested_assets(*, article: Article, request_user_id: str, lock_token: str, delete_image_ids: list) -> None:
        """
        削除対象画像を削除する。
        """
        if not delete_image_ids:
            return
        queryset = article.media_assets.filter(id__in=delete_image_ids)
        if article.thumbnail_asset_id is not None:
            queryset = queryset.exclude(id=article.thumbnail_asset_id)
        for asset in queryset:
            MediaService.delete_media_asset_files(asset=asset)
            target = asset.file_name
            asset.delete()
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                lock_token=lock_token,
                target=target,
                status=SaveLogStatus.COMPLETED,
                message="既存画像を削除しました。",
            )

    @staticmethod
    def _process_new_images(*, article: Article, request_user_id: str, lock_token: str, new_images: list) -> None:
        """
        新規画像を最終保存先へ確定する。
        """
        for new_image in new_images:
            stored_file_name = new_image["file_name"]
            try:
                MediaService.process_uploaded_asset(
                    article=article,
                    source_file_name=new_image["file_name"],
                    stored_file_name=stored_file_name,
                    processing_options=new_image["options"],
                    lock_token=lock_token,
                )
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    lock_token=lock_token,
                    target=stored_file_name,
                    status=SaveLogStatus.COMPLETED,
                    message="画像処理が完了しました。",
                )
            except Exception as exc:
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    lock_token=lock_token,
                    target=stored_file_name,
                    status=SaveLogStatus.FAILED,
                    message=str(exc),
                )
                raise

    @staticmethod
    def _process_thumbnail(*, article: Article, request_user_id: str, lock_token: str, thumbnail_request: dict) -> None:
        """
        サムネイルを確定する。
        """
        if article.thumbnail_asset is None:
            return

        mode = thumbnail_request["mode"]
        asset = article.thumbnail_asset
        if mode == "use_uploaded":
            source_file_name = thumbnail_request.get("file_name")
            if not source_file_name:
                raise ValueError("サムネイル画像ファイル名が不足しています。")
            MediaService.process_uploaded_asset(
                article=article,
                source_file_name=source_file_name,
                stored_file_name=asset.file_name,
                processing_options={"thumbnail_request": thumbnail_request},
                lock_token=lock_token,
                asset=asset,
            )
        elif mode == "generate_from_title":
            MediaService.generate_thumbnail_image(
                asset=asset,
                title_text=thumbnail_request.get("title_text") or article.title,
            )
        else:
            MediaService.generate_thumbnail_image(
                asset=asset,
                title_text="週末カメラ",
            )

        ArticleSaveLogService.create_log(
            request_user_id=request_user_id,
            lock_token=lock_token,
            target=asset.file_name,
            status=SaveLogStatus.COMPLETED,
            message="サムネイル処理が完了しました。",
        )
