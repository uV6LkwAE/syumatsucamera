import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import CmsTabGuide from '../../../components/CmsTabGuide'
import ConsoleDropdown, { ConsoleDropdownOption } from '../../../components/ConsoleDropdown'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { formatCmsDate, toApiMessage } from '../helpers'
import type {
  CmsPublishRequestItem,
  CmsPublishRequestListResponse,
  CmsPublishRequestStatus,
} from '../types'

type CmsPublishRequestsPageProps = {
  embedded?: boolean
}

const STATUS_OPTIONS: Array<ConsoleDropdownOption<'' | CmsPublishRequestStatus>> = [
  { value: 'pending', label: '申請中' },
  { value: 'approved', label: '承認' },
  { value: 'rejected', label: '却下' },
  { value: '', label: 'すべて' },
]

const LIMIT_OPTIONS: Array<ConsoleDropdownOption<number>> = [
  { value: 20, label: '20件' },
  { value: 50, label: '50件' },
  { value: 100, label: '100件' },
]

function toRequestStatusLabel(status: CmsPublishRequestStatus): string {
  if (status === 'pending') {
    return '申請中'
  }
  if (status === 'approved') {
    return '承認'
  }
  return '却下'
}

function toRequestStatusBadgeClass(status: CmsPublishRequestStatus): string {
  if (status === 'pending') {
    return 'is-pending'
  }
  if (status === 'approved') {
    return 'is-approved'
  }
  return 'is-rejected'
}

