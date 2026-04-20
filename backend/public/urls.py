"""
公開API URLを定義する。
"""
from django.urls import path

from public.views import (
    PublicArticleDetailView,
    PublicArticleListView,
    PublicArticleMetaView,
    PublicSidebarView,
    PublicSiteConfigView,
)

urlpatterns = [
    path(
        "articles/<str:category_slug>/<str:article_slug>/meta",
        PublicArticleMetaView.as_view(),
        name="public-article-meta-by-path-no-slash",
    ),
    path(
        "articles/<str:category_slug>/<str:article_slug>/meta/",
        PublicArticleMetaView.as_view(),
        name="public-article-meta-by-path",
    ),
    path(
        "articles/<str:slug>/meta",
        PublicArticleMetaView.as_view(),
        name="public-article-meta-no-slash",
    ),
    path(
        "articles/<str:slug>/meta/",
        PublicArticleMetaView.as_view(),
        name="public-article-meta",
    ),
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
