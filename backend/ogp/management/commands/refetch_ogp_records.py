"""
全OGPキャッシュの再取得コマンドを定義する。
"""
from django.core.management.base import BaseCommand

from ogp.services.ogp_record_services import OgpRecordService


class Command(BaseCommand):
    """
    全OGPキャッシュを順に再取得する。
    """

    help = "全OGPキャッシュを再取得する。"

    def handle(self, *args, **options):
        """
        再取得処理を実行し、結果件数を出力する。
        """
        result = OgpRecordService.refetch_all_records()
        self.stdout.write(
            self.style.SUCCESS(
                f"OGP refetch completed. succeeded={result['succeeded']} failed={result['failed']}"
            )
        )
