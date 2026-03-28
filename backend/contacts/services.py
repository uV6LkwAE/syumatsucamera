"""
contacts アプリの業務ロジックを定義する。
"""
from django.conf import settings
from django.core.paginator import Paginator
import requests
from rest_framework.exceptions import ValidationError

from contacts.models import Contact


TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_turnstile_token(*, token: str, remoteip: str | None) -> dict:
    """
    Turnstile トークンを検証して検証結果を返す。
    """
    payload = {
        "secret": settings.TURNSTILE_SECRET_KEY,
        "response": token,
    }
    if remoteip:
        payload["remoteip"] = remoteip

    try:
        response = requests.post(
            TURNSTILE_VERIFY_URL,
            data=payload,
            timeout=5,
        )
        response.raise_for_status()
        verified = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise ValidationError(
            {"turnstile_token": ["Turnstile の検証中にエラーが発生しました。"]}
        ) from exc

    if not verified.get("success", False):
        raise ValidationError({"turnstile_token": ["Turnstile の検証に失敗しました。"]})

    return verified


def create_contact(
    *,
    subject_type: str,
    company_name: str,
    person_name: str,
    email: str,
    body: str,
    turnstile_meta: dict,
) -> Contact:
    """
    問い合わせを作成して返す。
    """
    return Contact.objects.create(
        subject_type=subject_type,
        company_name=company_name,
        person_name=person_name,
        email=email,
        body=body,
        turnstile_meta=turnstile_meta,
    )


def list_contacts(*, page: int, limit: int) -> dict:
    """
    問い合わせ一覧とページ情報を返す。
    """
    paginator = Paginator(Contact.objects.all(), per_page=limit)
    page_obj = paginator.get_page(page)
    return {
        "items": list(page_obj.object_list),
        "pagination": {
            "page": page_obj.number,
            "page_size": limit,
            "total_count": paginator.count,
            "total_pages": paginator.num_pages,
        },
    }
