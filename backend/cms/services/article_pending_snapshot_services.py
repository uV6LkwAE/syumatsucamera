"""
記事の公開切替待ちスナップショットを管理する。
"""
import json
import uuid

from django.conf import settings
from django.utils import timezone

from cms.models import Article, ArticleStatus, Category, Tag
from redis_layer.client import get_redis_client

SNAPSHOT_KEY_PREFIX = "cms:article-pending-snapshot"


class ArticlePendingSnapshotService:
    """
    公開済み記事の差し替え待ち内容を Redis へ保存する。
    """

    @staticmethod
    def build_snapshot_payload(
        *,
        category_id,
        title: str,
        slug: str,
        summary: str,
        body_html: str,
        status: str,
        twitter_card: str,
        is_profit: bool,
        tag_ids: list,
        option_ids: list,
        thumbnail_asset_id,
    ) -> dict:
        """
        Redis 保存用ペイロードを返す。
        """
        return {
            "category_id": str(category_id),
            "title": title,
            "slug": slug,
            "summary": summary,
            "body_html": body_html,
            "status": status,
            "twitter_card": twitter_card,
            "is_profit": is_profit,
            "tag_ids": [str(tag_id) for tag_id in tag_ids],
            "option_ids": [str(option_id) for option_id in option_ids],
            "thumbnail_asset_id": None if thumbnail_asset_id is None else str(thumbnail_asset_id),
        }

    @staticmethod
    def store_snapshot(*, article_id: str, snapshot: dict) -> None:
        """
        差し替え待ちスナップショットを保存する。
        """
        get_redis_client().set(
            ArticlePendingSnapshotService._snapshot_key(article_id),
            json.dumps(snapshot),
            ex=settings.CMS_ARTICLE_PENDING_SNAPSHOT_TTL_SECONDS,
        )

    @staticmethod
    def get_snapshot(*, article_id: str) -> dict | None:
        """
        保存済みスナップショットを返す。
        """
        raw = get_redis_client().get(ArticlePendingSnapshotService._snapshot_key(article_id))
        if raw is None:
            return None
        return json.loads(raw)

    @staticmethod
    def delete_snapshot(*, article_id: str) -> None:
        """
        保存済みスナップショットを削除する。
        """
        get_redis_client().delete(ArticlePendingSnapshotService._snapshot_key(article_id))

    @staticmethod
    def apply_snapshot(
        *,
        article: Article,
        snapshot: dict,
        body_html: str,
    ) -> None:
        """
        スナップショット内容を記事へ反映する。
        """
        category = Category.objects.get(id=snapshot["category_id"])
        tag_ids = [uuid.UUID(value) for value in snapshot.get("tag_ids", [])]
        option_ids = [uuid.UUID(value) for value in snapshot.get("option_ids", [])]
        thumbnail_asset_id = snapshot.get("thumbnail_asset_id")

        article.category = category
        article.title = snapshot["title"]
        article.slug = snapshot["slug"]
        article.summary = snapshot["summary"]
        article.body_html = body_html
        article.status = snapshot["status"]
        article.twitter_card = snapshot["twitter_card"]
        article.is_profit = snapshot.get("is_profit", article.is_profit)
        article.thumbnail_asset_id = None if thumbnail_asset_id is None else uuid.UUID(thumbnail_asset_id)
        article.option = option_ids

        if article.status == ArticleStatus.PUBLISH:
            if article.published_at is None:
                article.published_at = timezone.now()
        else:
            article.published_at = None

        article.save(
            update_fields=[
                "category",
                "title",
                "slug",
                "summary",
                "body_html",
                "status",
                "twitter_card",
                "is_profit",
                "thumbnail_asset",
                "option",
                "published_at",
                "updated_at",
            ]
        )
        article.tags.set(Tag.objects.filter(id__in=tag_ids))

    @staticmethod
    def _snapshot_key(article_id: str) -> str:
        """
        Redis キーを返す。
        """
        return f"{SNAPSHOT_KEY_PREFIX}:{article_id}"
