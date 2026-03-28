"""
contacts アプリのシリアライザーを定義する。
"""
from django.conf import settings
from rest_framework import serializers

from contacts.models import Contact, ContactSubjectType


class ContactsCreateRequestSerializer(serializers.Serializer):
    """
    公開問い合わせ作成リクエストを検証する。
    """

    subject_type = serializers.ChoiceField(choices=ContactSubjectType.choices)
    company_name = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
    )
    person_name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    body = serializers.CharField()
    turnstile_token = serializers.CharField()


class ContactsCreateResponseSerializer(serializers.Serializer):
    """
    公開問い合わせ作成レスポンスを返す。
    """

    id = serializers.UUIDField(read_only=True)
    message = serializers.CharField(read_only=True)


class ContactsListQuerySerializer(serializers.Serializer):
    """
    問い合わせ一覧クエリを検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )


class ContactsContactSerializer(serializers.Serializer):
    """
    問い合わせ要素を返す。
    """

    id = serializers.UUIDField(read_only=True)
    subject_type = serializers.ChoiceField(choices=ContactSubjectType.choices, read_only=True)
    company_name = serializers.CharField(read_only=True)
    person_name = serializers.CharField(read_only=True)
    email = serializers.EmailField(read_only=True)
    body = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)


class ContactsPaginationSerializer(serializers.Serializer):
    """
    一覧ページ情報を返す。
    """

    page = serializers.IntegerField(read_only=True)
    page_size = serializers.IntegerField(read_only=True)
    total_count = serializers.IntegerField(read_only=True)
    total_pages = serializers.IntegerField(read_only=True)


class ContactsListResponseSerializer(serializers.Serializer):
    """
    問い合わせ一覧レスポンスを返す。
    """

    items = ContactsContactSerializer(many=True, read_only=True)
    pagination = ContactsPaginationSerializer(read_only=True)


class ContactModelSerializer(serializers.ModelSerializer):
    """
    Contact モデル入出力に使用する。
    """

    class Meta:
        model = Contact
        fields = [
            "id",
            "subject_type",
            "company_name",
            "person_name",
            "email",
            "body",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
