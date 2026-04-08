"""
公開API URLを定義する。
"""
from django.urls import path

from public.views import (
    PublicArticleDetailView,
    PublicArticleListView,
    PublicSidebarView,
    PublicSiteConfigView,
)

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
    path(
        "public/sidebar",
        PublicSidebarView.as_view(),
        name="public-sidebar",
    ),
    path(
        "public/site-config",
        PublicSiteConfigView.as_view(),
        name="public-site-config",
    ),
]
