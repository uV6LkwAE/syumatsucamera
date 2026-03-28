"""
contacts アプリの URL を定義する。
"""
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from contacts.views import CmsContactsViewSet, ContactPublicCreateView

router = SimpleRouter(trailing_slash=False)
router.register("contacts", CmsContactsViewSet, basename="cms-contacts")

urlpatterns = [
    path("contacts", ContactPublicCreateView.as_view(), name="contacts-public-create"),
    path("cms/", include(router.urls)),
]
