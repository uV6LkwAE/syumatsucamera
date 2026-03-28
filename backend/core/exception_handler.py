"""
DRF の例外レスポンスをプロジェクト標準形式へ整形する。
"""
from collections.abc import Mapping
from typing import Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def _stringify(value: Any) -> str:
    """
    例外メッセージの値を文字列へ正規化して返す。
    """
    if value is None:
        return ""
    return str(value)


def _default_code(status_code: int) -> str:
    """
    HTTPステータスから標準 code を返す。
    """
    code_map = {
        status.HTTP_400_BAD_REQUEST: "VALIDATION_ERROR",
        status.HTTP_401_UNAUTHORIZED: "AUTH_REQUIRED",
        status.HTTP_403_FORBIDDEN: "PERMISSION_DENIED",
        status.HTTP_404_NOT_FOUND: "RESOURCE_NOT_FOUND",
        status.HTTP_405_METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
        status.HTTP_409_CONFLICT: "RESOURCE_CONFLICT",
        status.HTTP_429_TOO_MANY_REQUESTS: "RATE_LIMITED",
        status.HTTP_500_INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
        status.HTTP_503_SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
    }
    return code_map.get(status_code, "API_ERROR")


def _extract_detail_and_errors(data: Any, status_code: int) -> tuple[str, dict[str, Any] | None]:
    """
    detail と errors を抽出して返す。
    """
    if isinstance(data, Mapping):
        raw_detail = data.get("detail")
        if raw_detail is not None:
            detail = _stringify(raw_detail)
        elif status_code == status.HTTP_400_BAD_REQUEST:
            detail = "入力エラーです。"
        elif status_code == status.HTTP_404_NOT_FOUND:
            detail = "対象リソースが存在しません。"
        else:
            detail = "リクエストの処理に失敗しました。"

        errors = {
            key: value
            for key, value in data.items()
            if key not in {"detail", "code"}
        }
        if not errors:
            return detail, None
        return detail, errors

    if isinstance(data, list):
        if status_code == status.HTTP_400_BAD_REQUEST:
            return "入力エラーです。", {"errors": data}
        return "リクエストの処理に失敗しました。", {"errors": data}

    text = _stringify(data)
    if text:
        return text, None
    if status_code == status.HTTP_400_BAD_REQUEST:
        return "入力エラーです。", None
    if status_code == status.HTTP_404_NOT_FOUND:
        return "対象リソースが存在しません。", None
    return "リクエストの処理に失敗しました。", None


def api_exception_handler(exc, context):
    """
    DRF 例外を detail と code を持つJSONへ統一する。
    """
    response = exception_handler(exc, context)
    if response is None:
        return Response(
            {
                "detail": "サーバー内部でエラーが発生しました。",
                "code": "INTERNAL_ERROR",
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail, errors = _extract_detail_and_errors(response.data, response.status_code)
    payload: dict[str, Any] = {
        "detail": detail,
        "code": _default_code(response.status_code),
    }
    if errors is not None:
        payload["errors"] = errors

    response.data = payload
    return response
