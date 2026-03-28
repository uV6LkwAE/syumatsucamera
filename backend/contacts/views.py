"""
contacts アプリのビューを定義する。
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet

from core.permissions.permissions import AdminOnlyReadWrite
from contacts.serializers import (
    ContactsCreateRequestSerializer,
    ContactsCreateResponseSerializer,
    ContactsListQuerySerializer,
    ContactsListResponseSerializer,
)
from contacts.services import create_contact, list_contacts, verify_turnstile_token


class ContactPublicCreateView(APIView):
    """
    公開問い合わせ作成API。
    """

    permission_classes = []

    def post(self, request):
        """
        問い合わせを作成する。
        """
        request_serializer = ContactsCreateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        validated = request_serializer.validated_data
        verified_turnstile = verify_turnstile_token(
            token=validated["turnstile_token"],
            remoteip=request.META.get("REMOTE_ADDR"),
        )

        contact = create_contact(
            subject_type=validated["subject_type"],
            company_name=validated.get("company_name", ""),
            person_name=validated["person_name"],
            email=validated["email"],
            body=validated["body"],
            turnstile_meta=verified_turnstile,
        )

        response_serializer = ContactsCreateResponseSerializer(
            {
                "id": contact.id,
                "message": "お問い合わせを受け付けました。",
            }
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class CmsContactsViewSet(ViewSet):
    """
    CMS 問い合わせ管理API。
    """

    permission_classes = [AdminOnlyReadWrite]

    def list(self, request):
        """
        問い合わせ一覧を返す。
        """
        query_serializer = ContactsListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        payload = list_contacts(
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
        )
        response_serializer = ContactsListResponseSerializer(payload)
        return Response(response_serializer.data)
