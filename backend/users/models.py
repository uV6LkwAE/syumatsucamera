"""
users アプリのモデルを定義する。
"""
import uuid

from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from users.managers import UserManager


class UserRole(models.TextChoices):
    """
    CMS 利用者の role を表す。
    """

    ADMIN = "admin", "admin"
    AUTHOR = "author", "author"


class User(AbstractBaseUser, PermissionsMixin):
    """
    CMS 利用者を表すカスタムユーザー。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cf_access_sub = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        unique=True,
    )
    email = models.EmailField(max_length=255, unique=True)
    display_name = models.CharField(max_length=100, null=True, blank=True)
    profile = models.CharField(max_length=300, null=True, blank=True)
    icon = models.CharField(max_length=500, null=True, blank=True)
    header_image = models.CharField(max_length=500, null=True, blank=True)
    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.AUTHOR,
    )
    is_active = models.BooleanField(default=False)
    last_login = models.DateTimeField(
        null=True,
        blank=True,
        db_column="last_login_at",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    ACTIVE_REQUIRED_FIELDS = (
        "cf_access_sub",
        "display_name",
        "profile",
        "icon",
        "header_image",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="users_user_email_lower_unique",
            ),
            models.CheckConstraint(
                condition=Q(role__in=[UserRole.ADMIN, UserRole.AUTHOR]),
                name="users_user_role_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(is_active=False)
                    | (
                        Q(cf_access_sub__isnull=False)
                        & ~Q(cf_access_sub="")
                        & Q(display_name__isnull=False)
                        & ~Q(display_name="")
                        & Q(profile__isnull=False)
                        & ~Q(profile="")
                        & Q(icon__isnull=False)
                        & ~Q(icon="")
                        & Q(header_image__isnull=False)
                        & ~Q(header_image="")
                    )
                ),
                name="users_user_active_requires_registration_fields",
            ),
        ]
        ordering = ["email"]

    def clean(self):
        """
        モデルの整合性を検証する。
        """
        super().clean()

        self.email = User.objects.normalize_required_email(self.email)

        if self.display_name is not None:
            self.display_name = self.display_name.strip() or None

        if self.profile is not None:
            self.profile = self.profile.strip() or None

        if self.cf_access_sub is not None:
            self.cf_access_sub = self.cf_access_sub.strip() or None

        if self.icon is not None:
            self.icon = self.icon.strip() or None

        if self.header_image is not None:
            self.header_image = self.header_image.strip() or None

        if self.is_active:
            missing_fields = []
            for field_name in self.ACTIVE_REQUIRED_FIELDS:
                if getattr(self, field_name) is None:
                    missing_fields.append(field_name)

            if missing_fields:
                raise ValidationError(
                    {
                        field: "有効ユーザーにするには値が必要です。"
                        for field in missing_fields
                    }
                )

    @property
    def is_staff(self) -> bool:
        """
        Django admin 利用可否を返す。
        """
        return self.role == UserRole.ADMIN

    @property
    def last_login_at(self):
        """
        ER 図の last_login_at 名称で値を返す。
        """
        return self.last_login

    def get_full_name(self) -> str:
        """
        表示用の氏名を返す。
        """
        return self.display_name or self.email

    def get_short_name(self) -> str:
        """
        短縮表示名を返す。
        """
        return self.display_name or self.email

    def __str__(self) -> str:
        """
        管理画面向けの文字列表現を返す。
        """
        return self.display_name
