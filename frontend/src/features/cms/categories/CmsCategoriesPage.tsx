import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../../api/client'
import ConsoleHeroCard from '../../../components/ConsoleHeroCard'
import ConsoleNotice from '../../../components/ConsoleNotice'
import CmsCategoryVisualPicker from '../components/CmsCategoryVisualPicker'
import { flattenCmsCategoryTree, toApiMessage } from '../helpers'
import type { CmsCategoryNode, CmsCategoryTreeResponse } from '../types'

type CmsCategoriesPageProps = {
  embedded?: boolean
}

export default function CmsCategoriesPage({ embedded = false }: CmsCategoriesPageProps) {
  const [tree, setTree] = useState<CmsCategoryNode[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
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
      setSelectedCategoryId(flatCategories[0].id)
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
      setErrorMessage(toApiMessage(error))
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
      setErrorMessage(toApiMessage(error))
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
      setErrorMessage(toApiMessage(error))
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
      setErrorMessage(toApiMessage(error))
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
      setErrorMessage(toApiMessage(error))
    }
  }

  const hero = (
    <ConsoleHeroCard
      badge="カテゴリー"
      title="カテゴリ管理"
      subtitle="左から右へ階層を追いながら、親子関係を崩さず整理します。"
      icon="bi-diagram-3"
    />
  )

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <div className="console-card">
        <div className="console-card-header">
          <div className="cms-category-header-row">
            <h2>カテゴリ構造</h2>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => void fetchCategories()}
              disabled={loading}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              更新
            </button>
          </div>
          <p>gradexpo のスクール/学部追加UIに合わせて、親子関係を見ながら追加と選択を行います。</p>
        </div>
        <CmsCategoryVisualPicker
          items={tree}
          selectedId={selectedCategoryId}
          onSelect={setSelectedCategoryId}
          mode="manage"
          onCreateRoot={createRootCategory}
          onCreateChild={createChildCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
        />
      </div>
    </>
  )

  if (embedded) {
    return (
      <div className="cms-tab-embedded">
        {hero}
        <hr className="cms-console-divider" />
        {content}
      </div>
    )
  }

  return (
    <div className="console-dashboard">
      {hero}
      {content}
    </div>
  )
}
