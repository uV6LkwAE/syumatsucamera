"""
記事一覧の執筆者候補サービスを定義する。
"""
from django.db.models import CharField
from django.db.models.functions import Coalesce, Lower

from cms.models import Article
from users.models import User, UserRole


class ArticleAuthorService:
    """
    記事一覧の執筆者候補を扱う。
    """

    @staticmethod
    def list_authors(*, user: User) -> list[User]:
        """
        利用者権限に応じた執筆者候補を返す。
        """
        article_queryset = Article.objects.all()

        if user.role != UserRole.ADMIN:
            article_queryset = article_queryset.filter(author=user)

        author_ids = article_queryset.values_list("author_id", flat=True).distinct()

        return list(
            User.objects.filter(id__in=author_ids)
            .annotate(
                author_sort_name=Lower(
                    Coalesce("display_name", "email", output_field=CharField())
                )
            )
            .order_by("author_sort_name", "email")
        )
