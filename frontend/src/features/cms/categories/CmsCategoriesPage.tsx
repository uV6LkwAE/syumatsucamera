import { useEffect, useState } from 'react'
import { apiRequest } from '../../../api/client'
import ConsoleHeroCard from '../../../components/ConsoleHeroCard'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { flattenCmsCategoryTree, toApiMessage } from '../helpers'
import type { CmsCategoryNode, CmsCategoryTreeResponse } from '../types'

type CmsCategoriesPageProps = {
  embedded?: boolean
}

type CategoryFormState = {
  name: string
  parentId: string
}

const EMPTY_CATEGORY_FORM: CategoryFormState = {
  name: '',
  parentId: '',
}

export default function CmsCategoriesPage({ embedded = false }: CmsCategoriesPageProps) {
  const [tree, setTree] = useState<CmsCategoryNode[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [createForm, setCreateForm] = useState<CategoryFormState>(EMPTY_CATEGORY_FORM)
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [editForm, setEditForm] = useState<CategoryFormState>(EMPTY_CATEGORY_FORM)

  const flatCategories = flattenCmsCategoryTree(tree)
  const selectedCategory = flatCategories.find((category) => category.id === selectedCategoryId) ?? null

  useEffect(() => {
    void fetchCategories()
  }, [])

  async function fetchCategories(): Promise<void> {
    setLoading(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<CmsCategoryTreeResponse>('/cms/categories?limit=200')
      setTree(payload.items)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function createCategory(): Promise<void> {
    setErrorMessage('')
    setMessage('')

    try {
      await apiRequest('/cms/categories', {
        method: 'POST',
        body: {
          name: createForm.name.trim(),
          parent_id: createForm.parentId === '' ? null : createForm.parentId,
        },
      })
      setCreateForm(EMPTY_CATEGORY_FORM)
      setMessage('カテゴリを作成しました。')
      await fetchCategories()
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

  async function saveCategory(): Promise<void> {
    if (selectedCategory === null) {
      setErrorMessage('更新対象カテゴリを選択してください。')
      return
    }

    const nextParentId = editForm.parentId === '' ? null : editForm.parentId
    const siblingIds = getSiblingIds(nextParentId)
    if (!siblingIds.includes(selectedCategory.id)) {
      siblingIds.push(selectedCategory.id)
    }

    try {
      await apiRequest(`/cms/categories/${selectedCategory.id}`, {
        method: 'PATCH',
        body: {
          name: editForm.name.trim(),
          parent_id: nextParentId,
          ordered_sibling_category_ids: siblingIds,
        },
      })
      setMessage('カテゴリを更新しました。')
      await fetchCategories()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    }
  }

  async function moveCategory(direction: -1 | 1): Promise<void> {
    if (selectedCategory === null) {
      setErrorMessage('並び替え対象カテゴリを選択してください。')
      return
    }

    const siblingIds = getSiblingIds(selectedCategory.parent_id)
    const currentIndex = siblingIds.findIndex((value) => value === selectedCategory.id)
    const nextIndex = currentIndex + direction
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblingIds.length) {
      return
    }

    const reordered = [...siblingIds]
    const [target] = reordered.splice(currentIndex, 1)
    reordered.splice(nextIndex, 0, target)

    try {
      await apiRequest(`/cms/categories/${selectedCategory.id}`, {
        method: 'PATCH',
        body: {
          name: editForm.name.trim(),
          parent_id: selectedCategory.parent_id,
          ordered_sibling_category_ids: reordered,
        },
      })
      setMessage('カテゴリの並び順を更新しました。')
      await fetchCategories()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    }
  }

  async function deleteCategory(): Promise<void> {
    if (selectedCategory === null) {
      setErrorMessage('削除対象カテゴリを選択してください。')
      return
    }
    if (!window.confirm(`「${selectedCategory.name}」を削除します。`)) {
      return
    }

    const remainingSiblingIds = getSiblingIds(selectedCategory.parent_id).filter(
      (categoryId) => categoryId !== selectedCategory.id,
    )

    try {
      await apiRequest(`/cms/categories/${selectedCategory.id}`, {
        method: 'DELETE',
        body: {
          parent_id: selectedCategory.parent_id,
          ordered_sibling_category_ids: remainingSiblingIds,
        },
      })
      setSelectedCategoryId('')
      setEditForm(EMPTY_CATEGORY_FORM)
      setMessage('カテゴリを削除しました。')
      await fetchCategories()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <div className="console-card">
        <div className="console-card-header">
          <h2>カテゴリ作成</h2>
          <p>親子関係を保ったまま、新しいカテゴリを末尾に追加します。</p>
        </div>
        <div className="console-form-grid">
          <label className="console-label">
            名前
            <input
              className="console-input"
              type="text"
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </label>
          <label className="console-label">
            親カテゴリ
            <select
              className="console-select"
              value={createForm.parentId}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, parentId: event.target.value }))
              }
            >
              <option value="">ルート</option>
              {flatCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {'　'.repeat(category.depth)}
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <div className="console-actions">
            <button type="button" className="console-primary" onClick={() => void createCategory()}>
              カテゴリを追加
            </button>
          </div>
        </div>
      </div>

      <div className="console-card">
        <div className="console-card-header">
          <h2>カテゴリ管理</h2>
          <p>カテゴリ名の変更、親子変更、兄弟順の並び替え、削除を行います。</p>
        </div>
        <div className="console-actions console-actions-spread">
          <div className="console-static-value">登録数: {flatCategories.length}件</div>
          <button
            type="button"
            className="console-secondary console-icon-button"
            onClick={() => void fetchCategories()}
            disabled={loading}
          >
            <i
              className={`bi ${loading ? 'bi-arrow-repeat is-spinning' : 'bi-arrow-clockwise'}`}
              aria-hidden="true"
            />
            {loading ? '再読込中' : '更新'}
          </button>
        </div>

        <div className="cms-category-grid">
          <div className="cms-category-list">
            {flatCategories.map((category) => {
              const active = category.id === selectedCategoryId
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`cms-category-row ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedCategoryId(category.id)
                    setEditForm({
                      name: category.name,
                      parentId: category.parent_id ?? '',
                    })
                  }}
                >
                  <span className="cms-category-row-name" style={{ paddingLeft: `${category.depth * 20 + 14}px` }}>
                    {category.name}
                  </span>
                  <span className="cms-category-row-slug">{category.slug}</span>
                </button>
              )
            })}
          </div>

          <div className="cms-category-editor">
            {selectedCategory === null ? (
              <div className="console-placeholder">左の一覧からカテゴリを選択してください。</div>
            ) : (
              <>
                <label className="console-label">
                  名前
                  <input
                    className="console-input"
                    type="text"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </label>
                <label className="console-label">
                  親カテゴリ
                  <select
                    className="console-select"
                    value={editForm.parentId}
                    onChange={(event) =>
                      setEditForm((prev) => ({ ...prev, parentId: event.target.value }))
                    }
                  >
                    <option value="">ルート</option>
                    {flatCategories
                      .filter((category) => category.id !== selectedCategory.id)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {'　'.repeat(category.depth)}
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="console-actions">
                  <button type="button" className="console-primary" onClick={() => void saveCategory()}>
                    更新
                  </button>
                  <button type="button" className="console-secondary" onClick={() => void moveCategory(-1)}>
                    上へ
                  </button>
                  <button type="button" className="console-secondary" onClick={() => void moveCategory(1)}>
                    下へ
                  </button>
                  <button type="button" className="console-secondary" onClick={() => void deleteCategory()}>
                    削除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded">{content}</div>
  }

  return (
    <div className="console-dashboard">
      <ConsoleHeroCard
        badge="カテゴリー"
        title="カテゴリ管理"
        subtitle="ツリー構造と兄弟順を崩さずにカテゴリを整理します。"
        icon="bi-diagram-3"
      />
      {content}
    </div>
  )
}
