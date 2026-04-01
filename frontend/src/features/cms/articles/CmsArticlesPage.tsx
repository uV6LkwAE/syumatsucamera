import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import ConsoleHeroCard from '../../../components/ConsoleHeroCard'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { formatCmsDate, toApiMessage } from '../helpers'
import type {
  CmsArticleAuthorOptionListResponse,
  CmsArticleListResponse,
  CmsArticleStatus,
} from '../types'

type CmsArticlesPageProps = {
  embedded?: boolean
}

type CmsArticleFilters = {
  title: string
  status: '' | CmsArticleStatus
  ordering: 'newest' | 'oldest' | 'popular'
  author: string
}

type CmsArticleLocationState = {
  notice?: string
}

const DEFAULT_FILTERS: CmsArticleFilters = {
  title: '',
  status: '',
  ordering: 'newest',
  author: '',
}

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'draft', label: '下書き' },
  { value: 'private', label: '非公開' },
  { value: 'publish', label: '公開' },
]

const ORDERING_OPTIONS = [
  { value: 'newest', label: '新しい順' },
  { value: 'oldest', label: '古い順' },
  { value: 'popular', label: '人気順' },
]

const LIMIT_OPTIONS = [
  { value: '20', label: '20件' },
  { value: '50', label: '50件' },
  { value: '100', label: '100件' },
]

function toStatusLabel(status: CmsArticleStatus): string {
  if (status === 'draft') {
    return '下書き'
  }
  if (status === 'publish') {
    return '公開'
  }
  return '非公開'
}

function toImageJobStatusLabel(status: string): string {
  if (status === 'pending') {
    return '待機'
  }
  if (status === 'processing') {
    return '処理中'
  }
  if (status === 'completed') {
    return '完了'
  }
  return '失敗'
}

