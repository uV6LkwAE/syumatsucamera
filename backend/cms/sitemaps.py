"""
公開サイト向け sitemap 定義を提供する。
"""
from django.contrib.sitemaps import Sitemap

from cms.models import Article, ArticleStatus, Category


class StaticViewSitemap(Sitemap):
    """
    トップ、新着一覧、人気一覧の固定URLを sitemap に載せる。
    """

    def items(self) -> list[str]:
        """
        固定ページの公開パス一覧を返す。
        """
        return [
            "/",
            "/articles/new/",
            "/articles/popular/",
        ]

    def location(self, item: str) -> str:
        """
        固定ページの公開URLパスを返す。
        """
        return item


class ArticleSitemap(Sitemap):
    """
    公開状態の記事だけを sitemap に載せる。
    """

    def items(self):
        """
        公開記事一覧を返す。
        """
        return Article.objects.select_related("category").filter(
            status=ArticleStatus.PUBLISH,
        )

    def location(self, obj: Article) -> str:
        """
        記事詳細ページの公開URLパスを返す。
        """
        return obj.path

    def lastmod(self, obj: Article):
        """
        記事更新日時を sitemap の lastmod として返す。
        """
        return obj.updated_at


class CategorySitemap(Sitemap):
    """
    すべてのカテゴリーページを sitemap に載せる。
    """

    def items(self):
        """
        カテゴリー一覧を返す。
        """
        return Category.objects.all()

    def location(self, obj: Category) -> str:
        """
        カテゴリーページの公開URLパスを返す。
        """
        return obj.path

    def lastmod(self, obj: Category):
        """
        カテゴリー更新日時を sitemap の lastmod として返す。
        """
        return obj.updated_at
