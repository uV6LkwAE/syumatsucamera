"""
cms アプリのシリアライザーを定義する。
"""
from django.conf import settings
from rest_framework import serializers

from cms.models import (
    ARTICLE_TAG_MAX_COUNT,
    ArticleStatus,
    ImageJobStatus,
    PublishRequestStatus,
    SaveLogStatus,
    TwitterCardType,
)
from cms.services.article_option_services import ArticleOptionService


class CommonPaginationSerializer(serializers.Serializer):
    """
    共通ページネーション情報を返す。
    """

    page = serializers.IntegerField(read_only=True)
    page_size = serializers.IntegerField(read_only=True)
    total_count = serializers.IntegerField(read_only=True)
    total_pages = serializers.IntegerField(read_only=True)


class CmsCategorySummarySerializer(serializers.Serializer):
    """
    カテゴリ要約情報を返す。
    """

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    slug = serializers.CharField(read_only=True)
    path = serializers.CharField(read_only=True)


class CmsAuthorSummarySerializer(serializers.Serializer):
    """
    執筆者要約情報を返す。
    """

    id = serializers.UUIDField(read_only=True)
    display_name = serializers.CharField(read_only=True)
    icon = serializers.CharField(allow_null=True, read_only=True)
    header_image = serializers.CharField(allow_null=True, read_only=True)


