"""
redis_layer内で使う補助処理をまとめる。
キー定義以外の変換やTTL計算を扱う。
"""

from __future__ import annotations

import random
from datetime import date, datetime


def to_yyyymmdd(target_day: date | datetime | str) -> str:
    """
    日付入力をYYYYMMDD文字列へ変換する。
    """
    if isinstance(target_day, datetime):
        return target_day.strftime("%Y%m%d")

    if isinstance(target_day, date):
        return target_day.strftime("%Y%m%d")

    text = target_day.strip()
    if len(text) == 8 and text.isdigit():
        return text

    raise ValueError("target_dayはdate/datetimeまたはYYYYMMDD文字列で指定してください。")


def ttl_with_jitter(base_seconds: int, jitter_seconds: int) -> int:
    """
    TTLにジッターを加味した秒数を返す。
    """
    if base_seconds < 0:
        raise ValueError("base_secondsは0以上で指定してください。")

    if jitter_seconds < 0:
        raise ValueError("jitter_secondsは0以上で指定してください。")

    if base_seconds == 0:
        return 0

    if jitter_seconds == 0:
        return base_seconds

    jitter = random.randint(-jitter_seconds, jitter_seconds)
    return max(base_seconds + jitter, 1)

