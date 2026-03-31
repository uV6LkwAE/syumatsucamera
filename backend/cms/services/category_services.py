"""
カテゴリ管理サービスを定義する。
"""
from django.db import IntegrityError, transaction
from rest_framework.exceptions import NotFound, ValidationError

from cms.models import Article, Category
from cms.services.common import unique_slugify


class CategoryService:
    """
    カテゴリ管理の業務ロジックを扱う。
    """

    @staticmethod
    def list_category_tree(*, limit: int) -> dict:
        """
        カテゴリツリーを返す。
        """
        categories = list(
            Category.objects.select_related("parent").order_by("sort_order", "name")[:limit]
        )
        children_by_parent: dict[str | None, list[Category]] = {}
        for category in categories:
            parent_id = str(category.parent_id) if category.parent_id else None
            children_by_parent.setdefault(parent_id, []).append(category)

        def build_node(category: Category) -> dict:
            return {
                "id": category.id,
                "name": category.name,
                "slug": category.slug,
                "parent_id": category.parent_id,
                "sort_order": category.sort_order,
                "children": [
                    build_node(child)
                    for child in children_by_parent.get(str(category.id), [])
                ],
            }

        return {
            "items": [
                build_node(category)
                for category in children_by_parent.get(None, [])
            ]
        }

    @staticmethod
    @transaction.atomic
    def create_category(*, name: str, parent_id) -> Category:
        """
        カテゴリを新規作成する。
        """
        parent = None
        if parent_id is not None:
            try:
                parent = Category.objects.get(id=parent_id)
            except Category.DoesNotExist as exc:
                raise NotFound("親カテゴリが存在しません。") from exc

        sibling_slugs = Category.objects.values_list("slug", flat=True)
        slug = unique_slugify(value=name, existing_slugs=sibling_slugs)
        sort_order = Category.objects.filter(parent=parent).count()
        try:
            category = Category.objects.create(
                name=name.strip(),
                slug=slug,
                parent=parent,
                sort_order=sort_order,
            )
        except IntegrityError as exc:
            raise ValidationError({"name": ["同名のカテゴリは作成できません。"]}) from exc
        return category

    @staticmethod
    @transaction.atomic
    def update_category(
        *,
        category_id,
        name: str,
        parent_id,
        ordered_sibling_category_ids: list,
    ) -> Category:
        """
        カテゴリ情報と兄弟順を更新する。
        """
        try:
            category = Category.objects.select_related("parent").get(id=category_id)
        except Category.DoesNotExist as exc:
            raise NotFound("カテゴリが存在しません。") from exc

        parent = None
        if parent_id is not None:
            try:
                parent = Category.objects.get(id=parent_id)
            except Category.DoesNotExist as exc:
                raise NotFound("親カテゴリが存在しません。") from exc
            if parent.id == category.id:
                raise ValidationError({"parent_id": ["カテゴリ自身を親にはできません。"]})

        sibling_queryset = Category.objects.filter(parent=parent).exclude(id=category.id)
        CategoryService._validate_ordering(
            expected_ids=list(sibling_queryset.values_list("id", flat=True)) + [category.id],
            ordered_ids=ordered_sibling_category_ids,
        )

        slug_queryset = Category.objects.exclude(id=category.id).values_list("slug", flat=True)
        category.name = name.strip()
        category.slug = unique_slugify(value=name, existing_slugs=slug_queryset)
        category.parent = parent
        try:
            category.save(update_fields=["name", "slug", "parent", "updated_at"])
        except IntegrityError as exc:
            raise ValidationError({"name": ["同名のカテゴリは更新できません。"]}) from exc

        CategoryService._apply_sibling_order(
            ordered_sibling_category_ids=ordered_sibling_category_ids,
            parent=parent,
        )
        return category

    @staticmethod
    @transaction.atomic
    def delete_category(
        *,
        category_id,
        parent_id,
        ordered_sibling_category_ids: list,
    ) -> None:
        """
        カテゴリを削除し残り兄弟順を更新する。
        """
        try:
            category = Category.objects.get(id=category_id)
        except Category.DoesNotExist as exc:
            raise NotFound("カテゴリが存在しません。") from exc

        if category.children.exists():
            raise ValidationError("子カテゴリを持つカテゴリは削除できません。")
        if Article.objects.filter(category=category).exists():
            raise ValidationError("記事に紐づくカテゴリは削除できません。")

        expected_parent_id = str(category.parent_id) if category.parent_id else None
        requested_parent_id = str(parent_id) if parent_id else None
        if expected_parent_id != requested_parent_id:
            raise ValidationError({"parent_id": ["削除対象カテゴリの親情報が一致しません。"]})

        remaining_ids = list(
            Category.objects.filter(parent_id=category.parent_id).exclude(id=category.id).values_list(
                "id",
                flat=True,
            )
        )
        CategoryService._validate_ordering(
            expected_ids=remaining_ids,
            ordered_ids=ordered_sibling_category_ids,
        )

        category.delete()
        CategoryService._apply_sibling_order(
            ordered_sibling_category_ids=ordered_sibling_category_ids,
            parent=category.parent,
        )

    @staticmethod
    def _validate_ordering(*, expected_ids: list, ordered_ids: list) -> None:
        """
        同一親配下のカテゴリ順指定が完全一致か検証する。
        """
        expected_set = {str(value) for value in expected_ids}
        ordered_set = {str(value) for value in ordered_ids}
        if expected_set != ordered_set or len(expected_ids) != len(ordered_ids):
            raise ValidationError(
                {"ordered_sibling_category_ids": ["兄弟カテゴリIDの並びが不正です。"]}
            )

    @staticmethod
    def _apply_sibling_order(*, ordered_sibling_category_ids: list, parent) -> None:
        """
        兄弟カテゴリ順を保存する。
        """
        categories = {
            str(category.id): category
            for category in Category.objects.filter(id__in=ordered_sibling_category_ids)
        }
        for sort_order, category_id in enumerate(ordered_sibling_category_ids):
            category = categories[str(category_id)]
            category.parent = parent
            category.sort_order = sort_order
            category.save(update_fields=["parent", "sort_order", "updated_at"])
