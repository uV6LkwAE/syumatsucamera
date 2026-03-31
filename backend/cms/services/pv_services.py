"""
記事PV集計サービスを定義する。
"""
from django.db import transaction
from django.db.models import F

from cms.models import Article
from redis_layer.client import get_redis_client

_GET_DELETE_PV_LUA = """
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
"""


class PvService:
    """
    Redis に蓄積した記事PVをDBへ反映する。
    """

    @staticmethod
    def flush_daily_article_pv() -> dict[str, int]:
        """
        Redis 上の記事PV差分をDBへ加算して削除件数を返す。
        """
        client = get_redis_client()
        cursor = 0
        scanned_keys = 0
        updated_articles = 0
        flushed_total = 0

        while True:
            cursor, keys = client.scan(cursor=cursor, match="pv:day:*:article:*", count=200)
            for key in keys:
                scanned_keys += 1
                article_id = PvService._extract_article_id(key=key)
                raw_value = client.eval(_GET_DELETE_PV_LUA, 1, key)
                if raw_value is None:
                    continue

                increment = int(raw_value)
                if increment <= 0:
                    continue

                updated = PvService._increment_article_views(
                    article_id=article_id,
                    increment=increment,
                )
                if updated:
                    updated_articles += 1
                    flushed_total += increment

            if cursor == 0:
                break

        return {
            "scanned_keys": scanned_keys,
            "updated_articles": updated_articles,
            "flushed_total": flushed_total,
        }

    @staticmethod
    @transaction.atomic
    def _increment_article_views(*, article_id: str, increment: int) -> bool:
        """
        記事の累計PVへ差分を加算する。
        """
        updated_count = Article.objects.filter(id=article_id).update(
            views_total=F("views_total") + increment,
        )
        return updated_count > 0

    @staticmethod
    def _extract_article_id(*, key: str) -> str:
        """
        pv キーから記事IDを取り出す。
        """
        prefix = "pv:day:"
        if not key.startswith(prefix):
            raise ValueError("PVキーの形式が不正です。")
        return key.rsplit(":article:", 1)[1]
