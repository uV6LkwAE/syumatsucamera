"""
Redis に蓄積した記事PVを DB へ反映するコマンドを定義する。
"""
from django.core.management.base import BaseCommand

from cms.services.pv_services import PvService


class Command(BaseCommand):
    """
    記事PV差分を DB へ反映する。
    """

    help = "Redis に蓄積した記事PV差分を DB へ反映する。"

    def handle(self, *args, **options):
        """
        PV 差分を flush して結果を標準出力へ書く。
        """
        result = PvService.flush_daily_article_pv()
        self.stdout.write(
            self.style.SUCCESS(
                (
                    "pv_flush completed: "
                    f"scanned_keys={result['scanned_keys']} "
                    f"updated_articles={result['updated_articles']} "
                    f"flushed_total={result['flushed_total']}"
                )
            )
        )
