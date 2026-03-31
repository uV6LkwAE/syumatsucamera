import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import ConsoleHeroCard from '../../../components/ConsoleHeroCard'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { formatCmsDate, toApiMessage } from '../helpers'
import type { CmsArticleListResponse, CmsArticleStatus } from '../types'

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
  const [message, setMessage] = useState(locationState?.notice ?? '')
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<CmsArticleFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = useState<CmsArticleFilters>(DEFAULT_FILTERS)

  useEffect(() => {
    if (locationState?.notice === undefined) {
      return
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, locationState?.notice, navigate])

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
    void fetchArticles()
  }, [page, limit, filters])

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

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <div className="console-card">
        <div className="console-card-header">
          <h2>記事一覧</h2>
          <p>保存済みの記事を検索し、編集や削除、公開状態の確認を行います。</p>
        </div>

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
              <option value="">すべて</option>
              <option value="draft">下書き</option>
              <option value="private">非公開</option>
              <option value="publish">公開</option>
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
              <option value="newest">新しい順</option>
              <option value="oldest">古い順</option>
              <option value="popular">人気順</option>
            </select>
          </label>
          <label className="console-label">
            執筆者ID
            <input
              className="console-input"
              type="text"
              value={draftFilters.author}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, author: event.target.value }))
              }
              placeholder="管理者向け"
            />
          </label>
        </div>

        <div className="console-actions console-actions-spread">
          <div className="console-actions">
            <button
              type="button"
              className="console-primary"
              onClick={() => {
                setPage(1)
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
            <div className="console-static-value">
              合計: {totalCount}件 / {page}ページ目（全{totalPages}ページ）
            </div>
          </div>
          <div className="console-actions">
            <label className="console-inline-label">
              表示件数
              <select
                className="console-select"
                value={limit}
                onChange={(event) => {
                  setPage(1)
                  setLimit(Number(event.target.value))
                }}
              >
                <option value={20}>20件</option>
                <option value={50}>50件</option>
                <option value={100}>100件</option>
              </select>
            </label>
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
              onClick={() => void fetchArticles()}
              disabled={loading}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              更新
            </button>
          </div>
        </div>

        <div className="console-table-scroll">
          <table className="console-table-basic">
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
              {articles.map((article) => (
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
              ))}
            </tbody>
          </table>
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
        badge="記事"
        title="記事管理"
        subtitle="一覧、検索、編集、削除をまとめて扱います。"
        icon="bi-file-earmark-text"
      />
      {content}
    </div>
  )
}
