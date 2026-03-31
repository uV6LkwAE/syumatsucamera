"""
cms アプリの管理画面設定を定義する。
"""
from django.contrib import admin

from cms.models import (
    Article,
    ArticleOption,
    ArticleOgpInfo,
    ArticlePublishRequest,
    ArticleSaveLog,
    Category,
    MediaAsset,
    Option,
    Tag,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    """
    カテゴリの管理画面設定。
    """

    list_display = ("name", "slug", "parent", "sort_order", "updated_at")
    search_fields = ("name", "slug")


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    """
    タグの管理画面設定。
    """

    list_display = ("name", "slug", "updated_at")
    search_fields = ("name", "slug")


@admin.register(Option)
class OptionAdmin(admin.ModelAdmin):
    """
    オプションの管理画面設定。
    """

    list_display = ("code", "label", "updated_at")
    search_fields = ("code", "label")


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    """
    記事の管理画面設定。
    """

    list_display = ("title", "category", "author", "status", "image_job_status", "updated_at")
    list_filter = ("status", "image_job_status", "twitter_card")
    search_fields = ("title", "slug", "summary")


@admin.register(MediaAsset)
class MediaAssetAdmin(admin.ModelAdmin):
    """
    メディアアセットの管理画面設定。
    """

    list_display = ("id", "article", "file_name", "updated_at")
    search_fields = ("file_name",)


@admin.register(ArticlePublishRequest)
class ArticlePublishRequestAdmin(admin.ModelAdmin):
    """
    公開申請の管理画面設定。
    """

    list_display = ("article", "requested_by", "status", "requested_at", "handled_at")
    list_filter = ("status",)


@admin.register(ArticleOgpInfo)
class ArticleOgpInfoAdmin(admin.ModelAdmin):
    """
    OGP キャッシュの管理画面設定。
    """

    list_display = ("article", "url", "site_name", "updated_at")
    search_fields = ("url", "title", "site_name")


@admin.register(ArticleSaveLog)
class ArticleSaveLogAdmin(admin.ModelAdmin):
    """
    保存ログの管理画面設定。
    """

    list_display = ("occurred_at", "request_user", "lock_token", "target", "status")
    list_filter = ("status",)
    search_fields = ("lock_token", "target", "message")


@admin.register(ArticleOption)
class ArticleOptionAdmin(admin.ModelAdmin):
    """
    記事オプションの管理画面設定。
    """

    list_display = ("article", "option", "created_at")
