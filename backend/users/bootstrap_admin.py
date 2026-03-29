"""
初回管理者レコードを作成する ORM ユーティリティー。
"""
from dataclasses import dataclass

from django.db import transaction

from core.auth.cloudflare_access_subject import hash_cloudflare_access_sub
from users.models import User, UserRole


@dataclass(frozen=True)
class BootstrapAdminResult:
    """
    初回管理者作成結果を表す。
    """

    created: bool
    user: User


def _required_text(value: str, field_name: str) -> str:
    """
    必須文字列を検証して返す。
    """
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} は必須です。")
    return normalized


@transaction.atomic
def ensure_initial_admin(
    *,
    email: str,
    password: str,
    cf_access_sub: str,
    display_name: str,
    profile: str,
    icon: str,
    header_image: str,
) -> BootstrapAdminResult:
    """
    初回のみ管理者ユーザーを作成する。
    """
    normalized_email = User.objects.normalize_required_email(
        _required_text(email, "email")
    )
    normalized_password = _required_text(password, "password")
    normalized_sub = _required_text(cf_access_sub, "cf_access_sub")
    normalized_display_name = _required_text(display_name, "display_name")
    normalized_profile = _required_text(profile, "profile")
    normalized_icon = _required_text(icon, "icon")
    normalized_header_image = _required_text(header_image, "header_image")
    hashed_sub = hash_cloudflare_access_sub(normalized_sub)

    existing_admin = User.objects.filter(role=UserRole.ADMIN).order_by("created_at").first()
    if existing_admin is not None:
        return BootstrapAdminResult(created=False, user=existing_admin)

    created_user = User.objects.create_superuser(
        email=normalized_email,
        password=normalized_password,
        role=UserRole.ADMIN,
        is_active=True,
        cf_access_sub=hashed_sub,
        display_name=normalized_display_name,
        profile=normalized_profile,
        icon=normalized_icon,
        header_image=normalized_header_image,
    )
    return BootstrapAdminResult(created=True, user=created_user)