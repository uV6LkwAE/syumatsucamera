"""
users アプリの manager を定義する。
今回はuserモデルが独自のため、create_userとcreate_superuserを自前で実装。
"""
from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    """
    User モデル用の manager を定義する。
    """

    use_in_migrations = True

    def normalize_required_email(self, email: str) -> str:
        """
        email を正規化して返す。
        """
        normalized = self.normalize_email(email)
        return normalized.strip().lower()

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        """
        通常ユーザーを作成する。
        """
        if not email:
            raise ValueError("email は必須です。")

        user = self.model(
            email=self.normalize_required_email(email),
            **extra_fields,
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.full_clean()
        user.save(using=self._db)
        return user

    def create_superuser(
        self,
        email: str,
        password: str | None = None,
        **extra_fields,
    ):
        """
        管理者ユーザーを作成する。
        """
        extra_fields.setdefault("role", "admin")
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("is_superuser", True)

        if extra_fields.get("role") != "admin":
            raise ValueError("superuser の role は admin である必要があります。")

        if extra_fields.get("is_superuser") is not True:
            raise ValueError("superuser では is_superuser=True が必要です。")

        return self.create_user(email, password, **extra_fields)
