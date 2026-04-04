"""
公開APIのシリアライザーを定義する。
"""
from django.conf import settings
from rest_framework import serializers

from cms.models import ArticleStatus, TwitterCardType
from core.media_urls import build_cdn_media_url


class PublicArticleListQuerySerializer(serializers.Serializer):
    """
    公開記事一覧クエリを検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )
    q = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
        default="",
        trim_whitespace=True,
    )
    ordering = serializers.ChoiceField(
        choices=["newest", "popular"],
        required=False,
        default="newest",
    )
    category_slug = serializers.CharField(required=False, allow_blank=False, max_length=120)
    tag_slug = serializers.CharField(required=False, allow_blank=False, max_length=120)
    author_id = serializers.UUIDField(required=False)


class PublicPaginationSerializer(serializers.Serializer):
    """
    一覧ページ情報を返す。
    """

    page = serializers.IntegerField(read_only=True)
    page_size = serializers.IntegerField(read_only=True)
    total_count = serializers.IntegerField(read_only=True)
    total_pages = serializers.IntegerField(read_only=True)


class PublicCategorySummarySerializer(serializers.Serializer):
    """
    公開カテゴリー要約を返す。
    """

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    path = serializers.CharField(read_only=True)


class PublicTagSummarySerializer(serializers.Serializer):
    """
    公開タグ要約を返す。
    """

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    slug = serializers.CharField(read_only=True)


class PublicAuthorSummarySerializer(serializers.Serializer):
    """
    公開著者要約を返す。
    """

    id = serializers.UUIDField(read_only=True)
    display_name = serializers.SerializerMethodField()
    icon = serializers.SerializerMethodField()
    header_image = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        """
        著者表示名を返す。
        """
        return obj.display_name or obj.email

    def get_icon(self, obj) -> str | None:
        """
        CDN付き著者アイコンURLを返す。
        """
        return build_cdn_media_url(obj.icon)

    def get_header_image(self, obj) -> str | None:
        """
        CDN付き著者ヘッダー画像URLを返す。
        """
        return build_cdn_media_url(obj.header_image)


class PublicArticleOptionItemSerializer(serializers.Serializer):
    """
    公開記事オプション要素を返す。
    """

    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    label = serializers.CharField(read_only=True)
    is_system = serializers.BooleanField(read_only=True)


class PublicArticleOptionSerializer(serializers.Serializer):
    """
    公開記事オプションを返す。
    """

    is_pr = serializers.BooleanField(read_only=True)
    is_ad = serializers.BooleanField(read_only=True)
    items = PublicArticleOptionItemSerializer(many=True, read_only=True)


class PublicOgpRecordSerializer(serializers.Serializer):
    """
    公開記事本文用OGPキャッシュを返す。
    """

    id = serializers.UUIDField(read_only=True)
    article_id = serializers.UUIDField(read_only=True)
    url = serializers.CharField(read_only=True)
    title = serializers.CharField(allow_null=True, read_only=True)
    summary = serializers.CharField(allow_null=True, read_only=True)
    thumbnail = serializers.CharField(allow_null=True, read_only=True)
    site_name = serializers.CharField(allow_null=True, read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class PublicTocNodeSerializer(serializers.Serializer):
    """
    公開記事TOCノードを返す。
    """

    level = serializers.IntegerField(read_only=True)
    id = serializers.CharField(read_only=True)
    text = serializers.CharField(read_only=True)
    children = serializers.SerializerMethodField()

    def get_children(self, obj) -> list:
        """
        子ノードを再帰的に返す。
        """
        return PublicTocNodeSerializer(obj.get("children", []), many=True).data


class PublicArticleSummarySerializer(serializers.Serializer):
    """
    公開記事一覧要素を返す。
    """

    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    summary = serializers.CharField(read_only=True)
    published_at = serializers.DateTimeField(read_only=True)
    views_total = serializers.IntegerField(read_only=True)
    thumbnail_url = serializers.SerializerMethodField()
    path = serializers.CharField(read_only=True)
    category = PublicCategorySummarySerializer(read_only=True)
    author = PublicAuthorSummarySerializer(read_only=True)
    article_option = serializers.SerializerMethodField()

    def get_thumbnail_url(self, obj) -> str:
        """
        CDN付きサムネイルURLを返す。
        """
        if obj.thumbnail_asset is None:
            raise RuntimeError("公開記事のサムネイルアセットが存在しません。")

        file_name = obj.thumbnail_asset.file_name
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        media_path = f"{settings.MEDIA_URL}images/{shard_a}/{shard_b}/{file_name}"
        thumbnail_url = build_cdn_media_url(media_path)
        if thumbnail_url is None:
            raise RuntimeError("公開記事のサムネイルURLを生成できません。")
        return thumbnail_url

    def get_article_option(self, obj) -> dict:
        """
        公開記事オプション要約を返す。
        """
        option_codes = set(obj.article_options.values_list("option__code", flat=True))
        items = [
            {
                "id": article_option.option_id,
                "code": article_option.option.code,
                "label": article_option.option.label,
                "is_system": article_option.option.code in {"pr", "ad"},
            }
            for article_option in obj.article_options.all()
        ]
        return {
            "is_pr": "pr" in option_codes,
            "is_ad": "ad" in option_codes,
            "items": items,
        }


class PublicArticleListSerializer(serializers.Serializer):
    """
    公開記事一覧レスポンスを返す。
    """

    items = PublicArticleSummarySerializer(many=True, read_only=True)
    pagination = PublicPaginationSerializer(read_only=True)


class PublicArticleBodySerializer(PublicArticleSummarySerializer):
    """
    公開記事詳細本文を返す。
    """

    body_html = serializers.CharField(read_only=True)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, read_only=True)
    twitter_card = serializers.ChoiceField(
        choices=TwitterCardType.choices,
        read_only=True,
    )
    tags = PublicTagSummarySerializer(many=True, read_only=True)
    toc = serializers.SerializerMethodField()
    ogp_by_url = serializers.SerializerMethodField()

    def get_toc(self, obj) -> list:
        """
        公開記事TOCを返す。
        """
        return PublicTocNodeSerializer(obj.toc_json or [], many=True).data

    def get_ogp_by_url(self, obj) -> dict:
        """
        本文リンクURLごとのOGPキャッシュを返す。
        """
        return {
            ogp_info.url: PublicOgpRecordSerializer(ogp_info).data
            for ogp_info in obj.ogp_infos.all()
        }


class PublicArticleDetailSerializer(serializers.Serializer):
    """
    公開記事詳細レスポンスを返す。
    """

    article = PublicArticleBodySerializer(read_only=True)
    related_articles = PublicArticleSummarySerializer(many=True, read_only=True)
    cdn_base_url = serializers.CharField(read_only=True)