export default function CmsPublishRequestsPage({
  embedded = false,
}: CmsPublishRequestsPageProps) {
  const [requests, setRequests] = useState<CmsPublishRequestItem[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [statusFilter, setStatusFilter] = useState<'' | CmsPublishRequestStatus>('pending')
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  async function fetchRequests(): Promise<void> {
    setLoading(true)
    setErrorMessage('')

    const searchParams = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (statusFilter !== '') {
      searchParams.set('status', statusFilter)
    }

    try {
      const payload = await apiRequest<CmsPublishRequestListResponse>(
        `/cms/publish-requests?${searchParams.toString()}`,
      )
      setRequests(payload.items)
      setTotalCount(payload.pagination.total_count)
      setTotalPages(payload.pagination.total_pages)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchRequests()
  }, [page, limit, statusFilter])

  async function approveRequest(requestId: string, articleTitle: string): Promise<void> {
    const confirmed = window.confirm(`「${articleTitle}」の公開申請を承認します。`)
    if (!confirmed) {
      return
    }

    setProcessingRequestId(requestId)
    setErrorMessage('')
    setMessage('')
    try {
      await apiRequest(`/cms/publish-requests/${requestId}/approve`, {
        method: 'POST',
      })
      setMessage('公開申請を承認しました。')
      await fetchRequests()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setProcessingRequestId(null)
    }
  }

  async function rejectRequest(requestId: string, articleTitle: string): Promise<void> {
    const note = window.prompt(`「${articleTitle}」の却下理由を入力してください。`, '')
    if (note === null) {
      return
    }

    setProcessingRequestId(requestId)
    setErrorMessage('')
    setMessage('')
    try {
      await apiRequest(`/cms/publish-requests/${requestId}/reject`, {
        method: 'POST',
        body: {
          note: note.trim(),
        },
      })
      setMessage('公開申請を却下しました。')
      await fetchRequests()
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setProcessingRequestId(null)
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <CmsTabGuide
        title="公開申請の確認と対応"
        helpLines={[
          '申請中の記事を確認し、内容に問題がなければ承認してください。',
          '差し戻しが必要な場合は却下し、必要に応じて理由を残してください。',
          '対象記事は操作列から執筆タブで開けます。',
        ]}
      />

      <section className="cms-request-list-shell">
        <div className="cms-article-toolbar row g-3 align-items-center">
          <div className="cms-article-toolbar-meta col-12 col-lg d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
            <p className="cms-article-toolbar-stat">
              合計 {totalCount}件 / {page}ページ目 / 全{totalPages}ページ
            </p>
            <label className="console-inline-label cms-article-limit-field d-inline-flex align-items-center gap-2">
              <span>状態</span>
              <ConsoleDropdown
                id="cms-publish-request-status"
                name="status"
                value={statusFilter}
                options={STATUS_OPTIONS}
                fullWidth={false}
                onChange={(nextValue) => {
                  setPage(1)
                  setStatusFilter(nextValue)
                }}
              />
            </label>
            <label className="console-inline-label cms-article-limit-field d-inline-flex align-items-center gap-2">
              <span>表示件数</span>
              <ConsoleDropdown
                id="cms-publish-request-limit"
                name="limit"
                value={limit}
                options={LIMIT_OPTIONS}
                fullWidth={false}
                onChange={(nextValue) => {
                  setPage(1)
                  setLimit(nextValue)
                }}
              />
            </label>
          </div>

          <div className="cms-article-toolbar-actions col-12 col-lg-auto d-flex flex-wrap justify-content-start justify-content-lg-end gap-2">
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={loading || processingRequestId !== null || page <= 1}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
              前へ
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
              disabled={loading || processingRequestId !== null || page >= totalPages}
            >
              次へ
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => void fetchRequests()}
              disabled={loading || processingRequestId !== null}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              更新
            </button>
          </div>
        </div>

        <div className="console-table-scroll cms-request-table-scroll">
          <table className="console-table-basic cms-request-table">
            <thead>
              <tr>
                <th>記事</th>
                <th>申請者</th>
                <th>申請日時</th>
                <th>状態</th>
                <th>対応者</th>
                <th>対応日時</th>
                <th>メモ</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td className="cms-article-empty-cell" colSpan={8}>
                    <div className="cms-article-empty-state">
                      <strong>表示できる公開申請はありません。</strong>
                      <span>状態を切り替えるか、記事側から新しい公開申請を作成してください。</span>
                    </div>
                  </td>
                </tr>
              ) : (
                requests.map((requestItem) => (
                  <tr key={requestItem.id}>
                    <td>
                      <div className="cms-request-article-cell">
                        <strong>{requestItem.article.title}</strong>
                        <span>{requestItem.article.path}</span>
                      </div>
                    </td>
                    <td>{requestItem.requested_by.display_name ?? '未設定'}</td>
                    <td>{formatCmsDate(requestItem.requested_at)}</td>
                    <td>
                      <span
                        className={`cms-request-status-badge ${toRequestStatusBadgeClass(requestItem.status)}`}
                      >
                        {toRequestStatusLabel(requestItem.status)}
                      </span>
                    </td>
                    <td>{requestItem.handled_by?.display_name ?? '-'}</td>
                    <td>{formatCmsDate(requestItem.handled_at)}</td>
                    <td className="cms-request-note-cell">{requestItem.note?.trim() || '-'}</td>
                    <td className="console-actions-inline cms-request-actions-cell">
                      <Link
                        className="console-secondary"
                        to={`/cms/console/articles/${requestItem.article_id}/edit`}
                      >
                        編集
                      </Link>
                      {requestItem.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="console-secondary"
                            onClick={() =>
                              void approveRequest(
                                requestItem.id,
                                requestItem.article.title,
                              )
                            }
                            disabled={loading || processingRequestId !== null}
                          >
                            承認
                          </button>
                          <button
                            type="button"
                            className="console-secondary"
                            onClick={() =>
                              void rejectRequest(
                                requestItem.id,
                                requestItem.article.title,
                              )
                            }
                            disabled={loading || processingRequestId !== null}
                          >
                            却下
                          </button>
                        </>
                      ) : (
                        <span className="cms-request-action-state">処理済み</span>
                      )}
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
    return <div className="cms-tab-embedded">{content}</div>
  }

  return <div className="console-dashboard">{content}</div>
}
