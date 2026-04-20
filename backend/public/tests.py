"""
公開APIのルーティングとメタ情報を検証する。
"""
from django.test import TestCase

from cms.models import Article, ArticleStatus, Category, ImageJobStatus
from users.models import User, UserRole


class PublicArticleMetaViewTests(TestCase):
    """
    記事メタ情報APIの互換ルートを検証する。
    """

    def setUp(self):
        self.author = User.objects.create_user(
            email="author@example.com",
            password="password",
            role=UserRole.AUTHOR,
            is_active=False,
        )
        self.category = Category.objects.create(
            name="Lens",
            slug="lens",
        )
        self.article = Article.objects.create(
            category=self.category,
            author=self.author,
            title="Nikkor Z 100-400mm",
            slug=(
                "nikkor-z-100-400mm-f45-56-vr-s-"
                "live-action-review-airplane-version"
            ),
            summary="レンズレビュー",
            body_html="<p>本文</p>",
            status=ArticleStatus.PUBLISH,
            image_job_status=ImageJobStatus.COMPLETED,
        )

    def test_category_and_article_slug_route_returns_meta(self):
        response = self.client.get(
            f"/api/articles/{self.category.slug}/{self.article.slug}/meta"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["canonical_url"],
            f"http://testserver{self.article.path}",
        )

    def test_slug_only_route_remains_available(self):
        response = self.client.get(
            f"/api/articles/{self.article.slug}/meta"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["canonical_url"],
            f"http://testserver{self.article.path}",
        )
