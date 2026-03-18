"""
アプリ共通ビューを定義する。
"""
from django.db import DatabaseError, connection
from django.http import JsonResponse
from redis.exceptions import RedisError

from redis_layer.client import get_redis_client


def health(request):
    """
    DBとRedisの疎通を確認して結果を返す。
    """
    db_ok = False
    redis_ok = False
    db_error = ""
    redis_error = ""

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        db_ok = True
    except DatabaseError as exc:
        db_ok = False
        db_error = str(exc)

    try:
        redis_ok = bool(get_redis_client().ping())
    except (RedisError, ValueError) as exc:
        redis_ok = False
        redis_error = str(exc)

    is_ok = db_ok and redis_ok
    status_code = 200 if is_ok else 503

    payload = {
        "status": "ok" if is_ok else "ng",
        "db": db_ok,
        "redis": redis_ok,
    }

    if db_error:
        payload["db_error"] = db_error

    if redis_error:
        payload["redis_error"] = redis_error

    return JsonResponse(payload, status=status_code)
