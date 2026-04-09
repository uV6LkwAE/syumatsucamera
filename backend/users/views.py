"""
users アプリの view を定義する。
"""
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotAuthenticated, NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet
from rest_framework.views import APIView

from core.permissions.permissions import (
    AdminOnlyReadWrite,
    AuthorAdminReadWrite,
    SelfActivationPermission,
)
from users.models import User
from users.serializers import (
    ActivationUserDetailSerializer,
    RegistrationCompleteSerializer,
    UsersActivationIssueResponseSerializer,
    UsersDevelopmentAccessTokenSerializer,
    UsersListQuerySerializer,
    UsersProvisionCreateRequestSerializer,
    UsersSessionProfileUpdateRequestSerializer,
    UsersSessionUserSerializer,
    UsersUserListSerializer,
    UsersUserSerializer,
    UsersUserUpdateRequestSerializer,
)
from users.services import UsersService


class UsersViewSet(ViewSet):
    """
    users API の一覧/詳細/作成/更新/招待/セッション情報を扱う。
    """

    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def get_permissions(self):
        """
        action ごとに permission_classes を切り替える。
        """
        if self.action == "session_me":
            permission_classes = [AuthorAdminReadWrite]
        else:
            permission_classes = [AdminOnlyReadWrite]
        return [permission() for permission in permission_classes]

    @action(detail=False, methods=["get", "patch"], url_path="session/me")
    def session_me(self, request):
        """
        セッションユーザー情報の取得と自己更新を扱う。
        """
        if not getattr(request.user, "is_authenticated", False):
            raise NotAuthenticated("認証情報がありません。")

        if request.method.lower() == "patch":
            request_serializer = UsersSessionProfileUpdateRequestSerializer(data=request.data)
            request_serializer.is_valid(raise_exception=True)
            validated_data = request_serializer.validated_data

            updated_user = UsersService.update_session_user_profile(
                user=request.user,
                email=validated_data["email"],
                display_name=validated_data["display_name"],
                profile=validated_data["profile"],
                meta=validated_data["meta"] if "meta" in validated_data else request.user.meta,
                x_url=validated_data["x_url"] if "x_url" in validated_data else request.user.x_url,
                instagram_url=(
                    validated_data["instagram_url"]
                    if "instagram_url" in validated_data
                    else request.user.instagram_url
                ),
                website_url=(
                    validated_data["website_url"]
                    if "website_url" in validated_data
                    else request.user.website_url
                ),
                icon=validated_data["icon"] if "icon" in validated_data else request.user.icon,
                header_image=(
                    validated_data["header_image"]
                    if "header_image" in validated_data
                    else request.user.header_image
                ),
                icon_file=validated_data.get("icon_file"),
                header_image_file=validated_data.get("header_image_file"),
            )
            serializer = UsersSessionUserSerializer(updated_user)
            return Response(serializer.data)

        serializer = UsersSessionUserSerializer(request.user)
        return Response(serializer.data)

    def list(self, request):
        """
        CMSユーザー一覧を返す。
        """
        query_serializer = UsersListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        users = UsersService.list_users(limit=query_serializer.validated_data["limit"])
        response_serializer = UsersUserListSerializer({"items": users})
        return Response(response_serializer.data)

    def create(self, request):
        """
        仮登録ユーザーを作成する。
        """
        request_serializer = UsersProvisionCreateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        user = UsersService.create_provisional_user(
            email=request_serializer.validated_data["email"],
            role=request_serializer.validated_data["role"],
            icon_file=request_serializer.validated_data.get("icon_file"),
            header_image_file=request_serializer.validated_data.get("header_image_file"),
        )
        response_serializer = UsersUserSerializer(user)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        """
        CMSユーザー詳細を返す。
        """
        try:
            user = User.objects.get(id=pk)
        except User.DoesNotExist as exc:
            raise NotFound("ユーザーが存在しません。") from exc
        serializer = UsersUserSerializer(user)
        return Response(serializer.data)

    def partial_update(self, request, pk=None):
        """
        CMSユーザーを更新する。
        """
        request_serializer = UsersUserUpdateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        try:
            user = User.objects.get(id=pk)
        except User.DoesNotExist as exc:
            raise NotFound("ユーザーが存在しません。") from exc
        validated_data = request_serializer.validated_data

        updated_user = UsersService.update_user_by_admin(
            user=user,
            display_name=validated_data["display_name"],
            profile=validated_data["profile"],
            meta=validated_data["meta"] if "meta" in validated_data else user.meta,
            x_url=validated_data["x_url"] if "x_url" in validated_data else user.x_url,
            instagram_url=(
                validated_data["instagram_url"]
                if "instagram_url" in validated_data
                else user.instagram_url
            ),
            website_url=(
                validated_data["website_url"]
                if "website_url" in validated_data
                else user.website_url
            ),
            role=validated_data["role"],
            is_active=validated_data["is_active"],
            icon=validated_data["icon"] if "icon" in validated_data else user.icon,
            header_image=(
                validated_data["header_image"]
                if "header_image" in validated_data
                else user.header_image
            ),
            icon_file=validated_data.get("icon_file"),
            header_image_file=validated_data.get("header_image_file"),
        )
        response_serializer = UsersUserSerializer(updated_user)
        return Response(response_serializer.data)

    @action(detail=True, methods=["post"], url_path="invite")
    def invite(self, request, pk=None):
        """
        招待URL情報を返す。
        """
        try:
            user = User.objects.get(id=pk)
        except User.DoesNotExist as exc:
            raise NotFound("ユーザーが存在しません。") from exc
        payload = UsersService.build_activation_issue_response(user=user)
        serializer = UsersActivationIssueResponseSerializer(payload)
        return Response(serializer.data)


class ActivationUserView(APIView):
    """
    仮登録ユーザーの本登録情報取得と完了を扱う。
    """

    permission_classes = [SelfActivationPermission]

    def _get_principal(self, request):
        """
        middleware で検証済み principal を返す。
        """
        principal = getattr(request, "cloudflare_access_principal", None)
        if principal is None:
            raise NotAuthenticated("Cloudflare Access の認証情報がありません。")
        return principal

    def get(self, request, user_id):
        """
        本登録対象ユーザー情報を返す。
        """
        principal = self._get_principal(request)
        user = UsersService.get_activation_user(user_id=user_id, principal=principal)
        serializer = ActivationUserDetailSerializer(user)
        return Response(serializer.data)

    def post(self, request, user_id):
        """
        本登録を完了して更新後ユーザー情報を返す。
        """
        request_serializer = RegistrationCompleteSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)

        principal = self._get_principal(request)
        user = UsersService.get_activation_user(user_id=user_id, principal=principal)
        activated_user = UsersService.complete_activation(
            user=user,
            principal=principal,
            display_name=request_serializer.validated_data["display_name"],
            profile=request_serializer.validated_data["profile"],
            icon=request_serializer.validated_data.get("icon"),
            header_image=request_serializer.validated_data.get("header_image"),
        )
        response_serializer = UsersUserSerializer(activated_user)
        return Response(response_serializer.data)


class DevelopmentAccessTokenView(APIView):
    """
    開発環境向けの Access JWT を返す。
    """

    permission_classes = [AllowAny]

    def get(self, request):
        """
        開発用 Access JWT を発行して返す。
        """
        payload = UsersService.issue_development_access_token()
        serializer = UsersDevelopmentAccessTokenSerializer(payload)
        return Response(serializer.data)
