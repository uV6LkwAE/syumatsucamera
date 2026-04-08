"""
記事オプション関連サービスを定義する。
"""
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from rest_framework.exceptions import NotFound, ValidationError

from cms.models import Article, Option, OptionCode
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
        return [
            ArticleOptionService.serialize_option(option=option)
            for option in Option.objects.order_by("label", "code")
        ]

    @staticmethod
    @transaction.atomic
    def create_option(*, label: str, description: str) -> Option:
        """
        記事オプションを作成する。
        """
        normalized_label = ArticleOptionService._normalize_label(label=label)
        normalized_description = ArticleOptionService._normalize_description(description=description)
        existing_codes = set(Option.objects.values_list("code", flat=True))
        code = unique_slugify(value=f"option-{normalized_label}", existing_slugs=existing_codes)

        try:
            return Option.objects.create(
                code=code,
                label=normalized_label,
                description=normalized_description,
            )
        except IntegrityError as exc:
            raise ValidationError({"label": ["同じ表示名のオプションがすでに存在します。"]}) from exc

    @staticmethod
    @transaction.atomic
    def update_option(*, option_id, label: str, description: str) -> Option:
        """
        記事オプションを更新する。
        """
        option = ArticleOptionService.get_option(option_id=option_id)
        option.label = ArticleOptionService._normalize_label(label=label)
        option.description = ArticleOptionService._normalize_description(description=description)
        try:
            option.save(update_fields=["label", "description", "updated_at"])
        except IntegrityError as exc:
            raise ValidationError({"label": ["同じ表示名のオプションがすでに存在します。"]}) from exc
        return option

    @staticmethod
    @transaction.atomic
    def delete_option(*, option_id) -> None:
        """
        記事オプションを削除する。
        """
        option = ArticleOptionService.get_option(option_id=option_id)
        if option.code in set(OptionCode.values):
            raise ValidationError("固定オプションは削除できません。")
        try:
            option.delete()
        except ProtectedError as exc:
            raise ValidationError("記事に紐づいているオプションは削除できません。") from exc

    @staticmethod
    def get_option(*, option_id) -> Option:
        """
        記事オプションを取得する。
        """
        try:
            return Option.objects.get(id=option_id)
        except Option.DoesNotExist as exc:
            raise NotFound("記事オプションが存在しません。") from exc

    @staticmethod
    def resolve_option_ids_for_upsert(*, article_option: dict) -> list:
        """
        記事へ保存するオプションID一覧を返す。
        """
        selected_option_ids = article_option.get("selected_option_ids", [])
        selected_option_id_keys = [str(option_id) for option_id in selected_option_ids]
        if len(selected_option_id_keys) != len(set(selected_option_id_keys)):
            raise ValidationError({"article_option": ["同じ記事オプションを複数指定することはできません。"]})

        if not selected_option_ids:
            return []

        existing_option_keys = {
            str(option_id)
            for option_id in Option.objects.filter(id__in=selected_option_ids).values_list("id", flat=True)
        }
        if existing_option_keys != set(selected_option_id_keys):
            raise ValidationError({"article_option": ["存在しない記事オプションが含まれています。"]})

        return list(selected_option_ids)

    @staticmethod
    def build_article_option_payload(*, article: Article) -> dict:
        """
        記事のオプション表示用ペイロードを返す。
        """
        option_ids = article.option or []
        if not option_ids:
            return {
                "is_pr": False,
                "is_ad": False,
                "items": [],
            }

        options_by_id = {
            str(option.id): option
            for option in Option.objects.filter(id__in=option_ids)
        }
        items = []
        option_codes = set()
        for option_id in option_ids:
            option = options_by_id.get(str(option_id))
            if option is None:
                raise RuntimeError("記事オプションの参照先が存在しません。")
            option_codes.add(option.code)
            items.append(ArticleOptionService.serialize_option(option=option))

        return {
            "is_pr": OptionCode.PR in option_codes,
            "is_ad": OptionCode.AD in option_codes,
            "items": items,
        }

    @staticmethod
    def serialize_option(*, option: Option) -> dict:
        """
        記事オプションのAPI返却要素を返す。
        """
        system_codes = set(OptionCode.values)
        return {
            "id": option.id,
            "code": option.code,
            "label": option.label,
            "description": option.description or "",
            "is_system": option.code in system_codes,
        }

    @staticmethod
    def _normalize_label(*, label: str) -> str:
        """
        オプション表示名を正規化する。
        """
        normalized_label = label.strip()
        if normalized_label == "":
            raise ValidationError({"label": ["表示名は必須です。"]})
        if len(normalized_label) > 100:
            raise ValidationError({"label": ["表示名は100文字以内で入力してください。"]})
        return normalized_label

    @staticmethod
    def _normalize_description(*, description: str) -> str:
        """
        オプション説明文を正規化する。
        """
        normalized_description = description.strip()
        if normalized_description == "":
            raise ValidationError({"description": ["説明文は必須です。"]})
        return normalized_description
