"""
ogp アプリのシリアライザーを定義する。
"""
from django.conf import settings
from rest_framework import serializers


class OgpPaginationSerializer(serializers.Serializer):
    """
    OGP一覧のページネーション情報を返す。
    """

    page = serializers.IntegerField(read_only=True)
    page_size = serializers.IntegerField(read_only=True)
    total_count = serializers.IntegerField(read_only=True)
    total_pages = serializers.IntegerField(read_only=True)


class OgpRecordListQuerySerializer(serializers.Serializer):
    """
    OGP一覧クエリを検証する。
    """

    page = serializers.IntegerField(required=False, min_value=1, default=1)
    limit = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=100,
        default=settings.REST_FRAMEWORK.get("PAGE_SIZE", 20),
    )


class OgpRecordSerializer(serializers.Serializer):
    """
    OGPレコード情報を返す。
    """

    id = serializers.UUIDField(read_only=True)
    article_id = serializers.UUIDField(read_only=True)
    url = serializers.CharField(read_only=True)
    title = serializers.CharField(allow_null=True, read_only=True)
    summary = serializers.CharField(allow_null=True, read_only=True)
    thumbnail = serializers.CharField(allow_null=True, read_only=True)
    site_name = serializers.CharField(allow_null=True, read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)


class OgpRecordListSerializer(serializers.Serializer):
    """
    OGPレコード一覧レスポンスを返す。
    """

    items = OgpRecordSerializer(many=True, read_only=True)
    pagination = OgpPaginationSerializer(read_only=True)


class OgpRecordUpdateRequestSerializer(serializers.Serializer):
    """
    OGPレコード更新入力を検証する。
    """

    title = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    summary = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    thumbnail = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    site_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs):
        """
        1項目以上の更新指定があることを検証する。
        """
        if not attrs:
            raise serializers.ValidationError(
                {"detail": "更新対象の項目を1つ以上指定してください。"}
            )
        return attrs


class OgpAcceptedJobSerializer(serializers.Serializer):
    """
    OGP再取得ジョブの受理結果を返す。
    """

    job_name = serializers.CharField(read_only=True)
    status = serializers.ChoiceField(choices=["accepted"], read_only=True)
