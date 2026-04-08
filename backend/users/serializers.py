"""
users アプリのシリアライザーを定義する。
"""
import json

from django.conf import settings
from rest_framework import serializers

from users.models import User, UserRole

USER_META_MAX_ITEMS = 20
USER_META_KEY_MAX_LENGTH = 50
USER_META_VALUE_MAX_LENGTH = 300


class UsersListQuerySerializer(serializers.Serializer):
    """
    ユーザー一覧のクエリパラメータを検証する。
    """

    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )


class UsersSessionUserSerializer(serializers.Serializer):
    """
    セッション中ユーザー情報を返すシリアライザー。
    """

    id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    display_name = serializers.CharField(allow_null=True, read_only=True)
    icon = serializers.CharField(allow_null=True, read_only=True)
    header_image = serializers.CharField(allow_null=True, read_only=True)
    profile = serializers.CharField(allow_null=True, read_only=True)
    x_url = serializers.CharField(allow_null=True, read_only=True)
    instagram_url = serializers.CharField(allow_null=True, read_only=True)
    website_url = serializers.CharField(allow_null=True, read_only=True)
    meta = serializers.DictField(
        child=serializers.CharField(),
        read_only=True,
    )
    meta_help_text = serializers.SerializerMethodField()
    role = serializers.ChoiceField(choices=UserRole.choices, read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    def get_meta_help_text(self, _obj) -> str:
        """
        meta の入力補助テキストを返す。
        """
        return str(User._meta.get_field("meta").help_text)


class UsersDevelopmentAccessTokenSerializer(serializers.Serializer):
    """
    開発用 Access JWT 発行レスポンスのシリアライザー。
    """

    token_type = serializers.CharField(read_only=True)
    token = serializers.CharField(read_only=True)
    expires_at = serializers.DateTimeField(read_only=True)
    email = serializers.EmailField(read_only=True)
    sub = serializers.CharField(read_only=True)


class UsersUserSummarySerializer(serializers.Serializer):
    """
    ユーザー要約情報を返すシリアライザー。
    """

    id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    display_name = serializers.CharField(allow_null=True, read_only=True)
    icon = serializers.CharField(allow_null=True, read_only=True)
    header_image = serializers.CharField(allow_null=True, read_only=True)
    x_url = serializers.CharField(allow_null=True, read_only=True)
    instagram_url = serializers.CharField(allow_null=True, read_only=True)
    website_url = serializers.CharField(allow_null=True, read_only=True)
    meta = serializers.DictField(
        child=serializers.CharField(),
        read_only=True,
    )
    role = serializers.ChoiceField(choices=UserRole.choices, read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    last_login_at = serializers.DateTimeField(
        source="last_login",
        allow_null=True,
        read_only=True,
    )


class UsersUserSerializer(UsersUserSummarySerializer):
    """
    ユーザー詳細情報を返すシリアライザー。
    """

    profile = serializers.CharField(allow_null=True, read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class UsersUserListSerializer(serializers.Serializer):
    """
    ユーザー一覧レスポンスのシリアライザー。
    """

    items = UsersUserSummarySerializer(many=True, read_only=True)


class UsersProvisionCreateRequestSerializer(serializers.Serializer):
    """
    仮登録ユーザー作成リクエストのシリアライザー。
    """

    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=UserRole.choices)
    icon_file = serializers.ImageField(
        required=False,
        allow_empty_file=False,
        write_only=True,
    )
    header_image_file = serializers.ImageField(
        required=False,
        allow_empty_file=False,
        write_only=True,
    )


class UsersUserUpdateRequestSerializer(serializers.Serializer):
    """
    ユーザー更新リクエストのシリアライザー。
    """

    display_name = serializers.CharField(max_length=100)
    icon = serializers.CharField(
        max_length=500,
        allow_null=True,
        required=False,
    )
    icon_file = serializers.ImageField(
        required=False,
        allow_empty_file=False,
        write_only=True,
    )
    header_image = serializers.CharField(
        max_length=500,
        allow_null=True,
        required=False,
    )
    header_image_file = serializers.ImageField(
        required=False,
        allow_empty_file=False,
        write_only=True,
    )
    profile = serializers.CharField(max_length=300)
    x_url = serializers.URLField(
        max_length=500,
        allow_blank=True,
        allow_null=True,
        required=False,
    )
    instagram_url = serializers.URLField(
        max_length=500,
        allow_blank=True,
        allow_null=True,
        required=False,
    )
    website_url = serializers.URLField(
        max_length=500,
        allow_blank=True,
        allow_null=True,
        required=False,
    )
    meta = serializers.JSONField(required=False)
    role = serializers.ChoiceField(choices=UserRole.choices)
    is_active = serializers.BooleanField()

    def validate(self, attrs):
        """
        同じ用途の path と file が同時指定されていないか検証する。
        """
        if "icon" in attrs and "icon_file" in attrs:
            raise serializers.ValidationError(
                {"icon_file": ["icon と icon_file は同時に指定できません。"]}
            )
        if "header_image" in attrs and "header_image_file" in attrs:
            raise serializers.ValidationError(
                {
                    "header_image_file": [
                        "header_image と header_image_file は同時に指定できません。"
                    ]
                }
            )
        return attrs

    def validate_meta(self, value):
        """
        ユーザーメタ情報のキー/値形式を検証する。
        """
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError(
                    "meta はJSONオブジェクト文字列で指定してください。"
                ) from exc
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("meta はオブジェクト形式で指定してください。")
        if len(value) > USER_META_MAX_ITEMS:
            raise serializers.ValidationError(
                f"meta は最大{USER_META_MAX_ITEMS}件まで指定できます。"
            )

        normalized: dict[str, str] = {}
        for raw_key, raw_value in value.items():
            if not isinstance(raw_key, str):
                raise serializers.ValidationError("meta のキーは文字列で指定してください。")

            key = raw_key.strip()
            if key == "":
                raise serializers.ValidationError("meta のキーは空文字にできません。")
            if len(key) > USER_META_KEY_MAX_LENGTH:
                raise serializers.ValidationError(
                    f"meta のキーは{USER_META_KEY_MAX_LENGTH}文字以内で指定してください。"
                )
            if key in normalized:
                raise serializers.ValidationError("meta のキーが重複しています。")

            if not isinstance(raw_value, str):
                raise serializers.ValidationError("meta の値は文字列で指定してください。")
            value_text = raw_value.strip()
            if value_text == "":
                raise serializers.ValidationError("meta の値は空文字にできません。")
            if len(value_text) > USER_META_VALUE_MAX_LENGTH:
                raise serializers.ValidationError(
                    f"meta の値は{USER_META_VALUE_MAX_LENGTH}文字以内で指定してください。"
                )
            normalized[key] = value_text

        return normalized


class UsersActivationIssueResponseSerializer(serializers.Serializer):
    """
    招待URL発行レスポンスのシリアライザー。
    """

    user_id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    role = serializers.ChoiceField(choices=UserRole.choices, read_only=True)
    activate_path = serializers.CharField(read_only=True)


class ActivationUserDetailSerializer(serializers.Serializer):
    """
    本登録対象ユーザー情報の返却用シリアライザー。
    """

    user_id = serializers.UUIDField(source="id", read_only=True)
    email = serializers.EmailField(read_only=True)
    role = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    display_name = serializers.CharField(allow_null=True, read_only=True)
    icon = serializers.CharField(allow_null=True, read_only=True)
    header_image = serializers.CharField(allow_null=True, read_only=True)
    profile = serializers.CharField(allow_null=True, read_only=True)
    x_url = serializers.CharField(allow_null=True, read_only=True)
    instagram_url = serializers.CharField(allow_null=True, read_only=True)
    website_url = serializers.CharField(allow_null=True, read_only=True)
    meta = serializers.DictField(
        child=serializers.CharField(),
        read_only=True,
    )


class RegistrationCompleteSerializer(serializers.Serializer):
    """
    本登録完了入力用シリアライザー。
    """

    display_name = serializers.CharField(max_length=100)
    icon = serializers.CharField(max_length=500)
    header_image = serializers.CharField(max_length=500)
    profile = serializers.CharField(max_length=300)
