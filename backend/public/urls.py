"""
公開API URLを定義する。
"""
from django.urls import path

from public.views import PublicArticleDetailView, PublicArticleListView

urlpatterns = [
    path(
        "public/articles",
        PublicArticleListView.as_view(),
        name="public-article-list",
    ),
    path(
        "public/articles/<str:category_slug>/<str:article_slug>",
        PublicArticleDetailView.as_view(),
        name="public-article-detail",
    ),
]
