"""
contacts アプリのモデルを定義する。
"""
import uuid

from django.db import models


class ContactSubjectType(models.TextChoices):
    """
    問い合わせの用件種別。
    """

    REVIEW = "review", "review"
    BLOG = "blog", "blog"


class Contact(models.Model):
    """
    問い合わせデータを保持する。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_type = models.CharField(max_length=20, choices=ContactSubjectType.choices)
    company_name = models.CharField(max_length=255, blank=True)
    person_name = models.CharField(max_length=100)
    email = models.EmailField(max_length=255)
    body = models.TextField()
    turnstile_meta = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        """
        管理画面向けの文字列表現を返す。
        """
        return f"{self.person_name} <{self.email}>"
