"""
記事管理サービスを定義する。
"""
from dataclasses import dataclass

from django.db import transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from cms.models import (
    Article,
    ArticleOption,
    ArticleStatus,
    ImageJobStatus,
    MediaAsset,
    Tag,
)
from cms.services.article_option_services import ArticleOptionService
from cms.services.article_save_log_services import ArticleSaveLogService
from cms.services.article_session_services import ArticleSessionService
from cms.services.common import build_pagination_payload, unique_slugify
from cms.services.media_services import MediaService
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
        ).prefetch_related("article_options__option")

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
                "article_options__option",
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
        tags = ArticleService._resolve_tags(tag_ids=payload.get("tag_ids", []))
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
        article.category = category
        article.title = payload["title"].strip()
        article.slug = unique_slugify(value=article.title, existing_slugs=existing_slugs)
        article.summary = payload["summary"].strip()
        article.body_html = payload["body_html"]
        article.status = payload["status"]
        article.twitter_card = payload.get("twitter_card") or article.twitter_card
        article.image_job_status = ImageJobStatus.PENDING
        article.published_at = None
        article.save()

        if is_create:
            ArticleSessionService.bind_session_to_article(
                user=user,
                lock_token=str(image_diff["lock_token"]),
                article=article,
            )

        ArticleService._sync_tags(article=article, tags=tags)
        ArticleService._sync_article_options(
            article=article,
            article_option=payload["article_option"],
        )

        old_thumbnail_asset = article.thumbnail_asset
        thumbnail_asset = MediaService.create_or_replace_thumbnail_asset(
            article=article,
            thumbnail_request=payload["image_diff"]["thumbnail_request"],
        )
        article.thumbnail_asset = thumbnail_asset
        article.save(update_fields=["thumbnail_asset", "updated_at"])

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
        }

        from cms.tasks import process_article_save_flow

        transaction.on_commit(
            lambda: process_article_save_flow.delay(
                str(article.id),
                str(user.id),
                image_diff_payload,
            )
        )

        if old_thumbnail_asset is not None and old_thumbnail_asset.id != thumbnail_asset.id:
            transaction.on_commit(lambda: ArticleService._delete_thumbnail_asset(old_thumbnail_asset))

        return ArticleMutationResult(
            article=article,
            postprocess_job={"job_name": "process_article_save_flow", "status": "accepted"},
        )

    @staticmethod
    def _delete_thumbnail_asset(asset: MediaAsset) -> None:
        """
        旧サムネイルアセットを削除する。
        """
        MediaService.delete_media_asset_files(asset=asset)
        asset.delete()

    @staticmethod
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
    def _resolve_tags(*, tag_ids: list) -> list[Tag]:
        """
        入力タグIDからタグ一覧を取得する。
        """
        if not tag_ids:
            return []
        tags = list(Tag.objects.filter(id__in=tag_ids))
        if len(tags) != len(set(map(str, tag_ids))):
            raise ValidationError({"tag_ids": ["存在しないタグが含まれています。"]})
        return tags

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
    def _sync_tags(*, article: Article, tags: list[Tag]) -> None:
        """
        記事タグを同期する。
        """
        article.tags.set(tags)

    @staticmethod
    def _sync_article_options(*, article: Article, article_option: dict) -> None:
        """
        記事オプションを同期する。
        """
        selected_options = ArticleOptionService.resolve_options_for_upsert(
            article_option=article_option,
        )
        selected_option_ids = [option.id for option in selected_options]

        ArticleOption.objects.filter(article=article).exclude(option_id__in=selected_option_ids).delete()

        for option in selected_options:
            ArticleOption.objects.get_or_create(article=article, option=option)
