"""
redis_layer向け例外を定義する。
"""


class RedisConnectionError(Exception):
    """
    Redis接続に失敗した場合の例外。
    """