class CmsArticleAuthorOptionSerializer(serializers.Serializer):
    """
    記事一覧用の執筆者候補を返す。
    """

    id = serializers.UUIDField(read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        """
        執筆者表示名を返す。
        """
        return obj.display_name or obj.email


class CmsArticleAuthorOptionListSerializer(serializers.Serializer):
    """
    記事一覧用の執筆者候補一覧を返す。
    """

    items = CmsArticleAuthorOptionSerializer(many=True, read_only=True)


class CmsTagSummarySerializer(serializers.Serializer):
    """
    タグ要約情報を返す。
    """

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    slug = serializers.CharField(read_only=True)


class CmsTagSuggestionQuerySerializer(serializers.Serializer):
    """
    タグサジェスト検索条件を検証する。
    """

    q = serializers.CharField(required=False, allow_blank=True, max_length=100, default="")
    limit = serializers.IntegerField(required=False, min_value=1, max_value=20, default=8)


class CmsTagSuggestionSerializer(CmsTagSummarySerializer):
    """
    タグサジェスト候補を返す。
    """

    article_count = serializers.IntegerField(read_only=True)


class CmsTagSuggestionListSerializer(serializers.Serializer):
    """
    タグサジェスト候補一覧を返す。
    """

    items = CmsTagSuggestionSerializer(many=True, read_only=True)


class CmsMediaAssetSerializer(serializers.Serializer):
    """
    記事メディアアセット要約を返す。
    """

    id = serializers.UUIDField(read_only=True)
    file_name = serializers.CharField(read_only=True)
    public_path = serializers.CharField(read_only=True)
    is_thumbnail = serializers.BooleanField(read_only=True)


class ArticleOptionSerializer(serializers.Serializer):
    """
    記事オプション要素を返す。
    """

    id = serializers.UUIDField(read_only=True)
    code = serializers.CharField(read_only=True)
    label = serializers.CharField(read_only=True)
    description = serializers.CharField(allow_blank=True, read_only=True)
    is_system = serializers.BooleanField(read_only=True)


class ArticleOptionResponseSerializer(serializers.Serializer):
    """
    記事オプションを返す。
    """

    is_pr = serializers.BooleanField()
    is_ad = serializers.BooleanField()
    items = ArticleOptionSerializer(many=True, read_only=True)


class ArticleOptionRequestSerializer(serializers.Serializer):
    """
    記事オプション入力を検証する。
    """

    selected_option_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_selected_option_ids(self, value):
        """
        同一オプションの重複指定を検証する。
        """
        if len(value) != len({str(option_id) for option_id in value}):
            raise serializers.ValidationError("同じ記事オプションを複数指定することはできません。")
        return value


class CmsArticleOptionListSerializer(serializers.Serializer):
    """
    記事オプション一覧を返す。
    """

    items = ArticleOptionSerializer(many=True, read_only=True)


class CmsArticleOptionCreateUpdateRequestSerializer(serializers.Serializer):
    """
    記事オプション作成更新入力を検証する。
    """

    label = serializers.CharField(min_length=1, max_length=100)
    description = serializers.CharField(min_length=1)


class CmsTocNodeSerializer(serializers.Serializer):
    """
    TOCノードを返す。
    """

    level = serializers.IntegerField(read_only=True)
    id = serializers.CharField(read_only=True)
    text = serializers.CharField(read_only=True)
    children = serializers.SerializerMethodField()

    def get_children(self, obj) -> list:
        """
        子ノードを再帰的に返す。
        """
        return CmsTocNodeSerializer(obj.get("children", []), many=True).data


class CmsArticleSummarySerializer(serializers.Serializer):
    """
    CMS記事一覧要素を返す。
    """

    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    path = serializers.CharField(read_only=True)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, read_only=True)
    author = CmsAuthorSummarySerializer(read_only=True)
    category = serializers.SerializerMethodField()
    article_option = serializers.SerializerMethodField()
    views_total = serializers.IntegerField(read_only=True)
    image_job_status = serializers.ChoiceField(choices=ImageJobStatus.choices, read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def get_category(self, obj) -> dict:
        """
        カテゴリ要約を返す。
        """
        return CmsCategorySummarySerializer(obj.category).data

    def get_article_option(self, obj) -> dict:
        """
        オプション要約を返す。
        """
        return ArticleOptionService.build_article_option_payload(article=obj)


class CmsArticleListSerializer(serializers.Serializer):
    """
    CMS記事一覧レスポンスを返す。
    """

    items = CmsArticleSummarySerializer(many=True, read_only=True)
    pagination = CommonPaginationSerializer(read_only=True)


class MediaAssetImageProcessingOptionsSerializer(serializers.Serializer):
    """
    画像処理オプションを検証する。
    """

    resize = serializers.BooleanField()
    exif_watermark = serializers.BooleanField()
    site_logo_watermark = serializers.BooleanField()
    custom_text_overlay = serializers.BooleanField()
    custom_text = serializers.CharField(required=False, allow_blank=True)


class MediaAssetNewImageSerializer(serializers.Serializer):
    """
    新規画像差分を検証する。
    """

    file_name = serializers.CharField()
    options = MediaAssetImageProcessingOptionsSerializer()


class MediaAssetThumbnailRequestSerializer(serializers.Serializer):
    """
    サムネイル要求を検証する。
    """

    mode = serializers.ChoiceField(
        choices=[
            "use_uploaded",
            "use_default",
            "generate_from_title",
        ]
    )
    file_name = serializers.CharField(required=False)
    title_text = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        """
        モードに応じた必須項目を検証する。
        """
        if attrs["mode"] == "use_uploaded" and not attrs.get("file_name"):
            raise serializers.ValidationError({"file_name": ["use_uploaded では file_name が必須です。"]})
        if attrs["mode"] == "generate_from_title" and not attrs.get("title_text", "").strip():
            raise serializers.ValidationError(
                {"title_text": ["generate_from_title では title_text が必須です。"]}
            )
        return attrs


class MediaAssetImageDiffSerializer(serializers.Serializer):
    """
    画像差分JSONを検証する。
    """

    lock_token = serializers.UUIDField()
    new_images = MediaAssetNewImageSerializer(many=True)
    delete_images = serializers.ListField(
        child=serializers.UUIDField(),
    )
    thumbnail_request = MediaAssetThumbnailRequestSerializer()


class CmsArticleUpsertRequestSerializer(serializers.Serializer):
    """
    記事作成更新入力を検証する。
    """

    category_id = serializers.UUIDField()
    title = serializers.CharField(min_length=1, max_length=255)
    summary = serializers.CharField(min_length=1, max_length=200)
    body_html = serializers.CharField(min_length=1)
    status = serializers.ChoiceField(choices=ArticleStatus.choices)
    tag_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        max_length=ARTICLE_TAG_MAX_COUNT,
        default=list,
    )
    tag_names = serializers.ListField(
        child=serializers.CharField(min_length=1, max_length=100),
        required=False,
        allow_empty=True,
        max_length=ARTICLE_TAG_MAX_COUNT,
        default=list,
    )
    twitter_card = serializers.ChoiceField(
        choices=TwitterCardType.choices,
        required=False,
        default=TwitterCardType.SUMMARY_LARGE_IMAGE,
    )
    article_option = ArticleOptionRequestSerializer()
    image_diff = MediaAssetImageDiffSerializer()


class CmsArticleSessionCreateRequestSerializer(serializers.Serializer):
    """
    記事編集セッション開始入力を検証する。
    """

    article_id = serializers.UUIDField(required=False)


class CmsArticleSessionSerializer(serializers.Serializer):
    """
    記事編集セッション情報を返す。
    """

    article_id = serializers.UUIDField(allow_null=True, read_only=True)
    default_thumbnail_preview_path = serializers.CharField(read_only=True)
    lock_token = serializers.UUIDField(read_only=True)
    locked_by_id = serializers.UUIDField(read_only=True)
    locked_by = CmsAuthorSummarySerializer(read_only=True)
    lock_expires_at = serializers.DateTimeField(read_only=True)


