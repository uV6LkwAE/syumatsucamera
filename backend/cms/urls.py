"""
cms アプリの URL を定義する。
"""
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from cms.views import (
    CmsArticleAuthorsViewSet,
    CmsArticleImageUploadViewSet,
    CmsArticlesViewSet,
    CmsArticleSaveLogsViewSet,
    CmsArticleSessionsViewSet,
    CmsCategoriesViewSet,
    CmsPublishRequestsViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("articles", CmsArticlesViewSet, basename="cms-articles")
router.register("article-authors", CmsArticleAuthorsViewSet, basename="cms-article-authors")
router.register("article-sessions", CmsArticleSessionsViewSet, basename="cms-article-sessions")
router.register("article-save-logs", CmsArticleSaveLogsViewSet, basename="cms-article-save-logs")
router.register("publish-requests", CmsPublishRequestsViewSet, basename="cms-publish-requests")
router.register("categories", CmsCategoriesViewSet, basename="cms-categories")
router.register("article-images", CmsArticleImageUploadViewSet, basename="cms-article-images")

urlpatterns = [
    path("", include(router.urls)),
]
