"""
記事オプション関連サービスを定義する。
"""
from django.db import transaction
from rest_framework.exceptions import ValidationError

from cms.models import Option, OptionCode
from cms.services.common import ensure_default_options, unique_slugify


class ArticleOptionService:
    """
    記事オプションの業務ロジックを扱う。
    """

    @staticmethod
    @transaction.atomic
    def list_options() -> list[dict]:
        """
        記事オプション一覧を返す。
        """
        ensure_default_options()
        system_codes = set(OptionCode.values)
        return [
            {
                "id": option.id,
                "code": option.code,
                "label": option.label,
                "is_system": option.code in system_codes,
            }
            for option in Option.objects.order_by("label", "code")
        ]

    @staticmethod
    @transaction.atomic
    def resolve_options_for_upsert(*, article_option: dict) -> list[Option]:
        """
        保存対象の記事オプション一覧を返す。
        """
        option_map = ensure_default_options()
        selected_options: dict[str, Option] = {}

        if article_option["is_pr"]:
            option = option_map[OptionCode.PR]
            selected_options[str(option.id)] = option
        if article_option["is_ad"]:
            option = option_map[OptionCode.AD]
            selected_options[str(option.id)] = option

        selected_option_ids = article_option.get("selected_option_ids", [])
        if selected_option_ids:
            existing_options = list(Option.objects.filter(id__in=selected_option_ids))
            if len(existing_options) != len({str(option_id) for option_id in selected_option_ids}):
                raise ValidationError({"article_option": ["存在しない記事オプションが含まれています。"]})
            for option in existing_options:
                selected_options[str(option.id)] = option

        custom_option_labels = ArticleOptionService._normalize_custom_option_labels(
            article_option.get("custom_option_labels", []),
        )
        existing_codes = set(Option.objects.values_list("code", flat=True))
        for label in custom_option_labels:
            option = Option.objects.filter(label__iexact=label).order_by("created_at").first()
            if option is None:
                generated_code = unique_slugify(
                    value=f"custom-{label}",
                    existing_slugs=existing_codes,
                )
                option = Option.objects.create(
                    code=generated_code,
                    label=label,
                )
                existing_codes.add(generated_code)
            selected_options[str(option.id)] = option

        return list(selected_options.values())

    @staticmethod
    def _normalize_custom_option_labels(custom_option_labels: list[str]) -> list[str]:
        """
        新規作成対象のオプション名を正規化する。
        """
        normalized_labels: list[str] = []
        seen_labels: set[str] = set()
        for raw_label in custom_option_labels:
            label = raw_label.strip()
            if label == "":
                continue
            if len(label) > 100:
                raise ValidationError({"article_option": ["記事オプション名は100文字以内で入力してください。"]})
            normalized_key = label.casefold()
            if normalized_key in seen_labels:
                continue
            seen_labels.add(normalized_key)
            normalized_labels.append(label)
        return normalized_labels
