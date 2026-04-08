"""
cms アプリのモデルを定義する。
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from mptt.models import MPTTModel, TreeForeignKey

from users.models import User


ARTICLE_TAG_MAX_COUNT = 5


class ArticleStatus(models.TextChoices):
    """
    記事公開状態。
    """

    DRAFT = "draft", "下書き"
    PUBLISH = "publish", "公開"
    PRIVATE = "private", "非公開"


class TwitterCardType(models.TextChoices):
    """
    Twitter Card 種別。
    """

    SUMMARY = "summary", "summary"
    SUMMARY_LARGE_IMAGE = "summary_large_image", "summary_large_image"


class ImageJobStatus(models.TextChoices):
    """
    画像後処理ジョブ状態。
    """

    PENDING = "pending", "処理待ち"
    PROCESSING = "processing", "処理中"
    COMPLETED = "completed", "完了"
    FAILED = "failed", "失敗"


class PublishRequestStatus(models.TextChoices):
    """
    公開申請状態。
    """

    PENDING = "pending", "申請中"
    APPROVED = "approved", "承認"
    REJECTED = "rejected", "却下"


class SaveLogStatus(models.TextChoices):
    """
    保存ログ状態。
    """

    FAILED = "failed", "失敗"
    STARTED = "started", "開始"
    COMPLETED = "completed", "完了"


class OptionCode(models.TextChoices):
    """
    記事オプションコード。
    """

    PR = "pr", "PR"
    AD = "ad", "AD"


class Category(MPTTModel):
    """
    記事カテゴリを保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, verbose_name="カテゴリ名")
    slug = models.SlugField(max_length=120, unique=True, allow_unicode=True, verbose_name="slug")
    parent = TreeForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="children",
        verbose_name="親カテゴリ",
    )
    sort_order = models.PositiveIntegerField(default=0, verbose_name="表示順")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name = "カテゴリ"
        verbose_name_plural = "カテゴリ"

    class MPTTMeta:
        """
        MPTT 挿入順を定義する。
        """

        order_insertion_by = ["sort_order", "name"]

    @property
    def path(self) -> str:
        """
        公開カテゴリURLを返す。
        """
        return f"/category/{self.slug}/"

    def __str__(self) -> str:
        """
        管理画面向けの文字列表現を返す。
        """
        return self.name


class Tag(models.Model):
    """
    記事タグを保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, verbose_name="タグ名")
    slug = models.SlugField(max_length=120, unique=True, allow_unicode=True, verbose_name="slug")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        ordering = ["name"]
        verbose_name = "タグ"
        verbose_name_plural = "タグ"
        indexes = [
            models.Index(Lower("name"), name="cms_tag_lower_name_idx"),
        ]

    def __str__(self) -> str:
        """
        管理画面向けの文字列表現を返す。
        """
        return self.name


class Option(models.Model):
    """
    記事オプション定義を保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=64, unique=True, verbose_name="コード")
    label = models.CharField(max_length=100, verbose_name="表示名")
    default_text = models.TextField(null=True, blank=True, verbose_name="既定文言")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        ordering = ["code"]
        verbose_name = "オプション"
        verbose_name_plural = "オプション"

    def __str__(self) -> str:
        """
        管理画面向けの文字列表現を返す。
        """
        return self.label


