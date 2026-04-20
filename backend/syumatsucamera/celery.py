"""
Celeryアプリケーション設定を定義する。
"""
from celery import Celery
from django.conf import settings


app = Celery("syumatsucamera")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.conf.broker_url = settings.REDIS_URL
app.conf.result_backend = settings.REDIS_URL
app.conf.worker_concurrency = settings.CELERY_WORKER_CONCURRENCY
app.conf.worker_prefetch_multiplier = settings.CELERY_WORKER_PREFETCH_MULTIPLIER
app.conf.worker_max_tasks_per_child = settings.CELERY_WORKER_MAX_TASKS_PER_CHILD
app.autodiscover_tasks()
