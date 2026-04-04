"""
公開APIビューを定義する。
"""
from rest_framework.response import Response
from rest_framework.views import APIView

from public.serializers import (
    PublicArticleDetailSerializer,
    PublicArticleListQuerySerializer,
    PublicArticleListSerializer,
)
from public.services.article_services import PublicArticleService


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

