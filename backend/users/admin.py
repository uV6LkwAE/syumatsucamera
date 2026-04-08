"""
users アプリの管理画面設定を定義する。
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from users.models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    """
    User モデルの管理画面設定。
    """

    ordering = ("email",)
    list_display = (
        "email",
        "display_name",
        "role",
        "is_active",
        "is_superuser",
        "updated_at",
    )
    search_fields = ("email", "display_name", "cf_access_sub")
    list_filter = ("role", "is_active", "is_superuser", "groups")
    readonly_fields = ("created_at", "updated_at", "last_login")
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "email",
                    "password",
                    "role",
                    "is_active",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        (
            "Profile",
            {
                "fields": (
                    "cf_access_sub",
                    "display_name",
                    "profile",
                    "icon",
                    "header_image",
                    "x_url",
                    "instagram_url",
                    "website_url",
                    "last_login",
                )
            },
        ),
        (
            "Timestamps",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "password1",
                    "password2",
                    "role",
                    "is_active",
                ),
            },
        ),
    )