class CmsArticleImageUploadRequestSerializer(serializers.Serializer):
    """
    記事画像アップロード入力を検証する。
    """

    lock_token = serializers.UUIDField()
    file = serializers.ImageField()


class CmsArticleImageUploadResponseSerializer(serializers.Serializer):
    """
    記事画像アップロード結果を返す。
    """

    file_name = serializers.CharField(read_only=True)
    path = serializers.CharField(read_only=True)


class SystemAcceptedJobSerializer(serializers.Serializer):
    """
    受理済みジョブ情報を返す。
    """

    job_name = serializers.CharField(read_only=True)
    status = serializers.ChoiceField(choices=["accepted"], read_only=True)


class CmsArticleSerializer(serializers.Serializer):
    """
    CMS記事詳細を返す。
    """

    id = serializers.UUIDField(read_only=True)
    category_id = serializers.UUIDField(read_only=True)
    author_id = serializers.UUIDField(read_only=True)
    author = CmsAuthorSummarySerializer(read_only=True)
    title = serializers.CharField(read_only=True)
    path = serializers.CharField(read_only=True)
    slug = serializers.CharField(read_only=True)
    summary = serializers.CharField(read_only=True)
    body_html = serializers.CharField(read_only=True)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, read_only=True)
    published_at = serializers.DateTimeField(allow_null=True, read_only=True)
    views_total = serializers.IntegerField(read_only=True)
    thumbnail_asset_id = serializers.UUIDField(allow_null=True, read_only=True)
    thumbnail_preview_path = serializers.SerializerMethodField()
    twitter_card = serializers.ChoiceField(choices=TwitterCardType.choices, read_only=True)
    article_option = serializers.SerializerMethodField()
    tags = CmsTagSummarySerializer(many=True, read_only=True)
    media_assets = serializers.SerializerMethodField()
    toc = serializers.SerializerMethodField()
    image_job_status = serializers.ChoiceField(choices=ImageJobStatus.choices, read_only=True)
    lock = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)

    def get_article_option(self, obj) -> dict:
        """
        オプション要約を返す。
        """
        return ArticleOptionService.build_article_option_payload(article=obj)

    def get_toc(self, obj) -> list:
        """
        TOCを返す。
        """
        return CmsTocNodeSerializer(obj.toc_json or [], many=True).data

    def get_thumbnail_preview_path(self, obj) -> str:
        """
        編集画面向けのサムネイルプレビュー用パスを返す。
        """
        if obj.thumbnail_asset is None:
            return settings.DEFAULT_OG_IMAGE_PATH
        return self._build_public_path(file_name=obj.thumbnail_asset.file_name)

    def get_media_assets(self, obj) -> list:
        """
        記事に紐づくメディアアセット一覧を返す。
        """
        items = []
        for asset in obj.media_assets.order_by("created_at"):
            items.append(
                {
                    "id": asset.id,
                    "file_name": asset.file_name,
                    "public_path": self._build_public_path(file_name=asset.file_name),
                    "is_thumbnail": str(asset.id) == str(obj.thumbnail_asset_id),
                }
            )
        return CmsMediaAssetSerializer(items, many=True).data

    def get_lock(self, obj):
        """
        記事ロック情報を返す。
        """
        if obj.lock_token is None or obj.locked_by is None or obj.lock_expires_at is None:
            return None
        return CmsArticleSessionSerializer(
            {
                "article_id": obj.id,
                "lock_token": obj.lock_token,
                "locked_by_id": obj.locked_by_id,
                "locked_by": obj.locked_by,
                "lock_expires_at": obj.lock_expires_at,
            }
        ).data

    def _build_public_path(self, *, file_name: str) -> str:
        """
        メディア公開用相対パスを返す。
        """
        shard_a = file_name[:2]
        shard_b = file_name[2:4]
        return f"{settings.MEDIA_URL}images/{shard_a}/{shard_b}/{file_name}"


class CmsArticleMutationResponseSerializer(serializers.Serializer):
    """
    記事保存レスポンスを返す。
    """

    article = CmsArticleSerializer(read_only=True)
    postprocess_job = SystemAcceptedJobSerializer(read_only=True)


