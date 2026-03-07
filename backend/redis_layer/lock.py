"""
Redisロック取得・延長・解放を共通化する。
"""

from __future__ import annotations

import uuid

from redis import Redis

from redis_layer.client import get_redis_client

_RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

_EXTEND_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
"""


def generate_lock_token() -> str:
    """
    ロック所有者判定に使うトークンを生成する。
    """
    return uuid.uuid4().hex


def acquire_lock(
    key: str,
    ttl_seconds: int,
    *,
    token: str | None = None,
    redis_client: Redis | None = None,
) -> str | None:
    """
    SET NX EXでロックを取得し、成功時はtokenを返す。
    """
    if ttl_seconds < 1:
        raise ValueError("ttl_secondsは1以上で指定してください。")

    client = redis_client or get_redis_client()
    lock_token = token or generate_lock_token()
    acquired = client.set(key, lock_token, nx=True, ex=ttl_seconds)
    if acquired:
        return lock_token
    return None


def extend_lock(
    key: str,
    token: str,
    ttl_seconds: int,
    *,
    redis_client: Redis | None = None,
) -> bool:
    """
    token一致時のみTTLを延長する。
    """
    if ttl_seconds < 1:
        raise ValueError("ttl_secondsは1以上で指定してください。")

    client = redis_client or get_redis_client()
    result = client.eval(_EXTEND_LOCK_LUA, 1, key, token, ttl_seconds)
    return bool(result)


def release_lock(key: str, token: str, *, redis_client: Redis | None = None) -> bool:
    """
    token一致時のみロックを解放する。
    """
    client = redis_client or get_redis_client()
    result = client.eval(_RELEASE_LOCK_LUA, 1, key, token)
    return bool(result)


def get_lock_token(key: str, *, redis_client: Redis | None = None) -> str | None:
    """
    現在のロックトークンを取得する。
    """
    client = redis_client or get_redis_client()
    value = client.get(key)
    if value is None:
        return None
    return str(value)
