"""
users アプリの業務ロジックを定義する。
"""
from typing import Any

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from core.auth.cloudflare_access_verifier import (
    CloudflareAccessPrincipal,
    issue_development_access_token,
)
from core.auth.cloudflare_access_subject import hash_cloudflare_access_sub
from users.image_services import UsersImageService
from users.models import User, UserRole


class UsersService:
    """
    users アプリの業務ロジックをまとめて扱うサービス。
    """

    @staticmethod
    def issue_development_access_token() -> dict[str, Any]:
        """
        開発用の Access JWT を発行する。
        """
        if not settings.DEBUG:
            raise NotFound("対象リソースが存在しません。")

        user = (
            User.objects.filter(
                role=UserRole.ADMIN,
                is_active=True,
            )
            .order_by("created_at")
            .first()
        )
        if user is None or user.cf_access_sub is None:
            raise NotFound("開発用JWTを発行できる有効ユーザーが存在しません。")

        development_sub = settings.DEV_ACCESS_JWT_SUB.strip()
        if development_sub == "":
            raise NotFound("開発用JWTのsubが設定されていません。")

        if user.cf_access_sub != hash_cloudflare_access_sub(development_sub):
            raise NotFound("開発用JWTのsub設定が管理者ユーザーと一致しません。")

        token, expires_at = issue_development_access_token(
            sub=development_sub,
            email=user.email,
        )
        return {
            "token_type": "Bearer",
            "token": token,
            "expires_at": expires_at,
            "email": user.email,
            "sub": development_sub,
        }

    @staticmethod
    def list_users(*, limit: int) -> list[User]:
        """
        ユーザー一覧を上限件数付きで返す。
        """
        return list(User.objects.all()[:limit])

    @staticmethod
    @transaction.atomic
    def create_provisional_user(
        *,
        email: str,
        role: str,
        icon_file: UploadedFile | None = None,
        header_image_file: UploadedFile | None = None,
    ) -> User:
        """
        仮登録ユーザーを作成する。
        """
        normalized_email = User.objects.normalize_required_email(email)
        try:
            user = User.objects.create_user(
                email=normalized_email,
                role=role,
                is_active=False,
            )
            created_paths: list[str] = []
            update_fields: list[str] = []
            if icon_file is not None:
                user.icon = UsersImageService.save_user_image_file(
                    user=user,
                    uploaded_file=icon_file,
                    field_name="icon",
                )
                created_paths.append(user.icon)
                update_fields.append("icon")
            if header_image_file is not None:
                user.header_image = UsersImageService.save_user_image_file(
                    user=user,
                    uploaded_file=header_image_file,
                    field_name="header_image",
                )
                created_paths.append(user.header_image)
                update_fields.append("header_image")

            if update_fields:
                user.full_clean()
                user.save(update_fields=[*update_fields, "updated_at"])
            return user
        except ValidationError as exc:
            if "created_paths" in locals():
                for saved_path in created_paths:
                    UsersImageService.delete_media_file(saved_path)
            raise exc
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        except IntegrityError as exc:
            raise ValidationError({"email": ["このメールアドレスはすでに登録されています。"]}) from exc
        except DjangoValidationError as exc:
            if "created_paths" in locals():
                for saved_path in created_paths:
                    UsersImageService.delete_media_file(saved_path)
            if hasattr(exc, "message_dict"):
                raise ValidationError(exc.message_dict) from exc
            raise ValidationError(exc.messages) from exc

    @staticmethod
    @transaction.atomic
    def update_user_by_admin(
        *,
        user: User,
        display_name: str,
        profile: str,
        meta: dict[str, str],
        role: str,
        is_active: bool,
        icon: str | None,
        header_image: str | None,
        icon_file: UploadedFile | None = None,
        header_image_file: UploadedFile | None = None,
    ) -> User:
        """
        管理者によるユーザー更新を実行する。
        """
        old_icon = user.icon
        old_header_image = user.header_image
        next_icon = icon
        next_header_image = header_image

        created_paths: list[str] = []

        try:
            if icon_file is not None:
                next_icon = UsersImageService.save_user_image_file(
                    user=user,
                    uploaded_file=icon_file,
                    field_name="icon",
                )
                created_paths.append(next_icon)

            if header_image_file is not None:
                next_header_image = UsersImageService.save_user_image_file(
                    user=user,
                    uploaded_file=header_image_file,
                    field_name="header_image",
                )
                created_paths.append(next_header_image)

            user.display_name = display_name
            user.profile = profile
            user.meta = meta
            user.role = role
            user.is_active = is_active
            user.icon = next_icon
            user.header_image = next_header_image

            user.full_clean()
            user.save(
                update_fields=[
                    "display_name",
                    "profile",
                    "meta",
                    "role",
                    "is_active",
                    "icon",
                    "header_image",
                    "updated_at",
                ]
            )
        except ValidationError as exc:
            for saved_path in created_paths:
                UsersImageService.delete_media_file(saved_path)
            raise exc
        except IntegrityError as exc:
            for saved_path in created_paths:
                UsersImageService.delete_media_file(saved_path)
            raise ValidationError("ユーザーの更新に失敗しました。") from exc
        except DjangoValidationError as exc:
            for saved_path in created_paths:
                UsersImageService.delete_media_file(saved_path)
            if hasattr(exc, "message_dict"):
                raise ValidationError(exc.message_dict) from exc
            raise ValidationError(exc.messages) from exc

        if old_icon != user.icon:
            UsersImageService.delete_media_file(old_icon)
        if old_header_image != user.header_image:
            UsersImageService.delete_media_file(old_header_image)

        return user

    @staticmethod
    def build_activation_issue_response(*, user: User) -> dict:
        """
        招待URL発行レスポンスを生成する。
        """
        return {
            "user_id": user.id,
            "email": user.email,
            "role": user.role,
            "activate_path": f"/users/activate/{user.id}",
        }

    @staticmethod
    def get_activation_user(*, user_id, principal: CloudflareAccessPrincipal) -> User:
        """
        本登録対象の仮登録ユーザーを返す。
        """
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist as exc:
            raise NotFound("本登録対象ユーザーが存在しません。") from exc

        if user.is_active:
            raise NotFound("本登録対象ユーザーが存在しません。")

        normalized_email = User.objects.normalize_required_email(principal.email)
        if user.email != normalized_email:
            raise NotFound("本登録対象ユーザーが存在しません。")

        return user

    @staticmethod
    @transaction.atomic
    def complete_activation(
        *,
        user: User,
        principal: CloudflareAccessPrincipal,
        display_name: str,
        profile: str,
        icon: str | None,
        header_image: str | None,
    ) -> User:
        """
        仮登録ユーザーの本登録を完了する。
        """
        if user.is_active:
            raise ValidationError("このユーザーはすでに本登録済みです。")

        normalized_email = User.objects.normalize_required_email(principal.email)
        if user.email != normalized_email:
            raise ValidationError("本登録対象ユーザーのメールアドレスが一致しません。")

        user.cf_access_sub = hash_cloudflare_access_sub(principal.sub)
        user.display_name = display_name
        user.profile = profile
        user.icon = icon
        user.header_image = header_image
        user.is_active = True
        user.last_login = timezone.now()
        try:
            user.full_clean()
            user.save(
                update_fields=[
                    "cf_access_sub",
                    "display_name",
                    "profile",
                    "icon",
                    "header_image",
                    "is_active",
                    "last_login",
                    "updated_at",
                ]
            )
        except DjangoValidationError as exc:
            if hasattr(exc, "message_dict"):
                raise ValidationError(exc.message_dict) from exc
            raise ValidationError(exc.messages) from exc

        return user