class CmsArticleListQuerySerializer(serializers.Serializer):
    """
    記事一覧クエリを検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )
    ordering = serializers.ChoiceField(
        choices=["newest", "oldest", "popular"],
        required=False,
        default="newest",
    )
    author = serializers.UUIDField(required=False)
    title = serializers.CharField(required=False, allow_blank=False, max_length=255)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, required=False)


class CmsPublishRequestCreateRequestSerializer(serializers.Serializer):
    """
    公開申請作成入力を検証する。
    """

    note = serializers.CharField(required=False, allow_blank=True)


class CmsPublishRequestRejectRequestSerializer(serializers.Serializer):
    """
    公開申請却下入力を検証する。
    """

    note = serializers.CharField(required=False, allow_blank=True)


class CmsPublishRequestSerializer(serializers.Serializer):
    """
    公開申請情報を返す。
    """

    id = serializers.UUIDField(read_only=True)
    article_id = serializers.UUIDField(read_only=True)
    article = CmsArticleSummarySerializer(read_only=True)
    requested_by_id = serializers.UUIDField(read_only=True)
    requested_by = CmsAuthorSummarySerializer(read_only=True)
    requested_at = serializers.DateTimeField(read_only=True)
    status = serializers.ChoiceField(choices=PublishRequestStatus.choices, read_only=True)
    handled_by_id = serializers.UUIDField(allow_null=True, read_only=True)
    handled_by = CmsAuthorSummarySerializer(allow_null=True, read_only=True)
    handled_at = serializers.DateTimeField(allow_null=True, read_only=True)
    note = serializers.CharField(allow_null=True, read_only=True)


class CmsPublishRequestListQuerySerializer(serializers.Serializer):
    """
    公開申請一覧クエリを検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )
    status = serializers.ChoiceField(choices=PublishRequestStatus.choices, required=False)


class CmsPublishRequestListSerializer(serializers.Serializer):
    """
    公開申請一覧レスポンスを返す。
    """

    items = CmsPublishRequestSerializer(many=True, read_only=True)
    pagination = CommonPaginationSerializer(read_only=True)


class CmsArticleSaveLogQuerySerializer(serializers.Serializer):
    """
    保存ログ検索条件を検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )
    article_id = serializers.UUIDField(required=False)
    request_user_id = serializers.UUIDField(required=False)
    occurred_at_from = serializers.DateTimeField(required=False)
    occurred_at_to = serializers.DateTimeField(required=False)
    lock_token = serializers.UUIDField(required=False)
    target = serializers.CharField(required=False, allow_blank=False)
    status = serializers.ChoiceField(choices=SaveLogStatus.choices, required=False)


class CmsArticleSaveLogSerializer(serializers.Serializer):
    """
    記事保存ログ要素を返す。
    """

    occurred_at = serializers.DateTimeField(read_only=True)
    article_id = serializers.UUIDField(allow_null=True, read_only=True)
    request_user_id = serializers.UUIDField(read_only=True)
    request_user = CmsAuthorSummarySerializer(read_only=True)
    lock_token = serializers.UUIDField(read_only=True)
    target = serializers.CharField(allow_null=True, read_only=True)
    status = serializers.ChoiceField(choices=SaveLogStatus.choices, read_only=True)
    message = serializers.CharField(allow_null=True, read_only=True)


class CmsArticleSaveLogListSerializer(serializers.Serializer):
    """
    記事保存ログ一覧レスポンスを返す。
    """

    items = CmsArticleSaveLogSerializer(many=True, read_only=True)
    pagination = CommonPaginationSerializer(read_only=True)


class CmsCategoryCreateRequestSerializer(serializers.Serializer):
    """
    カテゴリ作成入力を検証する。
    """

    name = serializers.CharField(max_length=100)
    parent_id = serializers.UUIDField(required=False, allow_null=True)


class CmsCategoryUpdateRequestSerializer(serializers.Serializer):
    """
    カテゴリ更新入力を検証する。
    """

    name = serializers.CharField(max_length=100)
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    ordered_sibling_category_ids = serializers.ListField(child=serializers.UUIDField())


class CmsCategoryDeleteRequestSerializer(serializers.Serializer):
    """
    カテゴリ削除入力を検証する。
    """

    parent_id = serializers.UUIDField(required=False, allow_null=True)
    ordered_sibling_category_ids = serializers.ListField(child=serializers.UUIDField())


class CmsCategoryNodeSerializer(serializers.Serializer):
    """
    カテゴリツリーノードを返す。
    """

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    slug = serializers.CharField(read_only=True)
    parent_id = serializers.UUIDField(allow_null=True, read_only=True)
    sort_order = serializers.IntegerField(read_only=True)
    children = serializers.SerializerMethodField()

    def get_children(self, obj) -> list:
        """
        子カテゴリノードを再帰的に返す。
        """
        return CmsCategoryNodeSerializer(obj.get("children", []), many=True).data


class CmsCategoryTreeSerializer(serializers.Serializer):
    """
    カテゴリツリー一覧レスポンスを返す。
    """

    items = CmsCategoryNodeSerializer(many=True, read_only=True)
