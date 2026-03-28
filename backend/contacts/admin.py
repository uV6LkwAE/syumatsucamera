"""
contacts アプリの管理画面設定を定義する。
"""
from django.contrib import admin

from contacts.models import Contact


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    """
    Contact モデルの管理画面。
    """

    list_display = (
        "id",
        "subject_type",
        "person_name",
        "email",
        "created_at",
    )
    search_fields = ("person_name", "email", "company_name", "body")
    list_filter = ("subject_type", "created_at")
    readonly_fields = ("id", "created_at")
