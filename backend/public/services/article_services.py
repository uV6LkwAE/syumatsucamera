"""
公開記事参照サービスを定義する。
"""
from django.conf import settings
from rest_framework.exceptions import NotFound

from cms.models import Article, ArticleStatus, Category, ImageJobStatus, Tag
from cms.services.common import build_pagination_payload
from core.media_urls import build_cdn_media_url, build_public_asset_url
from cms.services.pv_services import PvService


class PublicArticleService:
    """
    公開記事APIの業務ロジックを扱う。
    """

    @staticmethod
    def list_articles(
        *,
        page: int,
        limit: int,
        q: str,
        ordering: str,
        category_slug: str | None,
        tag_slug: str | None,
        author_id=None,
    ) -> dict:
        """
        公開記事一覧を返す。
        """
        queryset = PublicArticleService._base_article_queryset()

        if q.strip() != "":
            queryset = queryset.filter(title__icontains=q.strip())

        if category_slug is not None:
            category = PublicArticleService._get_category(category_slug=category_slug)
            category_ids = category.get_descendants(include_self=True).values_list("id", flat=True)
            queryset = queryset.filter(category_id__in=category_ids)

        if tag_slug is not None:
            tag = PublicArticleService._get_tag(tag_slug=tag_slug)
            queryset = queryset.filter(tags=tag)

        if author_id is not None:
            queryset = queryset.filter(author_id=author_id)

        ordering_map = {
            "newest": ["-created_at", "-published_at", "-updated_at"],
            "popular": ["-views_total", "-published_at", "-updated_at"],
        }
        queryset = queryset.order_by(*ordering_map.get(ordering, ordering_map["newest"]))
        return build_pagination_payload(page=page, limit=limit, queryset=queryset)

    @staticmethod
    def get_article_detail(*, category_slug: str, article_slug: str) -> dict:
        """
        公開記事詳細と関連記事を返す。
        """
        try:
            article = PublicArticleService._detail_article_queryset().get(
                category__slug=category_slug,
                slug=article_slug,
            )
        except Article.DoesNotExist as exc:
            raise NotFound("記事が存在しません。") from exc

        PvService.increment_article_view(article_id=str(article.id))

        related_articles = PublicArticleService._list_related_articles(article=article)
        return {
            "article": article,
            "related_articles": related_articles,
            "cdn_base_url": settings.CDN_BASE_URL,
        }

    @staticmethod
    def get_article_meta(*, slug: str, site_origin: str) -> dict:
        """
        Cloudflare Worker向けの記事メタ情報を返す。
        """
        try:
            article = PublicArticleService._base_article_queryset().get(slug=slug)
        except (Article.DoesNotExist, Article.MultipleObjectsReturned) as exc:
            raise NotFound("記事が存在しません。") from exc

        canonical_url = build_public_asset_url(
            site_origin=site_origin,
            asset_path=f"/articles/{article.slug}",
        )
        return {
            "title": article.title,
            "description": article.summary.strip(),
            "canonical_url": canonical_url,
            "og_image_url": PublicArticleService._build_article_og_image_url(
                article=article,
                site_origin=site_origin,
            ),
        }

    @staticmethod
    def _base_article_queryset():
        """
        公開記事一覧向けQuerySetを返す。
        """
        return Article.objects.filter(
            status=ArticleStatus.PUBLISH,
            image_job_status=ImageJobStatus.COMPLETED,
        ).select_related(
            "category",
            "author",
            "thumbnail_asset",
        )

    @staticmethod
    def _build_article_og_image_url(*, article: Article, site_origin: str) -> str:
        """
        記事メタ情報用のOGP画像URLを返す。
        """
        if article.thumbnail_asset is None:
            return build_public_asset_url(
                site_origin=site_origin,
                asset_path=settings.DEFAULT_OG_IMAGE_PATH,
            )

        file_name = article.thumbnail_asset.file_name
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        media_path = f"{settings.MEDIA_URL}images/{shard_a}/{shard_b}/{file_name}"
        thumbnail_url = build_cdn_media_url(media_path)
        if thumbnail_url is None:
            raise RuntimeError("公開記事のサムネイルURLを生成できません。")
        return thumbnail_url

    @staticmethod
    def _detail_article_queryset():
        """
        公開記事詳細向けQuerySetを返す。
        """
        return PublicArticleService._base_article_queryset().prefetch_related(
            "tags",
            "ogp_infos",
        )

    @staticmethod
    def _list_related_articles(*, article: Article) -> list[Article]:
        """
        同カテゴリ優先で関連記事を最大6件返す。
        """
        same_category_articles = list(
            PublicArticleService._base_article_queryset().filter(
                category_id=article.category_id,
            ).exclude(
                id=article.id,
            ).order_by(
                "-views_total",
                "-published_at",
                "-updated_at",
            )[:6]
        )

        if len(same_category_articles) >= 6:
            return same_category_articles

        excluded_ids = [article.id, *[related.id for related in same_category_articles]]
        fallback_articles = list(
            PublicArticleService._base_article_queryset().exclude(
                id__in=excluded_ids,
            ).order_by(
                "-views_total",
                "-published_at",
                "-updated_at",
            )[: 6 - len(same_category_articles)]
        )
        return [*same_category_articles, *fallback_articles]

    @staticmethod
    def _get_category(*, category_slug: str) -> Category:
        """
        slug でカテゴリを取得する。
        """
        try:
            return Category.objects.get(slug=category_slug)
        except Category.DoesNotExist as exc:
            raise NotFound("カテゴリが存在しません。") from exc

    @staticmethod
    def _get_tag(*, tag_slug: str) -> Tag:
        """
        slug でタグを取得する。
        """
        try:
            return Tag.objects.get(slug=tag_slug)
        except Tag.DoesNotExist as exc:
            raise NotFound("タグが存在しません。") from exc
