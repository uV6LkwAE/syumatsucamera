"""
記事管理サービスを定義する。
"""
from dataclasses import dataclass

from django.db import transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from cms.models import (
    Article,
    ArticleStatus,
    ImageJobStatus,
    MediaAsset,
    Tag,
)
from cms.services.article_option_services import ArticleOptionService
from cms.services.article_pending_snapshot_services import ArticlePendingSnapshotService
from cms.services.article_save_log_services import ArticleSaveLogService
from cms.services.article_session_services import ArticleSessionService
from cms.services.common import build_pagination_payload, unique_slugify
from cms.services.media_services import MediaService
from cms.services.tag_services import TagService
from users.models import User, UserRole


@dataclass
class ArticleMutationResult:
    """
    記事保存APIの戻り値。
    """

    article: Article
    postprocess_job: dict


class ArticleService:
    """
    記事管理の業務ロジックを扱う。
    """

    @staticmethod
    def list_articles(
        *,
        user: User,
        page: int,
        limit: int,
        ordering: str,
        author_id=None,
        title: str | None,
        status: str | None,
    ) -> dict:
        """
        CMS記事一覧を返す。
        """
        queryset = Article.objects.select_related(
            "category",
            "author",
            "thumbnail_asset",
        )

        if user.role != UserRole.ADMIN:
            queryset = queryset.filter(author=user)
        elif author_id is not None:
            queryset = queryset.filter(author_id=author_id)

        if title:
            queryset = queryset.filter(title__icontains=title.strip())
        if status:
            queryset = queryset.filter(status=status)

        ordering_map = {
            "newest": ["-created_at", "-updated_at"],
            "oldest": ["created_at", "updated_at"],
            "popular": ["-views_total", "-updated_at"],
        }
        queryset = queryset.order_by(*ordering_map.get(ordering, ordering_map["newest"]))
        return build_pagination_payload(page=page, limit=limit, queryset=queryset)

    @staticmethod
    def get_article_for_user(*, user: User, article_id) -> Article:
        """
        権限込みで記事を取得する。
        """
        try:
            article = Article.objects.select_related(
                "category",
                "author",
                "thumbnail_asset",
                "locked_by",
            ).prefetch_related(
                "tags",
            ).get(id=article_id)
        except Article.DoesNotExist as exc:
            raise NotFound("記事が存在しません。") from exc

        if user.role != UserRole.ADMIN and str(article.author_id) != str(user.id):
            raise PermissionDenied("対象記事の権限がありません。")
        return article

    @staticmethod
    def create_article(*, user: User, payload: dict) -> ArticleMutationResult:
        """
        記事を新規作成する。
        """
        article = Article(
            author=user,
            status=ArticleStatus.DRAFT,
            image_job_status=ImageJobStatus.PENDING,
        )
        return ArticleService._upsert_article(user=user, article=article, payload=payload, is_create=True)

    @staticmethod
    def update_article(*, user: User, article: Article, payload: dict) -> ArticleMutationResult:
        """
        記事を更新する。
        """
        return ArticleService._upsert_article(user=user, article=article, payload=payload, is_create=False)

    @staticmethod
    @transaction.atomic
    def delete_article(*, user: User, article: Article) -> None:
        """
        記事と関連アセットを削除する。
        """
        if user.role != UserRole.ADMIN and str(article.author_id) != str(user.id):
            raise PermissionDenied("対象記事の削除権限がありません。")

        assets = list(article.media_assets.all())
        article.thumbnail_asset = None
        article.save(update_fields=["thumbnail_asset", "updated_at"])
        article.delete()
        ArticlePendingSnapshotService.delete_snapshot(article_id=str(article.id))

        transaction.on_commit(
            lambda: ArticleService._delete_article_asset_files(assets)
        )

    @staticmethod
    def _upsert_article(*, user: User, article: Article, payload: dict, is_create: bool) -> ArticleMutationResult:
        """
        記事作成と更新の共通処理を行う。
        """
        image_diff = payload["image_diff"]
        ArticleService._validate_status_change(
            user=user,
            requested_status=payload["status"],
        )

        category = ArticleService._get_category(category_id=payload["category_id"])
        tags = TagService.resolve_tags_for_article_upsert(
            tag_ids=payload.get("tag_ids", []),
            tag_names=payload.get("tag_names", []),
        )
        selected_option_ids = ArticleOptionService.resolve_option_ids_for_upsert(
            article_option=payload["article_option"],
        )
        MediaService.validate_image_diff(body_html=payload["body_html"], image_diff=image_diff)

        if not is_create:
            ArticleSessionService.assert_session_owner(
                user=user,
                lock_token=str(image_diff["lock_token"]),
                article=article,
            )
            ArticleService._validate_delete_images(article=article, delete_image_ids=image_diff["delete_images"])
        else:
            ArticleSessionService.assert_session_owner(
                user=user,
                lock_token=str(image_diff["lock_token"]),
            )

        existing_slugs = Article.objects.filter(category=category).exclude(id=article.id).values_list(
            "slug",
            flat=True,
        )
        next_title = payload["title"].strip()
        next_slug = unique_slugify(value=next_title, existing_slugs=existing_slugs)
        next_summary = payload["summary"].strip()
        next_twitter_card = payload.get("twitter_card") or article.twitter_card

        staged_live_update = (
            not is_create
            and article.status == ArticleStatus.PUBLISH
            and article.published_at is not None
        )

        if not staged_live_update:
            article.category = category
            article.title = next_title
            article.slug = next_slug
            article.summary = next_summary
            article.twitter_card = next_twitter_card
            article.body_html = payload["body_html"]
            article.status = payload["status"]
            article.option = selected_option_ids
            article.image_job_status = ImageJobStatus.PENDING
            if article.status != ArticleStatus.PUBLISH:
                article.published_at = None
            article.save()

        if is_create:
            ArticleSessionService.bind_session_to_article(
                user=user,
                lock_token=str(image_diff["lock_token"]),
                article=article,
            )

        if not staged_live_update:
            ArticleService._sync_tags(article=article, tags=tags)

        old_thumbnail_asset = article.thumbnail_asset
        thumbnail_asset = MediaService.create_or_replace_thumbnail_asset(
            article=article,
            thumbnail_request=payload["image_diff"]["thumbnail_request"],
        )

        ArticleSaveLogService.create_log(
            request_user_id=user.id,
            article_id=article.id,
            lock_token=str(image_diff["lock_token"]),
            target="article",
            status="started",
            message="記事保存ジョブを受け付けました。",
        )

        image_diff_payload = {
            "lock_token": str(image_diff["lock_token"]),
            "new_images": payload["image_diff"]["new_images"],
            "delete_images": [str(value) for value in payload["image_diff"]["delete_images"]],
            "thumbnail_request": payload["image_diff"]["thumbnail_request"],
            "thumbnail_asset_id": None if thumbnail_asset is None else str(thumbnail_asset.id),
            "old_thumbnail_asset_id": (
                None
                if old_thumbnail_asset is None
                or (thumbnail_asset is not None and old_thumbnail_asset.id == thumbnail_asset.id)
                else str(old_thumbnail_asset.id)
            ),
            "staged_live_update": staged_live_update,
        }

        from cms.tasks import process_article_save_flow

        if staged_live_update:
            pending_snapshot = ArticlePendingSnapshotService.build_snapshot_payload(
                category_id=category.id,
                title=next_title,
                slug=next_slug,
                summary=next_summary,
                body_html=payload["body_html"],
                status=payload["status"],
                twitter_card=next_twitter_card,
                tag_ids=[tag.id for tag in tags],
                option_ids=selected_option_ids,
                thumbnail_asset_id=None if thumbnail_asset is None else thumbnail_asset.id,
            )

            transaction.on_commit(
                lambda: ArticleService._store_snapshot_and_enqueue_job(
                    article_id=str(article.id),
                    request_user_id=str(user.id),
                    image_diff_payload=image_diff_payload,
                    pending_snapshot=pending_snapshot,
                    process_article_save_flow=process_article_save_flow,
                )
            )
        else:
            transaction.on_commit(
                lambda: process_article_save_flow.delay(
                    str(article.id),
                    str(user.id),
                    image_diff_payload,
                )
            )

        return ArticleMutationResult(
            article=article,
            postprocess_job={"job_name": "process_article_save_flow", "status": "accepted"},
        )

    def _delete_article_asset_files(assets: list[MediaAsset]) -> None:
        """
        削除済み記事に紐づいていたメディア実体を削除する。
        """
        for asset in assets:
            MediaService.delete_media_asset_files(asset=asset)

    @staticmethod
    def _get_category(*, category_id):
        """
        カテゴリを取得する。
        """
        from cms.models import Category

        try:
            return Category.objects.get(id=category_id)
        except Category.DoesNotExist as exc:
            raise NotFound("カテゴリが存在しません。") from exc

    @staticmethod
    def _validate_status_change(*, user: User, requested_status: str) -> None:
        """
        保存時の状態遷移を検証する。
        """
        if user.role != UserRole.ADMIN and requested_status == ArticleStatus.PUBLISH:
            raise ValidationError({"status": ["執筆者は直接公開できません。"]})

    @staticmethod
    def _validate_delete_images(*, article: Article, delete_image_ids: list) -> None:
        """
        削除対象画像が対象記事に属しているか検証する。
        """
        if not delete_image_ids:
            return
        existing_count = article.media_assets.filter(id__in=delete_image_ids).count()
        if existing_count != len(set(map(str, delete_image_ids))):
            raise ValidationError({"image_diff": ["削除対象画像が記事と一致しません。"]})

    @staticmethod
    def _store_snapshot_and_enqueue_job(
        *,
        article_id: str,
        request_user_id: str,
        image_diff_payload: dict,
        pending_snapshot: dict,
        process_article_save_flow,
    ) -> None:
        """
        スナップショット保存後に後処理ジョブを投入する。
        """
        ArticlePendingSnapshotService.store_snapshot(
            article_id=article_id,
            snapshot=pending_snapshot,
        )
        process_article_save_flow.delay(
            article_id,
            request_user_id,
            image_diff_payload,
        )

    @staticmethod
    def _sync_tags(*, article: Article, tags: list[Tag]) -> None:
        """
        記事タグを同期する。
        """
        article.tags.set(tags)
