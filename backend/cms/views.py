"""
cms アプリのビューを定義する。
"""
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from core.permissions.permissions import AdminOnlyReadWrite, AuthorAdminReadWrite
from cms.serializers import (
    ArticleOptionSerializer,
    CmsArticleAuthorOptionListSerializer,
    CmsArticleImageUploadRequestSerializer,
    CmsArticleImageUploadResponseSerializer,
    CmsArticleOptionCreateUpdateRequestSerializer,
    CmsArticleListQuerySerializer,
    CmsArticleListSerializer,
    CmsArticleMutationResponseSerializer,
    CmsArticleOptionListSerializer,
    CmsArticleSaveLogListSerializer,
    CmsArticleSaveLogQuerySerializer,
    CmsArticleSerializer,
    CmsArticleSessionCreateRequestSerializer,
    CmsArticleSessionSerializer,
    CmsArticleUpsertRequestSerializer,
    CmsCategoryCreateRequestSerializer,
    CmsCategoryDeleteRequestSerializer,
    CmsCategoryNodeSerializer,
    CmsCategoryTreeSerializer,
    CmsCategoryUpdateRequestSerializer,
    CmsPublishRequestCreateRequestSerializer,
    CmsPublishRequestListQuerySerializer,
    CmsPublishRequestListSerializer,
    CmsPublishRequestRejectRequestSerializer,
    CmsPublishRequestSerializer,
    CmsTagSuggestionListSerializer,
    CmsTagSuggestionQuerySerializer,
)
from cms.services.article_author_services import ArticleAuthorService
from cms.services.article_option_services import ArticleOptionService
from cms.services.article_save_log_services import ArticleSaveLogService
from cms.services.article_services import ArticleService
from cms.services.article_session_services import ArticleSessionService
from cms.services.category_services import CategoryService
from cms.services.media_services import MediaService
from cms.services.publish_request_services import PublishRequestService
from cms.services.tag_services import TagService


class CmsArticlesViewSet(ViewSet):
    """
    CMS記事API。
    """

    permission_classes = [AuthorAdminReadWrite]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def list(self, request):
        """
        CMS記事一覧を返す。
        """
        query_serializer = CmsArticleListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        payload = ArticleService.list_articles(
            user=request.user,
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
            ordering=query_serializer.validated_data["ordering"],
            author_id=query_serializer.validated_data.get("author"),
            title=query_serializer.validated_data.get("title"),
            status=query_serializer.validated_data.get("status"),
        )
        response_serializer = CmsArticleListSerializer(payload)
        return Response(response_serializer.data)

    def create(self, request):
        """
        記事を新規作成する。
        """
        request_serializer = CmsArticleUpsertRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        result = ArticleService.create_article(
            user=request.user,
            payload=request_serializer.validated_data,
        )
        response_serializer = CmsArticleMutationResponseSerializer(
            {
                "article": result.article,
                "postprocess_job": result.postprocess_job,
            }
        )
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)

    def retrieve(self, request, pk=None):
        """
        CMS記事詳細を返す。
        """
        article = ArticleService.get_article_for_user(user=request.user, article_id=pk)
        response_serializer = CmsArticleSerializer(article)
        return Response(response_serializer.data)

    def partial_update(self, request, pk=None):
        """
        記事を更新する。
        """
        article = ArticleService.get_article_for_user(user=request.user, article_id=pk)
        request_serializer = CmsArticleUpsertRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        result = ArticleService.update_article(
            user=request.user,
            article=article,
            payload=request_serializer.validated_data,
        )
        response_serializer = CmsArticleMutationResponseSerializer(
            {
                "article": result.article,
                "postprocess_job": result.postprocess_job,
            }
        )
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)

    def destroy(self, request, pk=None):
        """
        記事を削除する。
        """
        article = ArticleService.get_article_for_user(user=request.user, article_id=pk)
        ArticleService.delete_article(user=request.user, article=article)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="publish-requests")
    def publish_requests(self, request, pk=None):
        """
        公開申請を作成する。
        """
        article = ArticleService.get_article_for_user(user=request.user, article_id=pk)
        request_serializer = CmsPublishRequestCreateRequestSerializer(data=request.data or {})
        request_serializer.is_valid(raise_exception=True)
        publish_request = PublishRequestService.create_request(
            article=article,
            user=request.user,
            note=request_serializer.validated_data.get("note"),
        )
        response_serializer = CmsPublishRequestSerializer(publish_request)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class CmsArticleAuthorsViewSet(ViewSet):
    """
    記事一覧の執筆者候補API。
    """

    permission_classes = [AuthorAdminReadWrite]

    def list(self, request):
        """
        記事一覧の執筆者候補を返す。
        """
        payload = {
            "items": ArticleAuthorService.list_authors(user=request.user),
        }
        response_serializer = CmsArticleAuthorOptionListSerializer(payload)
        return Response(response_serializer.data)


