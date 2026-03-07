"""
Redisキー命名規則の一元管理モジュール。
全アプリで統一したキー形式を定義する。
文字列でハードコーディングせず、クラス/メソッドを介して生成する。
services層で呼ばれる。
"""


class LockKeys:
    """
    排他ロック系キー定義。
    """

    JOB_TTL_BASE_SEC = 0
    JOB_TTL_JITTER_SEC = 0

    TARGET_TTL_BASE_SEC = 0
    TARGET_TTL_JITTER_SEC = 0

    ARTICLE_EDIT_TTL_BASE_SEC = 5 * 60
    ARTICLE_EDIT_TTL_JITTER_SEC = 30

    @staticmethod
    def job(job_name: str) -> str:
        """
        lock:job:{job_name}
        目的: 同名ジョブの二重実行防止。
        TTLは呼び出し側でジョブ特性に応じて指定する。
        """
        return f"lock:job:{job_name}"

    @staticmethod
    def target(target_type: str, target_id: str | int, job_name: str) -> str:
        """
        lock:{target_type}:{target_id}:{job_name}
        目的: 対象単位の排他制御。
        TTLは呼び出し側で指定する。
        """
        return f"lock:{target_type}:{target_id}:{job_name}"

    @staticmethod
    def article_edit(article_id: str | int) -> str:
        """
        lock:article:{article_id}:edit
        目的: 記事編集の悲観ロック。
        TTLは5分を基準に運用し、必要に応じてジッターを付与する。
        """
        return f"lock:article:{article_id}:edit"


class PvCounterKeys:
    """
    記事PV一時集計キー定義。
    """

    DAILY_TTL_BASE_SEC = 7 * 24 * 60 * 60
    DAILY_TTL_JITTER_SEC = 10 * 60

    @staticmethod
    def article_daily(day_yyyymmdd: str, article_id: str | int) -> str:
        """
        pv:day:{yyyymmdd}:article:{article_id}
        目的: 記事PVの日次一時集計。
        """
        return f"pv:day:{day_yyyymmdd}:article:{article_id}"


class RateLimitKeys:
    """
    レート制限キー定義。
    """

    FIXED_WINDOW_TTL_BASE_SEC = 0
    FIXED_WINDOW_TTL_JITTER_SEC = 0

    @staticmethod
    def fixed_window(scope: str, identifier: str, route: str) -> str:
        """
        rl:{scope}:{identifier}:{route}
        目的: 固定窓レート制限カウンタ。
        TTLは呼び出し側で窓サイズを指定する。
        """
        return f"rl:{scope}:{identifier}:{route}"

