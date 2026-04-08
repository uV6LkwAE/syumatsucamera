import { useEffect, useState } from 'react'
import { apiRequest } from '../../../api/client'
import CmsTabGuide from '../../../components/CmsTabGuide'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { toApiMessage } from '../helpers'
import type { CmsArticleOptionItem, CmsArticleOptionListResponse } from '../types'

type CmsOptionsPageProps = {
  embedded?: boolean
}

type OptionFormState = {
  label: string
  description: string
}

const OPTION_LABEL_MAX_LENGTH = 100

function toOptionForm(option: CmsArticleOptionItem | null): OptionFormState {
  if (option === null) {
    return {
      label: '',
      description: '',
    }
  }

  return {
    label: option.label,
    description: option.description,
  }
}

export default function CmsOptionsPage({ embedded = false }: CmsOptionsPageProps) {
  const [options, setOptions] = useState<CmsArticleOptionItem[]>([])
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [form, setForm] = useState<OptionFormState>(toOptionForm(null))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null

  useEffect(() => {
    void fetchOptions()
  }, [])

  useEffect(() => {
    setForm(toOptionForm(selectedOption))
  }, [selectedOptionId])

  async function fetchOptions(nextSelectedOptionId?: string | null): Promise<void> {
    setLoading(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<CmsArticleOptionListResponse>('/cms/article-options')
      setOptions(payload.items)
      if (nextSelectedOptionId !== undefined) {
        setSelectedOptionId(nextSelectedOptionId)
        return
      }
      if (
        selectedOptionId !== null
        && !payload.items.some((option) => option.id === selectedOptionId)
      ) {
        setSelectedOptionId(null)
      }
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoading(false)
    }
  }

  function validateForm(): boolean {
    if (form.label.trim() === '') {
      setErrorMessage('表示名は必須です。')
      return false
    }
    if (form.label.trim().length > OPTION_LABEL_MAX_LENGTH) {
      setErrorMessage(`表示名は${OPTION_LABEL_MAX_LENGTH}文字以内で入力してください。`)
      return false
    }
    if (form.description.trim() === '') {
      setErrorMessage('説明文は必須です。')
      return false
    }
    return true
  }

  async function saveOption(): Promise<void> {
    if (!validateForm()) {
      return
    }

    setSaving(true)
    setErrorMessage('')
    setMessage('')
    try {
      const body = {
        label: form.label.trim(),
        description: form.description.trim(),
      }
      const endpoint = selectedOption === null
        ? '/cms/article-options'
        : `/cms/article-options/${selectedOption.id}`
      const method = selectedOption === null ? 'POST' : 'PATCH'
      const savedOption = await apiRequest<CmsArticleOptionItem>(endpoint, {
        method,
        body,
      })
      setMessage(selectedOption === null ? 'オプションを作成しました。' : 'オプションを更新しました。')
      await fetchOptions(savedOption.id)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteOption(): Promise<void> {
    if (selectedOption === null) {
      setErrorMessage('削除対象のオプションを選択してください。')
      return
    }
    if (!window.confirm(`「${selectedOption.label}」を削除します。記事に紐づいている場合は削除できません。`)) {
      return
    }

    setDeleting(true)
    setErrorMessage('')
    setMessage('')
    try {
      await apiRequest(`/cms/article-options/${selectedOption.id}`, {
        method: 'DELETE',
      })
      setMessage('オプションを削除しました。')
      setSelectedOptionId(null)
      setForm(toOptionForm(null))
      await fetchOptions(null)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}
      <CmsTabGuide
        title="オプションの作成と編集"
        helpLines={[
          '記事に付与するオプションをここで管理します。',
          '記事に紐づいているオプションは削除できません。',
          '記事執筆画面では、ここで作成済みの選択肢だけを選びます。',
        ]}
      />

      <section className="cms-options-shell row g-4">
        <div className="col-12 col-xl-7">
          <div className="console-card">
            <div className="console-card-header">
              <h2>オプション一覧</h2>
              <p>{loading ? '読み込み中です。' : `${options.length}件`}</p>
            </div>
            {options.length === 0 ? (
              <div className="console-placeholder">オプションがありません。</div>
            ) : (
              <div className="table-responsive console-table-scroll">
                <table className="table table-hover align-middle mb-0 console-table-basic cms-options-table">
                  <thead>
                    <tr>
                      <th>表示名</th>
                      <th>説明文</th>
                      <th>種別</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.map((option) => (
                      <tr
                        key={option.id}
                        className={option.id === selectedOptionId ? 'is-selected' : ''}
                      >
                        <td>{option.label}</td>
                        <td className="cms-options-table-text">{option.description}</td>
                        <td>{option.is_system ? '固定' : '任意'}</td>
                        <td className="console-actions-inline">
                          <button
                            type="button"
                            className="console-secondary"
                            onClick={() => setSelectedOptionId(option.id)}
                          >
                            編集
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="console-card cms-options-form-card">
            <div className="console-card-header">
              <h2>{selectedOption === null ? '新規作成' : 'オプション編集'}</h2>
              <p>表示名と説明文をセットで保存します。</p>
            </div>
            <div className="console-form-grid row g-3">
              <label className="console-label col-12">
                <span className="cms-article-field-head">
                  <span>表示名</span>
                  <span className="cms-article-field-counter">
                    {form.label.length}/{OPTION_LABEL_MAX_LENGTH}
                  </span>
                </span>
                <input
                  className="console-input form-control"
                  type="text"
                  value={form.label}
                  maxLength={OPTION_LABEL_MAX_LENGTH}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  placeholder="例: PR"
                />
              </label>
              <label className="console-label col-12">
                説明文
                <textarea
                  className="console-textarea form-control cms-options-description-textarea"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="例: メーカーより製品提供を受けた記事です。"
                />
              </label>
              <div className="console-actions col-12 d-flex flex-wrap justify-content-end">
                {selectedOption !== null && (
                  <button
                    type="button"
                    className="console-secondary"
                    onClick={() => {
                      setSelectedOptionId(null)
                      setForm(toOptionForm(null))
                    }}
                    disabled={saving || deleting}
                  >
                    新規作成へ戻る
                  </button>
                )}
                {selectedOption !== null && !selectedOption.is_system && (
                  <button
                    type="button"
                    className="console-secondary"
                    onClick={() => void deleteOption()}
                    disabled={saving || deleting}
                  >
                    削除
                  </button>
                )}
                <button
                  type="button"
                  className="console-primary"
                  onClick={() => void saveOption()}
                  disabled={saving || deleting}
                >
                  {selectedOption === null ? '作成する' : '保存する'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded">{content}</div>
  }

  return <div className="console-dashboard">{content}</div>
}
