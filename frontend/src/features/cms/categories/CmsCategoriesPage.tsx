import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../../api/client'
import ApiErrorPopup from '../../../components/ApiErrorPopup'
import CmsTabGuide from '../../../components/CmsTabGuide'
import ConsoleNotice from '../../../components/ConsoleNotice'
import CmsCategoryVisualPicker from '../components/CmsCategoryVisualPicker'
import { flattenCmsCategoryTree } from '../helpers'
import type { CmsCategoryNode, CmsCategoryTreeResponse } from '../types'

type CmsCategoriesPageProps = {
  embedded?: boolean
}

export default function CmsCategoriesPage({ embedded = false }: CmsCategoriesPageProps) {
  const [tree, setTree] = useState<CmsCategoryNode[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<unknown>('')
  const [selectedCategoryId, setSelectedCategoryId] = useState('')

  const flatCategories = useMemo(() => flattenCmsCategoryTree(tree), [tree])

  useEffect(() => {
    void fetchCategories()
  }, [])

  useEffect(() => {
    if (flatCategories.length === 0) {
      setSelectedCategoryId('')
      return
    }

    if (!flatCategories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId('')
    }
  }, [flatCategories, selectedCategoryId])

  async function fetchCategories(nextSelectedCategoryId?: string): Promise<void> {
    setLoading(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<CmsCategoryTreeResponse>('/cms/categories?limit=200')
      setTree(payload.items)
      if (nextSelectedCategoryId !== undefined) {
        setSelectedCategoryId(nextSelectedCategoryId)
      }
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setLoading(false)
    }
  }

  async function createRootCategory(name: string): Promise<void> {
    setErrorMessage('')
    setMessage('')

    try {
      const created = await apiRequest<CmsCategoryNode>('/cms/categories', {
        method: 'POST',
        body: {
          name: name.trim(),
          parent_id: null,
        },
      })
      setMessage('カテゴリを作成しました。')
      await fetchCategories(created.id)
    } catch (error) {
      setErrorMessage(error)
    }
  }

  async function createChildCategory(parentId: string, name: string): Promise<void> {
    setErrorMessage('')
    setMessage('')

    try {
      const created = await apiRequest<CmsCategoryNode>('/cms/categories', {
        method: 'POST',
        body: {
          name: name.trim(),
          parent_id: parentId,
        },
      })
      setMessage('子カテゴリを作成しました。')
      await fetchCategories(created.id)
    } catch (error) {
      setErrorMessage(error)
    }
  }

  function getSiblingIds(parentId: string | null): string[] {
    return flatCategories
      .filter((category) => category.parent_id === parentId)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((category) => category.id)
  }

  async function updateCategory(categoryId: string, name: string, parentId: string): Promise<void> {
    const targetCategory = flatCategories.find((category) => category.id === categoryId)
    if (targetCategory === undefined) {
      setErrorMessage('更新対象カテゴリを選択してください。')
      return
    }

    const nextParentId = parentId.trim() === '' ? null : parentId
    const siblingIds = getSiblingIds(nextParentId)
    if (!siblingIds.includes(targetCategory.id)) {
      siblingIds.push(targetCategory.id)
    }

    try {
      await apiRequest(`/cms/categories/${targetCategory.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim(),
          parent_id: nextParentId,
          ordered_sibling_category_ids: siblingIds,
        },
      })
      setSelectedCategoryId(targetCategory.id)
      setMessage('カテゴリを更新しました。')
      await fetchCategories(targetCategory.id)
    } catch (error) {
      setErrorMessage(error)
    }
  }

  async function deleteCategory(category: CmsCategoryNode): Promise<void> {
    const targetCategory = flatCategories.find((item) => item.id === category.id)
    if (targetCategory === undefined) {
      setErrorMessage('削除対象カテゴリを選択してください。')
      return
    }
    if (category.children.length > 0) {
      setErrorMessage('子カテゴリを持つカテゴリは削除できません。先に子カテゴリを移動または削除してください。')
      return
    }
    if (!window.confirm(`「${targetCategory.name}」を削除します。`)) {
      return
    }

    const remainingSiblingIds = getSiblingIds(targetCategory.parent_id).filter(
      (categoryId) => categoryId !== targetCategory.id,
    )

    try {
      await apiRequest(`/cms/categories/${targetCategory.id}`, {
        method: 'DELETE',
        body: {
          parent_id: targetCategory.parent_id,
          ordered_sibling_category_ids: remainingSiblingIds,
        },
      })
      setSelectedCategoryId('')
      setMessage('カテゴリを削除しました。')
      await fetchCategories(targetCategory.parent_id ?? undefined)
    } catch (error) {
      setErrorMessage(error)
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      <ApiErrorPopup error={errorMessage} onClose={() => setErrorMessage('')} />
      <CmsTabGuide
        title="カテゴリーの作成と編集"
        helpLines={[
          '拡大縮小ができます。',
          'カテゴリーをホバーすることで編集, 追加, 削除ができます。',
          '既に記事に紐づいているカテゴリーは削除できません。',
        ]}
      />

      <div className="console-card">
        <CmsCategoryVisualPicker
          items={tree}
          selectedId={selectedCategoryId}
          onSelect={setSelectedCategoryId}
          mode="manage"
          onRefresh={fetchCategories}
          refreshDisabled={loading}
          onCreateRoot={createRootCategory}
          onCreateChild={createChildCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
        />
      </div>
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded">{content}</div>
  }

  return (
    <div className="console-dashboard">
      {content}
    </div>
  )
}