export default function CmsArticlesPage({ embedded = false }: CmsArticlesPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as CmsArticleLocationState | null

  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [articles, setArticles] = useState<CmsArticleListResponse['items']>([])
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingAuthors, setLoadingAuthors] = useState(false)
  const [message, setMessage] = useState(locationState?.notice ?? '')
  const [errorMessage, setErrorMessage] = useState('')
  const [authorOptions, setAuthorOptions] = useState<Array<{ value: string; label: string }>>([])
  const [filters, setFilters] = useState<CmsArticleFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<CmsArticleFilters>(DEFAULT_FILTERS)
  const [filtersExpanded, setFiltersExpanded] = useState(true)

  useEffect(() => {
    if (locationState?.notice === undefined) {
      return
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, locationState?.notice, navigate])

  async function fetchAuthorOptions(): Promise<void> {
    setLoadingAuthors(true)

    try {
      const payload = await apiRequest<CmsArticleAuthorOptionListResponse>('/cms/article-authors')
      setAuthorOptions(
        payload.items.map((item) => ({
          value: item.id,
          label: item.display_name,
        })),
      )
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoadingAuthors(false)
    }
  }

  const authorSelectOptions = useMemo(() => {
    if (loadingAuthors) {
      return [{ value: '', label: '執筆者を取得中' }]
    }

    if (authorOptions.length === 0) {
      return [{ value: '', label: '執筆者はいません' }]
    }

    return [{ value: '', label: 'すべての執筆者' }, ...authorOptions]
  }, [authorOptions, loadingAuthors])

  const appliedFilterCount = useMemo(() => {
    let count = 0

    if (filters.title.trim() !== '') {
      count += 1
    }
    if (filters.status !== '') {
      count += 1
    }
    if (filters.ordering !== DEFAULT_FILTERS.ordering) {
      count += 1
    }
    if (filters.author.trim() !== '') {
      count += 1
    }

    return count
  }, [filters])

  async function fetchArticles(): Promise<void> {
    setLoading(true)
    setErrorMessage('')

    const searchParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ordering: filters.ordering,
    })
    if (filters.title.trim() !== '') {
      searchParams.set('title', filters.title.trim())
    }
    if (filters.status !== '') {
      searchParams.set('status', filters.status)
    }
    if (filters.author.trim() !== '') {
      searchParams.set('author', filters.author.trim())
    }

    try {
      const payload = await apiRequest<CmsArticleListResponse>(`/cms/articles?${searchParams.toString()}`)
      setArticles(payload.items)
      setTotalPages(payload.pagination.total_pages)
      setTotalCount(payload.pagination.total_count)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchAuthorOptions()
  }, [])

  useEffect(() => {
    void fetchArticles()
  }, [page, limit, filters])

  useEffect(() => {
    if (authorOptions.some((option) => option.value === draftFilters.author)) {
      return
    }

    if (draftFilters.author !== '') {
      setDraftFilters((prev) => ({ ...prev, author: '' }))
    }
    if (filters.author !== '') {
      setFilters((prev) => ({ ...prev, author: '' }))
    }
  }, [authorOptions, draftFilters.author, filters.author])

  async function deleteArticle(articleId: string): Promise<void> {
    const confirmed = window.confirm('記事を削除します。元に戻せません。')
    if (!confirmed) {
      return
    }

    setErrorMessage('')
    setMessage('')
    try {
      await apiRequest(`/cms/articles/${articleId}`, {
        method: 'DELETE',
      })
      setMessage('記事を削除しました。')
      await fetchArticles()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    }
  }

  const hero = (
    <ConsoleHeroCard
      badge="記事"
      title="記事管理"
      subtitle="まず絞り込みで対象を見つけてから、編集や削除へ進みます。"
      icon="bi-file-earmark-text"
    />
  )

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <section className="cms-article-list-shell">
        <section className="cms-article-filter-panel">
          <button
            type="button"
            className="cms-article-filter-head"
            onClick={() => setFiltersExpanded((prev) => !prev)}
            aria-expanded={filtersExpanded}
            aria-label={filtersExpanded ? '絞り込み条件を閉じる' : '絞り込み条件を開く'}
          >
            <span className="cms-article-filter-toggle-copy">
              <strong>絞り込み条件</strong>
              <span>
                {appliedFilterCount === 0
                  ? '条件を指定せず、一覧全体を表示しています。'
                  : `${appliedFilterCount}件の条件を適用中です。`}
              </span>
            </span>
            <span className="cms-article-filter-toggle" aria-hidden="true">
              <i className="bi bi-chevron-down" aria-hidden="true" />
            </span>
          </button>

          <div
            className={`console-expandable-region cms-article-filter-region${
              filtersExpanded ? ' is-expanded' : ''
            }`}
          >
            <div className="console-expandable-region-inner">
              <div className="cms-article-filter-body">
                <div className="console-form-grid cms-article-filter-grid">
                  <label className="console-label">
                    タイトル
                    <input
                      className="console-input"
                      type="text"
                      value={draftFilters.title}
                      onChange={(event) =>
                        setDraftFilters((prev) => ({ ...prev, title: event.target.value }))
                      }
                      placeholder="部分一致"
                    />
                  </label>
                  <label className="console-label">
                    状態
                    <select
                      className="console-select"
                      value={draftFilters.status}
                      onChange={(event) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          status: event.target.value as CmsArticleFilters['status'],
                        }))
                      }
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="console-label">
                    並び順
                    <select
                      className="console-select"
                      value={draftFilters.ordering}
                      onChange={(event) =>
                        setDraftFilters((prev) => ({
                          ...prev,
                          ordering: event.target.value as CmsArticleFilters['ordering'],
                        }))
                      }
                    >
                      {ORDERING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="console-label">
                    執筆者
                    <select
                      className="console-select"
                      value={draftFilters.author}
                      onChange={(event) =>
                        setDraftFilters((prev) => ({ ...prev, author: event.target.value }))
                      }
                      disabled={loadingAuthors || authorOptions.length === 0}
                    >
                      {authorSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="cms-article-filter-actions">
                  <button
                    type="button"
                    className="console-primary"
                    onClick={() => {
                      setPage(1)
                      setFiltersExpanded(false)
                      setFilters({
                        title: draftFilters.title.trim(),
                        status: draftFilters.status,
                        ordering: draftFilters.ordering,
                        author: draftFilters.author.trim(),
                      })
                    }}
                  >
                    絞り込む
                  </button>
                  <button
                    type="button"
                    className="console-secondary"
                    onClick={() => {
                      setPage(1)
                      setDraftFilters(DEFAULT_FILTERS)
                      setFilters(DEFAULT_FILTERS)
                    }}
                  >
                    リセット
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr className="cms-console-divider cms-article-section-divider" />

        <div className="cms-article-toolbar">
          <div className="cms-article-toolbar-meta">
            <p className="cms-article-toolbar-stat">
              合計 {totalCount}件 / {page}ページ目 / 全{totalPages}ページ
            </p>
            <label className="console-inline-label cms-article-limit-field">
              <span>表示件数</span>
              <select
                className="console-select"
                value={limit}
                onChange={(event) => {
                  setPage(1)
                  setLimit(Number(event.target.value))
                }}
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="cms-article-toolbar-actions">
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={loading || page <= 1}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
              前へ
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
              disabled={loading || page >= totalPages}
            >
              次へ
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => {
                void fetchArticles()
                void fetchAuthorOptions()
              }}
              disabled={loading || loadingAuthors}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              更新
            </button>
          </div>
        </div>

        <hr className="cms-console-divider cms-article-section-divider" />

        <div className="console-table-scroll cms-article-table-scroll">
          <table className="console-table-basic cms-article-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>カテゴリ</th>
                <th>執筆者</th>
                <th>状態</th>
                <th>画像処理</th>
                <th>PV</th>
                <th>更新日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr>
                  <td className="cms-article-empty-cell" colSpan={8}>
                    <div className="cms-article-empty-state">
                      <strong>表示できる記事はありません。</strong>
                      <span>条件を変えて再検索するか、新しい記事を作成してください。</span>
                    </div>
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <div className="cms-article-title-cell">
                        <strong>{article.title}</strong>
                        <span>{article.path}</span>
                      </div>
                    </td>
                    <td>{article.category.name}</td>
                    <td>{article.author.display_name ?? '未設定'}</td>
                    <td>{toStatusLabel(article.status)}</td>
                    <td>
                      <span className={`cms-job-badge is-${article.image_job_status}`}>
                        {toImageJobStatusLabel(article.image_job_status)}
                      </span>
                    </td>
                    <td>{article.views_total.toLocaleString('ja-JP')}</td>
                    <td>{formatCmsDate(article.updated_at)}</td>
                    <td className="console-actions-inline">
                      <Link className="console-secondary" to={`/cms/console/articles/${article.id}/edit`}>
                        編集
                      </Link>
                      <button
                        type="button"
                        className="console-secondary"
                        onClick={() => void deleteArticle(article.id)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
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
