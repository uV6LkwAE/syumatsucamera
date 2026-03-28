"""
users アプリのシリアライザーを定義する。
"""
from django.conf import settings
from rest_framework import serializers

from users.models import UserRole


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
    role = serializers.ChoiceField(choices=UserRole.choices, read_only=True)
    is_active = serializers.BooleanField(read_only=True)


class UsersUserSummarySerializer(serializers.Serializer):
    """
    ユーザー要約情報を返すシリアライザー。
    """

    id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    display_name = serializers.CharField(allow_null=True, read_only=True)
    icon = serializers.CharField(allow_null=True, read_only=True)
    header_image = serializers.CharField(allow_null=True, read_only=True)
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


class RegistrationCompleteSerializer(serializers.Serializer):
    """
    本登録完了入力用シリアライザー。
    """

    display_name = serializers.CharField(max_length=100)
    icon = serializers.CharField(max_length=500)
    header_image = serializers.CharField(max_length=500)
    profile = serializers.CharField(max_length=300)
