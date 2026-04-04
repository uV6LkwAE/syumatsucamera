"""
ogp アプリのビューを定義する。
"""
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from core.permissions.permissions import AdminOnlyReadWrite
from ogp.serializers import (
    OgpAcceptedJobSerializer,
    OgpRecordListQuerySerializer,
    OgpRecordListSerializer,
    OgpRecordSerializer,
    OgpRecordUpdateRequestSerializer,
)
from ogp.services.ogp_record_services import OgpRecordService


class OgpRecordsViewSet(ViewSet):
    """
    OGPキャッシュ管理API。
    """

    permission_classes = [AdminOnlyReadWrite]
    lookup_value_regex = "[0-9a-fA-F-]{36}"

    def list(self, request):
        """
        OGPキャッシュ一覧を返す。
        """
        query_serializer = OgpRecordListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        payload = OgpRecordService.list_records(
            page=query_serializer.validated_data["page"],
            limit=query_serializer.validated_data["limit"],
        )
        response_serializer = OgpRecordListSerializer(payload)
        return Response(response_serializer.data)

    def retrieve(self, request, pk=None):
        """
        OGPキャッシュ詳細を返す。
        """
        ogp_record = OgpRecordService.get_record(ogp_id=pk)
        response_serializer = OgpRecordSerializer(ogp_record)
        return Response(response_serializer.data)

    def partial_update(self, request, pk=None):
        """
        OGPキャッシュを更新する。
        """
        ogp_record = OgpRecordService.get_record(ogp_id=pk)
        request_serializer = OgpRecordUpdateRequestSerializer(data=request.data)
        request_serializer.is_valid(raise_exception=True)
        updated_record = OgpRecordService.update_record(
            ogp_record=ogp_record,
            payload=request_serializer.validated_data,
        )
        response_serializer = OgpRecordSerializer(updated_record)
        return Response(response_serializer.data)

    def destroy(self, request, pk=None):
        """
        OGPキャッシュを削除する。
        """
        ogp_record = OgpRecordService.get_record(ogp_id=pk)
        OgpRecordService.delete_record(ogp_record=ogp_record)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="refetch")
    def refetch(self, request, pk=None):
        """
        OGPキャッシュ再取得ジョブを受け付ける。
        """
        OgpRecordService.get_record(ogp_id=pk)
        response_serializer = OgpAcceptedJobSerializer(
            OgpRecordService.enqueue_refetch(ogp_id=pk)
        )
        return Response(response_serializer.data, status=status.HTTP_202_ACCEPTED)
