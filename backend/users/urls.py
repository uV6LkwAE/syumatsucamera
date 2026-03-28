"""
users アプリの URL を定義する。
"""
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from users.views import (
    ActivationUserView,
    UsersViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("", UsersViewSet, basename="users")

urlpatterns = [
    path("", include(router.urls)),
    path(
        "activate/<uuid:user_id>", ActivationUserView.as_view(), name="users-activate",
    ),
]
