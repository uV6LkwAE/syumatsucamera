"""
固定窓レート制限をRedisで扱う共通関数。
"""

from __future__ import annotations

from dataclasses import dataclass

from redis import Redis

from redis_layer.client import get_redis_client
from redis_layer.keys import RateLimitKeys

_INCR_WITH_EXPIRE_LUA = """
local count = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
if count == tonumber(ARGV[1]) then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""


@dataclass(frozen=True)
class RateLimitResult:
    """
    レート制限判定結果。
    """

    key: str
    count: int
    limit: int
    ttl_seconds: int

    @property
    def is_limited(self) -> bool:
        """
        制限超過かどうかを返す。
        """
        return self.count > self.limit

    @property
    def remaining(self) -> int:
        """
        残り許可回数を返す。
        """
        remaining = self.limit - self.count
        if remaining < 0:
            return 0
        return remaining


def hit_rate_limit(
    *,
    scope: str,
    identifier: str,
    route: str,
    limit: int,
    window_seconds: int,
    amount: int = 1,
    redis_client: Redis | None = None,
) -> RateLimitResult:
    """
    固定窓レート制限を加算し、現在状態を返す。
    """
    if limit < 1:
        raise ValueError("limitは1以上で指定してください。")
    if window_seconds < 1:
        raise ValueError("window_secondsは1以上で指定してください。")
    if amount < 1:
        raise ValueError("amountは1以上で指定してください。")

    key = RateLimitKeys.fixed_window(scope=scope, identifier=identifier, route=route)
    client = redis_client or get_redis_client()
    raw_count, raw_ttl = client.eval(_INCR_WITH_EXPIRE_LUA, 1, key, amount, window_seconds)

    return RateLimitResult(
        key=key,
        count=int(raw_count),
        limit=limit,
        ttl_seconds=max(int(raw_ttl), 0),
    )


def clear_rate_limit(
    *, scope: str, identifier: str, route: str, redis_client: Redis | None = None
) -> bool:
    """
    指定キーのレート制限カウンタを削除する。
    """
    key = RateLimitKeys.fixed_window(scope=scope, identifier=identifier, route=route)
    client = redis_client or get_redis_client()
    return bool(client.delete(key))
