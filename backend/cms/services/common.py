"""
cms サービス共通処理を定義する。
"""
from collections.abc import Iterable

from django.core.paginator import Paginator
from django.db import transaction
from django.utils.text import slugify

from cms.models import Option, OptionCode


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
    base_slug = slugify(value, allow_unicode=True).strip("-")
    if base_slug == "":
        base_slug = "article"

    slug = base_slug
    counter = 2
    existing_set = set(existing_slugs)
    while slug in existing_set:
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


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
        option, _ = Option.objects.get_or_create(code=code, defaults={"label": label})
        resolved[code] = option
    return resolved
