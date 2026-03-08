"""
Redisクライアント初期化を共通化する。
"""
import redis
from django.conf import settings

from .exceptions import RedisConnectionError


try:
    redis_client = redis.StrictRedis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=float(settings.REDIS_CONNECT_TIMEOUT),
        socket_timeout=float(settings.REDIS_SOCKET_TIMEOUT),
    )

    if not settings.CI_SKIP_REQUIRED_ENV_CHECK:
        redis_client.ping()
except redis.exceptions.ConnectionError as exc:
    raise RedisConnectionError(f"Cannot connect to Redis: {settings.REDIS_URL} ({exc})") from exc


def get_redis_client() -> redis.StrictRedis:
    """
    設定済みREDIS_URLからRedisクライアントを返す。
    """
    return redis_client
