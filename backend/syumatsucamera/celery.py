"""
Celeryアプリケーション設定を定義する。
"""
from celery import Celery
from django.conf import settings


app = Celery("syumatsucamera")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.conf.broker_url = settings.REDIS_URL
app.conf.result_backend = settings.REDIS_URL
app.autodiscover_tasks()
