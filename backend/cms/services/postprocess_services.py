"""
記事保存後処理サービスを定義する。
"""
from django.db import transaction
from django.utils import timezone

from cms.models import (
    Article,
    ImageJobStatus,
    MediaAsset,
    SaveLogStatus,
)
from cms.services.article_pending_snapshot_services import ArticlePendingSnapshotService
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
        article = Article.objects.select_related("thumbnail_asset", "author").get(id=article_id)
        lock_token = str(image_diff["lock_token"])
        staged_live_update = bool(image_diff.get("staged_live_update"))
        pending_snapshot = None
        if staged_live_update:
            pending_snapshot = ArticlePendingSnapshotService.get_snapshot(article_id=str(article.id))
            if pending_snapshot is None:
                raise RuntimeError("公開切替待ちスナップショットが存在しません。")

        overall_failed = False
        created_asset_ids: list[str] = []
        public_paths_by_source_file_name: dict[str, str] = {}
        thumbnail_asset_id = image_diff.get("thumbnail_asset_id")

        if not staged_live_update:
            article.image_job_status = ImageJobStatus.PROCESSING
            article.save(update_fields=["image_job_status", "updated_at"])

        try:
            created_asset_ids, public_paths_by_source_file_name = ArticlePostprocessService._process_new_images(
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
                thumbnail_asset_id=thumbnail_asset_id,
            )

            if staged_live_update:
                ArticlePostprocessService._apply_staged_live_update(
                    article=article,
                    request_user_id=request_user_id,
                    lock_token=lock_token,
                    pending_snapshot=pending_snapshot,
                    delete_image_ids=image_diff["delete_images"],
                    thumbnail_asset_id=thumbnail_asset_id,
                    old_thumbnail_asset_id=image_diff.get("old_thumbnail_asset_id"),
                    public_paths_by_source_file_name=public_paths_by_source_file_name,
                )
                ArticlePendingSnapshotService.delete_snapshot(article_id=str(article.id))
            else:
                ArticlePostprocessService._apply_direct_update(
                    article=article,
                    request_user_id=request_user_id,
                    lock_token=lock_token,
                    delete_image_ids=image_diff["delete_images"],
                    thumbnail_asset_id=thumbnail_asset_id,
                    old_thumbnail_asset_id=image_diff.get("old_thumbnail_asset_id"),
                    public_paths_by_source_file_name=public_paths_by_source_file_name,
                )

            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                article_id=article.id,
                lock_token=lock_token,
                target="article",
                status=SaveLogStatus.COMPLETED,
                message="記事保存後処理が完了しました。",
            )
        except Exception as exc:
            overall_failed = True
            if staged_live_update:
                ArticlePendingSnapshotService.delete_snapshot(article_id=str(article.id))
                ArticlePostprocessService._cleanup_failed_assets(
                    article=article,
                    created_asset_ids=created_asset_ids,
                    thumbnail_asset_id=thumbnail_asset_id,
                )
            else:
                article.image_job_status = ImageJobStatus.FAILED
                article.save(update_fields=["image_job_status", "updated_at"])
                ArticlePostprocessService._cleanup_failed_assets(
                    article=article,
                    created_asset_ids=created_asset_ids,
                    thumbnail_asset_id=thumbnail_asset_id,
                )
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                article_id=article.id,
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
                        article_id=article.id,
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
                article_id=article.id,
                lock_token=lock_token,
                target=target,
                status=SaveLogStatus.COMPLETED,
                message="既存画像を削除しました。",
            )

    @staticmethod
    def _process_new_images(
        *,
        article: Article,
        request_user_id: str,
        lock_token: str,
        new_images: list,
    ) -> tuple[list[str], dict[str, str]]:
        """
        新規画像を最終保存先へ確定する。
        """
        created_asset_ids: list[str] = []
        public_paths_by_source_file_name: dict[str, str] = {}

        for new_image in new_images:
            stored_file_name = new_image["file_name"]
            processing_options = new_image["options"]
            exif_watermark_enabled = bool(processing_options.get("exif_watermark"))
            site_logo_watermark_enabled = bool(processing_options.get("site_logo_watermark"))
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                article_id=article.id,
                lock_token=lock_token,
                target=stored_file_name,
                status=SaveLogStatus.STARTED,
                message=(
                    "画像処理を開始しました。 "
                    f"EXIF透かし={exif_watermark_enabled} "
                    f"サイトロゴ透かし={site_logo_watermark_enabled}"
                ),
            )
            try:
                asset = MediaService.process_uploaded_asset(
                    article=article,
                    source_file_name=new_image["file_name"],
                    stored_file_name=stored_file_name,
                    processing_options=processing_options,
                    lock_token=lock_token,
                    original_file_path=new_image.get("original_file_path"),
                )
                created_asset_ids.append(str(asset.id))
                public_paths_by_source_file_name[new_image["file_name"]] = MediaService.build_public_media_path(
                    file_name=stored_file_name
                )
                if exif_watermark_enabled:
                    visible_exif_lines = MediaService.build_visible_exif_lines(
                        exif_json=asset.exif_json,
                    )
                    if asset.exif_json is None:
                        ArticleSaveLogService.create_log(
                            request_user_id=request_user_id,
                            article_id=article.id,
                            lock_token=lock_token,
                            target=stored_file_name,
                            status=SaveLogStatus.FAILED,
                            message="原本からEXIFを取得できませんでした。EXIF透かしはスキップしました。",
                        )
                    elif not visible_exif_lines:
                        ArticleSaveLogService.create_log(
                            request_user_id=request_user_id,
                            article_id=article.id,
                            lock_token=lock_token,
                            target=stored_file_name,
                            status=SaveLogStatus.COMPLETED,
                            message="原本からEXIFを取得しましたが、表示可能な項目がありませんでした。EXIF透かしはスキップしました。",
                        )
                    else:
                        ArticleSaveLogService.create_log(
                            request_user_id=request_user_id,
                            article_id=article.id,
                            lock_token=lock_token,
                            target=stored_file_name,
                            status=SaveLogStatus.COMPLETED,
                            message=(
                                "EXIF透かしを描画しました。 "
                                f"表示項目数={len(visible_exif_lines)}"
                            ),
                        )
                if site_logo_watermark_enabled:
                    ArticleSaveLogService.create_log(
                        request_user_id=request_user_id,
                        article_id=article.id,
                        lock_token=lock_token,
                        target=stored_file_name,
                        status=SaveLogStatus.COMPLETED,
                        message="サイトロゴ透かしを描画しました。",
                    )
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    article_id=article.id,
                    lock_token=lock_token,
                    target=stored_file_name,
                    status=SaveLogStatus.COMPLETED,
                    message="画像処理が完了しました。",
                )
            except Exception as exc:
                ArticleSaveLogService.create_log(
                    request_user_id=request_user_id,
                    article_id=article.id,
                    lock_token=lock_token,
                    target=stored_file_name,
                    status=SaveLogStatus.FAILED,
                    message=str(exc),
                )
                raise

        return created_asset_ids, public_paths_by_source_file_name

    @staticmethod
    def _process_thumbnail(
        *,
        article: Article,
        request_user_id: str,
        lock_token: str,
        thumbnail_request: dict,
        thumbnail_asset_id: str | None,
    ) -> None:
        """
        サムネイルを確定する。
        """
        if thumbnail_asset_id is None:
            if thumbnail_request["mode"] != "use_default":
                raise RuntimeError("サムネイルアセットが存在しません。")
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                article_id=article.id,
                lock_token=lock_token,
                target="default_thumbnail",
                status=SaveLogStatus.COMPLETED,
                message="固定デフォルトサムネイルを設定しました。",
            )
            return

        mode = thumbnail_request["mode"]
        asset = MediaAsset.objects.get(id=thumbnail_asset_id, article=article)
        if mode == "keep_current":
            ArticleSaveLogService.create_log(
                request_user_id=request_user_id,
                article_id=article.id,
                lock_token=lock_token,
                target=asset.file_name,
                status=SaveLogStatus.COMPLETED,
                message="現在のサムネイルを維持しました。",
            )
            return

        if mode == "use_uploaded":
            source_file_name = thumbnail_request.get("file_name")
            if not source_file_name:
                raise ValueError("サムネイル画像ファイル名が不足しています。")
            MediaService.process_uploaded_asset(
                article=article,
                source_file_name=source_file_name,
                stored_file_name=asset.file_name,
                processing_options=MediaService.default_processing_options(),
                lock_token=lock_token,
                asset=asset,
            )
        elif mode == "generate_from_title":
            MediaService.generate_thumbnail_image(
                asset=asset,
                title_text=thumbnail_request.get("title_text") or article.title,
                author_display_name=article.author.display_name or article.author.email,
                author_icon_path=article.author.icon,
            )
        else:
            MediaService.generate_thumbnail_image(
                asset=asset,
                title_text="週末カメラ",
                author_display_name=article.author.display_name or article.author.email,
                author_icon_path=article.author.icon,
            )

        ArticleSaveLogService.create_log(
            request_user_id=request_user_id,
            article_id=article.id,
            lock_token=lock_token,
            target=asset.file_name,
            status=SaveLogStatus.COMPLETED,
            message="サムネイル処理が完了しました。",
        )

    @staticmethod
    def _apply_direct_update(
        *,
        article: Article,
        request_user_id: str,
        lock_token: str,
        delete_image_ids: list[str],
        thumbnail_asset_id: str | None,
        old_thumbnail_asset_id: str | None,
        public_paths_by_source_file_name: dict[str, str],
    ) -> None:
        """
        直接保存系の反映を完了させる。
        """
        article.body_html = MediaService.rewrite_temp_paths_to_public(
            body_html=article.body_html,
            lock_token=lock_token,
            public_paths_by_source_file_name=public_paths_by_source_file_name,
        )
        article.thumbnail_asset_id = None if thumbnail_asset_id is None else thumbnail_asset_id
        article.toc_json = MediaService.build_toc(body_html=article.body_html)
        article.image_job_status = ImageJobStatus.COMPLETED
        if article.status == "publish" and article.published_at is None:
            article.published_at = timezone.now()
        article.save(
            update_fields=[
                "body_html",
                "thumbnail_asset",
                "toc_json",
                "image_job_status",
                "published_at",
                "updated_at",
            ]
        )
        OgpService.sync_article_ogp_cache(
            article=article,
            request_user_id=request_user_id,
            lock_token=lock_token,
        )
        ArticlePostprocessService._delete_requested_assets(
            article=article,
            request_user_id=request_user_id,
            lock_token=lock_token,
            delete_image_ids=delete_image_ids,
        )
        ArticlePostprocessService._delete_replaced_thumbnail_asset(
            old_thumbnail_asset_id=old_thumbnail_asset_id,
            current_thumbnail_asset_id=thumbnail_asset_id,
        )

    @staticmethod
    def _apply_staged_live_update(
        *,
        article: Article,
        request_user_id: str,
        lock_token: str,
        pending_snapshot: dict,
        delete_image_ids: list[str],
        thumbnail_asset_id: str | None,
        old_thumbnail_asset_id: str | None,
        public_paths_by_source_file_name: dict[str, str],
    ) -> None:
        """
        公開済み記事の差し替えを成功時にまとめて反映する。
        """
        body_html = MediaService.rewrite_temp_paths_to_public(
            body_html=pending_snapshot["body_html"],
            lock_token=lock_token,
            public_paths_by_source_file_name=public_paths_by_source_file_name,
        )

        with transaction.atomic():
            ArticlePendingSnapshotService.apply_snapshot(
                article=article,
                snapshot=pending_snapshot,
                body_html=body_html,
            )
            article.toc_json = MediaService.build_toc(body_html=article.body_html)
            article.save(update_fields=["toc_json", "updated_at"])
        OgpService.sync_article_ogp_cache(
            article=article,
            request_user_id=request_user_id,
            lock_token=lock_token,
        )
        ArticlePostprocessService._delete_requested_assets(
            article=article,
            request_user_id=request_user_id,
            lock_token=lock_token,
            delete_image_ids=delete_image_ids,
        )
        ArticlePostprocessService._delete_replaced_thumbnail_asset(
            old_thumbnail_asset_id=old_thumbnail_asset_id,
            current_thumbnail_asset_id=thumbnail_asset_id,
        )

    @staticmethod
    def _delete_replaced_thumbnail_asset(
        *,
        old_thumbnail_asset_id: str | None,
        current_thumbnail_asset_id: str | None,
    ) -> None:
        """
        差し替え前のサムネイルを削除する。
        """
        if old_thumbnail_asset_id is None:
            return
        if current_thumbnail_asset_id is not None and old_thumbnail_asset_id == current_thumbnail_asset_id:
            return

        asset = MediaAsset.objects.filter(id=old_thumbnail_asset_id).first()
        if asset is None:
            return
        MediaService.delete_media_asset_files(asset=asset)
        asset.delete()

    @staticmethod
    def _cleanup_failed_assets(
        *,
        article: Article,
        created_asset_ids: list[str],
        thumbnail_asset_id: str | None,
    ) -> None:
        """
        失敗時に作成途中のアセット実体を掃除する。
        """
        target_ids = set(created_asset_ids)
        if thumbnail_asset_id is not None:
            target_ids.add(str(thumbnail_asset_id))
        if not target_ids:
            return

        for asset in article.media_assets.filter(id__in=target_ids):
            MediaService.delete_media_asset_files(asset=asset)
            asset.delete()
