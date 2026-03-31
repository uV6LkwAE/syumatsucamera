"""
cms アプリの設定を定義する。
"""
from django.apps import AppConfig


class CmsConfig(AppConfig):
    """
    cms アプリ設定。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "cms"
