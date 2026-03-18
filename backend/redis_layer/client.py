"""
Redisクライアント初期化を共通化する。
"""
import redis
from django.conf import settings

redis_client: redis.StrictRedis | None = None


def get_redis_client() -> redis.StrictRedis:
    """
    設定済みREDIS_URLからRedisクライアントを返す。
    """
    global redis_client

    if redis_client is None:
        redis_client = redis.StrictRedis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=float(settings.REDIS_CONNECT_TIMEOUT),
            socket_timeout=float(settings.REDIS_SOCKET_TIMEOUT),
        )

    return redis_client
