"""
記事タグサービスを定義する。
"""
from rest_framework.exceptions import ValidationError

from cms.models import ARTICLE_TAG_MAX_COUNT, Tag
from cms.services.common import unique_slugify


class TagService:
    """
    記事タグの解決と作成を扱う。
    """

    @staticmethod
    def resolve_tags_for_article_upsert(*, tag_ids: list, tag_names: list[str]) -> list[Tag]:
        """
        記事保存入力からタグ一覧を解決する。
        """
        resolved_tags: dict[str, Tag] = {}

        if tag_ids:
            tags = list(Tag.objects.filter(id__in=tag_ids))
            if len(tags) != len(set(map(str, tag_ids))):
                raise ValidationError({"tag_ids": ["存在しないタグが含まれています。"]})
            for tag in tags:
                resolved_tags[str(tag.id)] = tag

        for tag_name in tag_names:
            normalized_name = tag_name.strip()
            if normalized_name == "":
                raise ValidationError({"tag_names": ["タグ名は空にできません。"]})

            tag = Tag.objects.filter(name__iexact=normalized_name).first()
            if tag is None:
                tag = Tag.objects.create(
                    name=normalized_name,
                    slug=unique_slugify(
                        value=normalized_name,
                        existing_slugs=Tag.objects.values_list("slug", flat=True),
                    ),
                )
            resolved_tags[str(tag.id)] = tag

        if len(resolved_tags) > ARTICLE_TAG_MAX_COUNT:
            raise ValidationError({"tag_names": [f"タグは1記事あたり{ARTICLE_TAG_MAX_COUNT}件までです。"]})

        return list(resolved_tags.values())
