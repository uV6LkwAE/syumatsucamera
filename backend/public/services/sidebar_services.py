"""
公開トップ補助情報のサービスを定義する。
"""
from cms.models import Article, ArticleStatus, Category, Tag
from users.models import User


PUBLIC_PROFILE_EMAIL = "syumatsu.camera@gmail.com"


class PublicSidebarService:
    """
    公開トップのサイドバー情報を扱う。
    """

    @staticmethod
    def get_sidebar() -> dict:
        """
        公開プロフィール、カテゴリーツリー、タグ一覧を返す。
        """
        profile_user = User.objects.filter(
            email=PUBLIC_PROFILE_EMAIL,
            is_active=True,
        ).first()
        if profile_user is None:
            raise RuntimeError("公開プロフィール用のユーザーが存在しません。")

        return {
            "profile": profile_user,
            "category_tree": PublicSidebarService._build_category_tree(),
            "tags": Tag.objects.all().order_by("name"),
        }

    @staticmethod
    def _build_category_tree() -> list[dict]:
        """
        全カテゴリを親子階層へ変換する。
        """
        category_rows = list(
            Category.objects.all()
            .order_by("tree_id", "lft")
            .values("id", "name", "slug", "parent_id", "tree_id", "lft", "rght")
        )
        article_category_rows = list(
            Article.objects.filter(
                status=ArticleStatus.PUBLISH,
            ).values(
                "category__tree_id",
                "category__lft",
            )
        )
        nodes_by_id = {
            row["id"]: {
                "id": row["id"],
                "name": row["name"],
                "slug": row["slug"],
                "path": f"/category/{row['slug']}/",
                "article_count": PublicSidebarService._count_published_articles_in_category(
                    category_row=row,
                    article_category_rows=article_category_rows,
                ),
                "children": [],
            }
            for row in category_rows
        }

        roots = []
        for row in category_rows:
            node = nodes_by_id[row["id"]]
            parent_id = row["parent_id"]
            if parent_id is None or parent_id not in nodes_by_id:
                roots.append(node)
                continue
            nodes_by_id[parent_id]["children"].append(node)
        return roots

    @staticmethod
    def _count_published_articles_in_category(
        *,
        category_row: dict,
        article_category_rows: list[dict],
    ) -> int:
        """
        子孫カテゴリを含む公開記事数を返す。
        """
        return sum(
            1
            for article_category_row in article_category_rows
            if article_category_row["category__tree_id"] == category_row["tree_id"]
            and category_row["lft"] <= article_category_row["category__lft"] <= category_row["rght"]
        )
