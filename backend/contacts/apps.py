"""
contacts アプリ設定を定義する。
"""
from django.apps import AppConfig


class ContactsConfig(AppConfig):
    """
    contacts アプリの設定。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "contacts"
