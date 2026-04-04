from django.apps import AppConfig


class PublicConfig(AppConfig):
    """
    公開APIアプリ設定。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "public"

