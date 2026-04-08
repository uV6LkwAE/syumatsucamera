"""
cms サービス共通処理を定義する。
"""
from collections.abc import Iterable

from asgiref.sync import async_to_sync
from django.core.paginator import Paginator
from django.db import transaction
from django.utils.text import slugify
from googletrans import Translator
from rest_framework.exceptions import APIException

from cms.models import Option, OptionCode


class SlugTranslationUnavailable(APIException):
    """
    slug生成用の英訳に失敗した場合の例外。
    """

    status_code = 503
    default_detail = "slug生成用の翻訳に失敗しました。"
    default_code = "service_unavailable"


def build_pagination_payload(*, page: int, limit: int, queryset) -> dict:
    """
    QuerySet をページングしたレスポンス形式へ変換する。
    """
    paginator = Paginator(queryset, per_page=limit)
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


def unique_slugify(*, value: str, existing_slugs: Iterable[str]) -> str:
    """
    既存 slug と衝突しない slug を生成する。
    """
    slug_source = _translate_slug_source(value=value)
    base_slug = slugify(slug_source, allow_unicode=False).strip("-")
    if base_slug == "":
        base_slug = "article"

    slug = base_slug
    counter = 2
    existing_set = set(existing_slugs)
    while slug in existing_set:
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def _translate_slug_source(*, value: str) -> str:
    """
    slug生成元の文字列を英訳して返す。
    """
    source = value.strip()
    if source == "":
        return source
    if source.isascii():
        return source

    try:
        translated_text = async_to_sync(_translate_text_to_english)(source)
    except Exception as exc:
        raise SlugTranslationUnavailable() from exc

    normalized_text = translated_text.strip()
    if normalized_text == "":
        return source
    return normalized_text


async def _translate_text_to_english(value: str) -> str:
    """
    Google翻訳で英訳する。
    """
    translator = Translator()
    try:
        translated = await translator.translate(value, src="ja", dest="en")
        return translated.text
    finally:
        await translator.client.aclose()


@transaction.atomic
def ensure_default_options() -> dict[str, Option]:
    """
    記事オプションの既定定義を作成して返す。
    """
    option_map = {
        OptionCode.PR: "PR",
        OptionCode.AD: "AD",
    }
    resolved: dict[str, Option] = {}
    for code, label in option_map.items():
        option, _ = Option.objects.get_or_create(
            code=code,
            defaults={
                "label": label,
            },
        )
        resolved[code] = option
    return resolved