class CmsArticleOptionsViewSet(ViewSet):
    """
    記事オプション候補API。
    """

    permission_classes = [AuthorAdminReadWrite]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def list(self, request):
        """
        記事オプション候補を返す。
        """
        payload = {
            "items": ArticleOptionService.list_options(),
        }
        response_serializer = CmsArticleOptionListSerializer(payload)
        return Response(response_serializer.data)

    def create(self, request):
        """
        記事オプションを作成する。
        """
        request_serializer = CmsArticleOptionCreateUpdateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        option = ArticleOptionService.create_option(
            label=request_serializer.validated_data["label"],
            description=request_serializer.validated_data["description"],
        )
        response_serializer = ArticleOptionSerializer(ArticleOptionService.serialize_option(option=option))
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        """
        記事オプションを更新する。
        """
        request_serializer = CmsArticleOptionCreateUpdateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        option = ArticleOptionService.update_option(
            option_id=pk,
            label=request_serializer.validated_data["label"],
            description=request_serializer.validated_data["description"],
        )
        response_serializer = ArticleOptionSerializer(ArticleOptionService.serialize_option(option=option))
        return Response(response_serializer.data)

    def destroy(self, request, pk=None):
        """
        記事オプションを削除する。
        """
        ArticleOptionService.delete_option(option_id=pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CmsTagsViewSet(ViewSet):
    """
    CMSタグ候補API。
    """

    permission_classes = [AuthorAdminReadWrite]

    def list(self, request):
        """
        入力中のタグ名に合う候補を返す。
        """
        query_serializer = CmsTagSuggestionQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        payload = {
            "items": TagService.list_tag_suggestions(
                query=query_serializer.validated_data["q"],
                limit=query_serializer.validated_data["limit"],
            ),
        }
        response_serializer = CmsTagSuggestionListSerializer(payload)
        return Response(response_serializer.data)


class CmsArticleSessionsViewSet(ViewSet):
    """
    記事編集セッションAPI。
    """

    permission_classes = [AuthorAdminReadWrite]
    lookup_field = "lock_token"
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def create(self, request):
        """
        記事編集セッションを開始する。
        """
        request_serializer = CmsArticleSessionCreateRequestSerializer(data=request.data or {})
        request_serializer.is_valid(raise_exception=True)
        session = ArticleSessionService.create_session(
            user=request.user,
            article_id=request_serializer.validated_data.get("article_id"),
        )
        response_serializer = CmsArticleSessionSerializer(session)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, lock_token=None):
        """
        記事編集セッションTTLを延長する。
        """
        session = ArticleSessionService.refresh_session(
            user=request.user,
            lock_token=lock_token,
        )
        response_serializer = CmsArticleSessionSerializer(session)
        return Response(response_serializer.data)

    def destroy(self, request, lock_token=None):
        """
        記事編集セッションを解放する。
        """
        ArticleSessionService.release_session(user=request.user, lock_token=lock_token)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CmsArticleImageUploadViewSet(ViewSet):
    """
    記事画像アップロードAPI。
    """

    permission_classes = [AuthorAdminReadWrite]

    def create(self, request):
        """
        記事画像を tmp 領域へ保存する。
        """
        request_serializer = CmsArticleImageUploadRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        ArticleSessionService.assert_session_owner(
            user=request.user,
            lock_token=str(request_serializer.validated_data["lock_token"]),
        )
        payload = MediaService.save_temp_upload(
            lock_token=str(request_serializer.validated_data["lock_token"]),
            uploaded_file=request_serializer.validated_data["file"],
        )
        response_serializer = CmsArticleImageUploadResponseSerializer(payload)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class CmsArticleSaveLogsViewSet(ViewSet):
    """
    記事保存ログAPI。
    """

    permission_classes = [AuthorAdminReadWrite]

    def list(self, request):
        """
        記事保存ログ一覧を返す。
        """
        query_serializer = CmsArticleSaveLogQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        payload = ArticleSaveLogService.list_logs(
            user=request.user,
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
            article_id=query_serializer.validated_data.get("article_id"),
            request_user_id=query_serializer.validated_data.get("request_user_id"),
            occurred_at_from=query_serializer.validated_data.get("occurred_at_from"),
            occurred_at_to=query_serializer.validated_data.get("occurred_at_to"),
            lock_token=query_serializer.validated_data.get("lock_token"),
            target=query_serializer.validated_data.get("target"),
            status=query_serializer.validated_data.get("status"),
        )
        response_serializer = CmsArticleSaveLogListSerializer(payload)
        return Response(response_serializer.data)