class Article(models.Model):
    """
    CMS 記事を保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="articles",
        verbose_name="カテゴリ",
    )
    author = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="articles",
        verbose_name="執筆者",
    )
    title = models.CharField(max_length=255, verbose_name="タイトル")
    slug = models.SlugField(max_length=500, allow_unicode=True, verbose_name="slug")
    summary = models.CharField(max_length=200, verbose_name="要約")
    body_html = models.TextField(verbose_name="本文HTML")
    status = models.CharField(
        max_length=20,
        choices=ArticleStatus.choices,
        default=ArticleStatus.DRAFT,
        verbose_name="公開状態",
    )
    twitter_card = models.CharField(
        max_length=30,
        choices=TwitterCardType.choices,
        default=TwitterCardType.SUMMARY_LARGE_IMAGE,
        verbose_name="Twitter Card種別",
    )
    published_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="公開日時",
    )
    views_total = models.PositiveBigIntegerField(default=0, verbose_name="累計PV")
    thumbnail_asset = models.ForeignKey(
        "MediaAsset",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
        verbose_name="サムネイルアセット",
    )
    toc_json = models.JSONField(default=list, blank=True, verbose_name="目次JSON")
    locked_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="locked_articles",
        verbose_name="ロック中ユーザー",
    )
    locked_at = models.DateTimeField(null=True, blank=True, verbose_name="ロック取得日時")
    lock_token = models.UUIDField(null=True, blank=True, verbose_name="ロックトークン")
    lock_expires_at = models.DateTimeField(null=True, blank=True, verbose_name="ロック有効期限")
    image_job_status = models.CharField(
        max_length=20,
        choices=ImageJobStatus.choices,
        default=ImageJobStatus.PENDING,
        verbose_name="画像処理状態",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    tags = models.ManyToManyField(
        Tag,
        through="ArticleTag",
        related_name="articles",
        verbose_name="タグ",
    )
    options = models.ManyToManyField(
        Option,
        through="ArticleOption",
        related_name="articles",
        verbose_name="記事オプション",
    )

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "記事"
        verbose_name_plural = "記事"
        constraints = [
            models.UniqueConstraint(
                fields=["category", "slug"],
                name="cms_article_category_slug_unique",
            ),
        ]

    @property
    def path(self) -> str:
        """
        公開記事URLを返す。
        """
        return f"/articles/{self.category.slug}/{self.slug}/"

    def __str__(self) -> str:
        """
        管理画面向けの文字列表現を返す。
        """
        return self.title


class ArticleTag(models.Model):
    """
    記事とタグの中間テーブル。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="article_tags",
        verbose_name="記事",
    )
    tag = models.ForeignKey(
        Tag,
        on_delete=models.CASCADE,
        related_name="article_tags",
        verbose_name="タグ",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")

    class Meta:
        verbose_name = "記事タグ"
        verbose_name_plural = "記事タグ"
        indexes = [
            models.Index(fields=["tag", "article"], name="cms_arttag_tag_article_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["article", "tag"],
                name="cms_article_tag_unique",
            )
        ]

    def clean(self):
        """
        1記事あたりのタグ件数を検証する。
        """
        super().clean()
        if self.article_id is None:
            return

        existing_tags = ArticleTag.objects.filter(article_id=self.article_id)
        if self.pk is not None:
            existing_tags = existing_tags.exclude(pk=self.pk)
        if existing_tags.count() >= ARTICLE_TAG_MAX_COUNT:
            raise ValidationError({"article": f"タグは1記事あたり{ARTICLE_TAG_MAX_COUNT}件までです。"})

    def save(self, *args, **kwargs):
        """
        直接保存時にもタグ件数を検証する。
        """
        self.full_clean()
        return super().save(*args, **kwargs)


class ArticleOption(models.Model):
    """
    記事とオプションの中間テーブル。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="article_options",
        verbose_name="記事",
    )
    option = models.ForeignKey(
        Option,
        on_delete=models.CASCADE,
        related_name="article_options",
        verbose_name="オプション",
    )
    override_text = models.TextField(null=True, blank=True, verbose_name="上書き文言")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")

    class Meta:
        verbose_name = "記事オプション"
        verbose_name_plural = "記事オプション"
        constraints = [
            models.UniqueConstraint(
                fields=["article", "option"],
                name="cms_article_option_unique",
            )
        ]


class MediaAsset(models.Model):
    """
    記事画像メタ情報を保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="media_assets",
        verbose_name="記事",
    )
    file_name = models.CharField(max_length=255, unique=True, verbose_name="ファイル名")
    width = models.PositiveIntegerField(default=1, verbose_name="横幅")
    height = models.PositiveIntegerField(default=1, verbose_name="高さ")
    checksum_sha256 = models.CharField(max_length=64, blank=True, verbose_name="SHA256")
    exif_json = models.JSONField(null=True, blank=True, verbose_name="EXIF")
    processing_options_json = models.JSONField(
        null=True,
        blank=True,
        verbose_name="処理オプション",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        ordering = ["created_at"]
        verbose_name = "メディアアセット"
        verbose_name_plural = "メディアアセット"


class ArticlePublishRequest(models.Model):
    """
    記事公開申請を保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="publish_requests",
        verbose_name="記事",
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="article_publish_requests",
        verbose_name="申請者",
    )
    requested_at = models.DateTimeField(auto_now_add=True, verbose_name="申請日時")
    status = models.CharField(
        max_length=20,
        choices=PublishRequestStatus.choices,
        default=PublishRequestStatus.PENDING,
        verbose_name="状態",
    )
    handled_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="handled_article_publish_requests",
        verbose_name="対応者",
    )
    handled_at = models.DateTimeField(null=True, blank=True, verbose_name="対応日時")
    note = models.TextField(null=True, blank=True, verbose_name="メモ")

    class Meta:
        ordering = ["-requested_at"]
        verbose_name = "公開申請"
        verbose_name_plural = "公開申請"


class ArticleOgpInfo(models.Model):
    """
    記事本文リンクの OGP キャッシュを保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="ogp_infos",
        verbose_name="記事",
    )
    url = models.TextField(verbose_name="URL")
    title = models.TextField(null=True, blank=True, verbose_name="タイトル")
    summary = models.TextField(null=True, blank=True, verbose_name="概要")
    thumbnail = models.TextField(null=True, blank=True, verbose_name="サムネイルURL")
    site_name = models.TextField(null=True, blank=True, verbose_name="サイト名")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        ordering = ["url"]
        verbose_name = "記事OGPキャッシュ"
        verbose_name_plural = "記事OGPキャッシュ"
        constraints = [
            models.UniqueConstraint(
                fields=["article", "url"],
                name="cms_article_ogp_info_article_url_unique",
            )
        ]


class ArticleSaveLog(models.Model):
    """
    記事保存フロー監査ログを保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    occurred_at = models.DateTimeField(auto_now_add=True, verbose_name="発生日時")
    request_user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="article_save_logs",
        verbose_name="実行ユーザー",
    )
    article = models.ForeignKey(
        Article,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="save_logs",
        verbose_name="記事",
    )
    lock_token = models.UUIDField(verbose_name="ロックトークン")
    target = models.CharField(max_length=255, null=True, blank=True, verbose_name="対象")
    status = models.CharField(
        max_length=20,
        choices=SaveLogStatus.choices,
        verbose_name="状態",
    )
    message = models.TextField(null=True, blank=True, verbose_name="メッセージ")

    class Meta:
        ordering = ["-occurred_at"]
        verbose_name = "記事保存ログ"
        verbose_name_plural = "記事保存ログ"
