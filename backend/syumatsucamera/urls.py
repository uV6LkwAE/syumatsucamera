"""
URL configuration for syumatsucamera project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path

from cms.sitemaps import ArticleSitemap, CategorySitemap, StaticViewSitemap
from .views import health
from users.views import DevelopmentAccessTokenView

sitemaps = {
    "static": StaticViewSitemap,
    "articles": ArticleSitemap,
    "categories": CategorySitemap,
}

urlpatterns = [
    path("health", health),
    path("sitemap.xml", sitemap, {"sitemaps": sitemaps}, name="django-sitemap"),
    path(
        "api/system/dev-access-token",
        DevelopmentAccessTokenView.as_view(),
        name="system-dev-access-token",
    ),
    path("api/", include("contacts.urls")),
    path("api/", include("ogp.urls")),
    path("api/", include("public.urls")),
    path("api/cms/", include("cms.urls")),
    path("api/users/", include("users.urls")),
    path("admin/", admin.site.urls),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
