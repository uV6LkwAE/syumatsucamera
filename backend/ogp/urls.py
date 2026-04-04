"""
ogp アプリの URL を定義する。
"""
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from ogp.views import OgpRecordsViewSet


router = SimpleRouter(trailing_slash=False)
router.register("ogp", OgpRecordsViewSet, basename="ogp-records")

urlpatterns = [
    path("", include(router.urls)),
]