class CmsPublishRequestsViewSet(ViewSet):
    """
    公開申請処理API。
    """

    permission_classes = [AdminOnlyReadWrite]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def list(self, request):
        """
        公開申請一覧を返す。
        """
        query_serializer = CmsPublishRequestListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        payload = PublishRequestService.list_requests(
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
            status=query_serializer.validated_data.get("status"),
        )
        response_serializer = CmsPublishRequestListSerializer(payload)
        return Response(response_serializer.data)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, pk=None):
        """
        公開申請を承認する。
        """
        publish_request = PublishRequestService.approve_request(
            publish_request_id=pk,
            user=request.user,
        )
        response_serializer = CmsPublishRequestSerializer(publish_request)
        return Response(response_serializer.data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, pk=None):
        """
        公開申請を却下する。
        """
        request_serializer = CmsPublishRequestRejectRequestSerializer(data=request.data or {})
        request_serializer.is_valid(raise_exception=True)
        publish_request = PublishRequestService.reject_request(
            publish_request_id=pk,
            user=request.user,
            note=request_serializer.validated_data.get("note"),
        )
        response_serializer = CmsPublishRequestSerializer(publish_request)
        return Response(response_serializer.data)


class CmsCategoriesViewSet(ViewSet):
    """
    カテゴリ管理API。
    """

    permission_classes = [AdminOnlyReadWrite]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def list(self, request):
        """
        カテゴリツリーを返す。
        """
        limit = int(request.query_params.get("limit", 100))
        payload = CategoryService.list_category_tree(limit=limit)
        response_serializer = CmsCategoryTreeSerializer(payload)
        return Response(response_serializer.data)

    def create(self, request):
        """
        カテゴリを作成する。
        """
        request_serializer = CmsCategoryCreateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        category = CategoryService.create_category(
            name=request_serializer.validated_data["name"],
            parent_id=request_serializer.validated_data.get("parent_id"),
        )
        response_serializer = CmsCategoryNodeSerializer(
            {
                "id": category.id,
                "name": category.name,
                "slug": category.slug,
                "parent_id": category.parent_id,
                "sort_order": category.sort_order,
                "children": [],
            }
        )
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        """
        カテゴリを更新する。
        """
        request_serializer = CmsCategoryUpdateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        category = CategoryService.update_category(
            category_id=pk,
            name=request_serializer.validated_data["name"],
            parent_id=request_serializer.validated_data.get("parent_id"),
            ordered_sibling_category_ids=request_serializer.validated_data["ordered_sibling_category_ids"],
        )
        response_serializer = CmsCategoryNodeSerializer(
            {
                "id": category.id,
                "name": category.name,
                "slug": category.slug,
                "parent_id": category.parent_id,
                "sort_order": category.sort_order,
                "children": [
                    {
                        "id": child.id,
                        "name": child.name,
                        "slug": child.slug,
                        "parent_id": child.parent_id,
                        "sort_order": child.sort_order,
                        "children": [],
                    }
                    for child in category.children.order_by("sort_order", "name")
                ],
            }
        )
        return Response(response_serializer.data)

    def destroy(self, request, pk=None):
        """
        カテゴリを削除する。
        """
        request_serializer = CmsCategoryDeleteRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        CategoryService.delete_category(
            category_id=pk,
            parent_id=request_serializer.validated_data.get("parent_id"),
            ordered_sibling_category_ids=request_serializer.validated_data["ordered_sibling_category_ids"],
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
