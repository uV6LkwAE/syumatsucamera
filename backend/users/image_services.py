"""
users アプリの画像保存ロジックを定義する。
"""
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from rest_framework.exceptions import ValidationError

from users.models import User


class UsersImageService:
    """
    users 画像の保存と削除を扱うサービス。
    """

    ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
    MAX_IMAGE_SIZE_BYTES = 1024 * 1024
    IMAGE_RULES = {
        "icon": {
            "request_field": "icon_file",
            "ratio_numerator": 1,
            "ratio_denominator": 1,
        },
        "header_image": {
            "request_field": "header_image_file",
            "ratio_numerator": 21,
            "ratio_denominator": 9,
        },
    }

    @staticmethod
    def _get_media_root() -> Path:
        """
        media ルートディレクトリを返す。
        """
        media_root = Path(settings.BASE_DIR) / "media"
        media_root.mkdir(parents=True, exist_ok=True)
        return media_root

    @staticmethod
    def _get_extension_or_raise(*, uploaded_file: UploadedFile, request_field: str) -> str:
        """
        許可拡張子を検証して返す。
        """
        extension = Path(uploaded_file.name).suffix.lower().lstrip(".")
        if extension not in UsersImageService.ALLOWED_IMAGE_EXTENSIONS:
            raise ValidationError(
                {
                    request_field: [
                        "対応していない画像形式です。jpg/jpeg/png/webp を使用してください。"
                    ]
                }
            )
        return extension

    @staticmethod
    def _validate_image_size_or_raise(*, uploaded_file: UploadedFile, request_field: str) -> None:
        """
        画像サイズ上限を検証する。
        """
        if uploaded_file.size > UsersImageService.MAX_IMAGE_SIZE_BYTES:
            raise ValidationError(
                {
                    request_field: [
                        "画像サイズは 1MB 以下である必要があります。"
                    ]
                }
            )

    @staticmethod
    def _validate_image_ratio_or_raise(
        *,
        uploaded_file: UploadedFile,
        request_field: str,
        ratio_numerator: int,
        ratio_denominator: int,
    ) -> None:
        """
        画像アスペクト比を検証する。
        """
        try:
            uploaded_file.seek(0)
            with Image.open(uploaded_file) as image:
                width, height = image.size
        except (UnidentifiedImageError, OSError) as exc:
            raise ValidationError(
                {request_field: ["画像を読み取れません。"]}
            ) from exc
        finally:
            uploaded_file.seek(0)

        if width <= 0 or height <= 0:
            raise ValidationError({request_field: ["画像サイズが不正です。"]})

        if width * ratio_denominator != height * ratio_numerator:
            raise ValidationError(
                {
                    request_field: [
                        (
                            "画像のアスペクト比が不正です。"
                            f"{ratio_numerator}:{ratio_denominator} の画像を指定してください。"
                        )
                    ]
                }
            )

    @staticmethod
    def _validate_image_file_or_raise(
        *,
        uploaded_file: UploadedFile,
        field_name: str,
    ) -> str:
        """
        画像ファイルの形式・容量・比率を検証し拡張子を返す。
        """
        rule = UsersImageService.IMAGE_RULES.get(field_name)
        if rule is None:
            raise ValidationError({"detail": "画像保存対象フィールドが不正です。"})

        request_field = rule["request_field"]
        extension = UsersImageService._get_extension_or_raise(
            uploaded_file=uploaded_file,
            request_field=request_field,
        )
        UsersImageService._validate_image_size_or_raise(
            uploaded_file=uploaded_file,
            request_field=request_field,
        )
        UsersImageService._validate_image_ratio_or_raise(
            uploaded_file=uploaded_file,
            request_field=request_field,
            ratio_numerator=rule["ratio_numerator"],
            ratio_denominator=rule["ratio_denominator"],
        )
        return extension

    @staticmethod
    def save_user_image_file(
        *,
        user: User,
        uploaded_file: UploadedFile,
        field_name: str,
    ) -> str:
        """
        ユーザー画像を保存して公開用相対パスを返す。
        """
        extension = UsersImageService._validate_image_file_or_raise(
            uploaded_file=uploaded_file,
            field_name=field_name,
        )
        target_dir = (
            UsersImageService._get_media_root()
            / "users"
            / str(user.id)
            / field_name
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        target_name = f"{uuid4()}.{extension}"
        target_path = target_dir / target_name

        uploaded_file.seek(0)
        with target_path.open("wb") as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)

        return f"/media/users/{user.id}/{field_name}/{target_name}"

    @staticmethod
    def _to_absolute_media_path(stored_path: str | None) -> Path | None:
        """
        保存済み相対パスを media 配下の絶対パスへ変換する。
        """
        if stored_path is None:
            return None
        if not stored_path.startswith("/media/"):
            return None

        media_root = UsersImageService._get_media_root().resolve()
        candidate = (media_root / stored_path.removeprefix("/media/")).resolve()

        try:
            candidate.relative_to(media_root)
        except ValueError:
            return None
        return candidate

    @staticmethod
    def delete_media_file(stored_path: str | None) -> None:
        """
        保存済み画像ファイルを削除する。
        """
        target_path = UsersImageService._to_absolute_media_path(stored_path)
        if target_path is None:
            return
        if target_path.exists():
            target_path.unlink()
