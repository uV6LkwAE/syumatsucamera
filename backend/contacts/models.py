"""
contacts アプリのモデルを定義する。
"""
import uuid

from django.db import models


class ContactSubjectType(models.TextChoices):
    """
    問い合わせの用件種別。
    """

    REVIEW = "review", "レビュー依頼"
    BLOG = "blog", "ブログ関連"


class Contact(models.Model):
    """
    問い合わせデータを保持する。
    """

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
        verbose_name="ID",
    )
    subject_type = models.CharField(
        max_length=20,
        choices=ContactSubjectType.choices,
        verbose_name="問い合わせ種別",
    )
    company_name = models.CharField(
        max_length=255,
        blank=True,
        verbose_name="会社名",
    )
    person_name = models.CharField(
        max_length=100,
        verbose_name="担当者名",
    )
    email = models.EmailField(
        max_length=255,
        verbose_name="メールアドレス",
    )
    body = models.TextField(verbose_name="本文")
    turnstile_meta = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Turnstile検証情報",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="作成日時")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新日時")

    class Meta:
        verbose_name = "問い合わせ"
        verbose_name_plural = "問い合わせ"
        ordering = ["-created_at"]

    def __str__(self):
        """
        管理画面向けの文字列表現を返す。
        """
        return f"{self.person_name} <{self.email}>"
