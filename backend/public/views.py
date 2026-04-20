"""
公開APIビューを定義する。
"""
from django.conf import settings
from rest_framework.response import Response
from rest_framework.views import APIView

from public.serializers import (
    PublicArticleDetailSerializer,
    PublicArticleListQuerySerializer,
    PublicArticleListSerializer,
    PublicArticleMetaSerializer,
    PublicSidebarSerializer,
    PublicSiteConfigSerializer,
)
from public.services.article_services import PublicArticleService
from public.services.sidebar_services import PublicSidebarService


def build_public_site_origin(request) -> str:
    """
    公開側の絶対URL生成に使うoriginを返す。
    """
    if settings.DEBUG:
        return request.build_absolute_uri("/").rstrip("/")
    return f"https://{request.get_host()}"


class PublicArticleListView(APIView):
    """
    公開記事一覧API。
    """

    permission_classes = []

    def get(self, request):
        """
        公開記事一覧を返す。
        """
        query_serializer = PublicArticleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)

        payload = PublicArticleService.list_articles(
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
            q=query_serializer.validated_data["q"],
            ordering=query_serializer.validated_data["ordering"],
            category_slug=query_serializer.validated_data.get("category_slug"),
            tag_slug=query_serializer.validated_data.get("tag_slug"),
            author_id=query_serializer.validated_data.get("author_id"),
        )
        response_serializer = PublicArticleListSerializer(payload)
        return Response(response_serializer.data)


class PublicArticleDetailView(APIView):
    """
    公開記事詳細API。
    """

    permission_classes = []

    def get(self, request, category_slug: str, article_slug: str):
        """
        公開記事詳細を返す。
        """
        payload = PublicArticleService.get_article_detail(
            category_slug=category_slug,
            article_slug=article_slug,
        )
        response_serializer = PublicArticleDetailSerializer(payload)
        return Response(response_serializer.data)


class PublicArticleMetaView(APIView):
    """
    Cloudflare Worker向けの記事メタ情報API。
    """

    permission_classes = []

    def get(
        self,
        request,
        slug: str | None = None,
        category_slug: str | None = None,
        article_slug: str | None = None,
    ):
        """
        記事slugまたはカテゴリslugと記事slugからメタ情報を返す。
        """
        payload = PublicArticleService.get_article_meta(
            category_slug=category_slug,
            article_slug=article_slug,
            slug=slug,
            site_origin=build_public_site_origin(request),
        )
        response_serializer = PublicArticleMetaSerializer(payload)
        return Response(response_serializer.data)


class PublicSidebarView(APIView):
    """
    公開トップ補助情報API。
    """

    permission_classes = []

    def get(self, request):
        """
        公開トップのプロフィール、カテゴリ、タグを返す。
        """
        payload = PublicSidebarService.get_sidebar()
        response_serializer = PublicSidebarSerializer(payload)
        return Response(response_serializer.data)


class PublicSiteConfigView(APIView):
    """
    公開フロント用設定API。
    """

    permission_classes = []

    def get(self, request):
        """
        公開フロント用設定を返す。
        """
        response_serializer = PublicSiteConfigSerializer(
            {
                "turnstile_site_key": settings.TURNSTILE_SITE_KEY,
            }
        )
        return Response(response_serializer.data)
