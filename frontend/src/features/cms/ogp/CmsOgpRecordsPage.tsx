import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import CmsTabGuide from '../../../components/CmsTabGuide'
import ConsoleDropdown, { ConsoleDropdownOption } from '../../../components/ConsoleDropdown'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { formatCmsDate, toApiMessage } from '../helpers'
import type {
  CmsAcceptedJob,
  CmsOgpRecord,
  CmsOgpRecordListResponse,
} from '../types'

type CmsOgpRecordsPageProps = {
  embedded?: boolean
}

type OGPFormState = {
  title: string
  summary: string
  thumbnail: string
  site_name: string
}

const LIMIT_OPTIONS: Array<ConsoleDropdownOption<number>> = [
  { value: 20, label: '20件' },
  { value: 50, label: '50件' },
  { value: 100, label: '100件' },
]

function toOgpFormState(record: CmsOgpRecord | null): OGPFormState {
  if (record === null) {
    return {
      title: '',
      summary: '',
      thumbnail: '',
      site_name: '',
    }
  }

  return {
    title: record.title ?? '',
    summary: record.summary ?? '',
    thumbnail: record.thumbnail ?? '',
    site_name: record.site_name ?? '',
  }
}

export default function CmsOgpRecordsPage({ embedded = false }: CmsOgpRecordsPageProps) {
  const [records, setRecords] = useState<CmsOgpRecord[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<CmsOgpRecord | null>(null)
  const [ogpForm, setOgpForm] = useState<OGPFormState>(toOgpFormState(null))
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [savingRecord, setSavingRecord] = useState(false)
  const [refetchingRecord, setRefetchingRecord] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const refreshTimerRef = useRef<number | null>(null)

  async function fetchOgpRecords(nextSelectedId?: string | null): Promise<void> {
    setLoadingList(true)
    setErrorMessage('')

    try {
      const searchParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      })
      const payload = await apiRequest<CmsOgpRecordListResponse>(
        `/ogp?${searchParams.toString()}`,
      )
      setRecords(payload.items)
      setPage(payload.pagination.page)
      setTotalCount(payload.pagination.total_count)
      setTotalPages(Math.max(payload.pagination.total_pages, 1))

      if (payload.items.length === 0) {
        setSelectedRecordId(null)
        setSelectedRecord(null)
        setOgpForm(toOgpFormState(null))
        return
      }

      const preferredId = nextSelectedId ?? selectedRecordId
      const resolvedId = payload.items.some((record) => record.id === preferredId)
        ? preferredId
        : payload.items[0].id
      setSelectedRecordId(resolvedId)
      setMessage('')
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setLoadingList(false)
    }
  }

  async function fetchOgpRecordDetail(ogpId: string | null): Promise<void> {
    if (ogpId === null) {
      setSelectedRecord(null)
      setOgpForm(toOgpFormState(null))
      return
    }

    setLoadingDetail(true)
    setErrorMessage('')

    try {
      const payload = await apiRequest<CmsOgpRecord>(`/ogp/${ogpId}`)
      setSelectedRecord(payload)
      setOgpForm(toOgpFormState(payload))
    } catch (error) {
      setErrorMessage(toApiMessage(error))
      setSelectedRecord(null)
      setOgpForm(toOgpFormState(null))
    } finally {
      setLoadingDetail(false)
    }
  }

  async function saveOgpRecord(): Promise<void> {
    if (selectedRecord === null) {
      return
    }

    setSavingRecord(true)
    setErrorMessage('')
    setMessage('')

    try {
      const payload = await apiRequest<CmsOgpRecord>(`/ogp/${selectedRecord.id}`, {
        method: 'PATCH',
        body: {
          title: ogpForm.title,
          summary: ogpForm.summary,
          thumbnail: ogpForm.thumbnail,
          site_name: ogpForm.site_name,
        },
      })
      setSelectedRecord(payload)
      setOgpForm(toOgpFormState(payload))
      setMessage('OGPキャッシュを更新しました。')
      await fetchOgpRecords(payload.id)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setSavingRecord(false)
    }
  }

  async function refetchOgpRecord(): Promise<void> {
    if (selectedRecord === null) {
      return
    }

    setRefetchingRecord(true)
    setErrorMessage('')
    setMessage('')

    try {
      await apiRequest<CmsAcceptedJob>(`/ogp/${selectedRecord.id}/refetch`, {
        method: 'POST',
      })
      setMessage('OGP再取得ジョブを受け付けました。数秒後に自動で再読込します。')
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = window.setTimeout(() => {
        void fetchOgpRecordDetail(selectedRecord.id)
        void fetchOgpRecords(selectedRecord.id)
        refreshTimerRef.current = null
      }, 2500)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setRefetchingRecord(false)
    }
  }

  async function deleteOgpRecord(): Promise<void> {
    if (selectedRecord === null) {
      return
    }

    const confirmed = window.confirm(`このOGPキャッシュを削除します。\n${selectedRecord.url}`)
    if (!confirmed) {
      return
    }

    setDeletingRecord(true)
    setErrorMessage('')
    setMessage('')

    try {
      await apiRequest(`/ogp/${selectedRecord.id}`, {
        method: 'DELETE',
      })
      setMessage('OGPキャッシュを削除しました。')
      setSelectedRecordId(null)
      setSelectedRecord(null)
      setOgpForm(toOgpFormState(null))
      await fetchOgpRecords(null)
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setDeletingRecord(false)
    }
  }

  useEffect(() => {
    void fetchOgpRecords()
  }, [page, limit])

  useEffect(() => {
    void fetchOgpRecordDetail(selectedRecordId)
  }, [selectedRecordId])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  const hasRecord = selectedRecord !== null
  const disablesDetailActions =
    !hasRecord || loadingDetail || savingRecord || refetchingRecord || deletingRecord

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <CmsTabGuide
        title="OGPキャッシュの確認と編集"
        helpLines={[
          '記事本文内リンクから取得したOGPキャッシュを確認できます。',
          '必要に応じてタイトルやサマリーを手動修正し、再取得や削除もここで実行できます。',
          'AmazonリンクはOGPカード化対象外のため、基本的に一覧へは追加されません。',
        ]}
      />

      <section className="cms-ogp-shell container-fluid px-0">
        <div className="cms-article-toolbar row g-3 align-items-center">
          <div className="cms-article-toolbar-meta col-12 col-lg d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
            <p className="cms-article-toolbar-stat">
              合計 {totalCount}件 / {page}ページ目 / 全{totalPages}ページ
            </p>
            <div className="console-inline-label cms-article-limit-field d-inline-flex align-items-center gap-2">
              <span>表示件数</span>
              <ConsoleDropdown
                id="cms-ogp-limit"
                name="limit"
                value={limit}
                options={LIMIT_OPTIONS}
                fullWidth={false}
                onChange={(nextValue) => {
                  setPage(1)
                  setLimit(nextValue)
                }}
              />
            </div>
          </div>

          <div className="cms-article-toolbar-actions col-12 col-lg-auto d-flex flex-wrap justify-content-start justify-content-lg-end gap-2">
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={loadingList || page <= 1}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
              前へ
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
              disabled={loadingList || page >= totalPages}
            >
              次へ
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => void fetchOgpRecords(selectedRecordId)}
              disabled={loadingList}
            >
              <i className="bi bi-arrow-clockwise" aria-hidden="true" />
              更新
            </button>
          </div>
        </div>

        <div className="table-responsive console-table-scroll">
          <table className="table table-hover align-middle mb-0 console-table-basic cms-ogp-table">
            <thead>
              <tr>
                <th>サムネイル</th>
                <th>サイト名</th>
                <th>タイトル</th>
                <th>URL</th>
                <th>更新日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr
                  key={record.id}
                  className={`cms-ogp-table-row${
                    record.id === selectedRecordId ? ' is-selected' : ''
                  }`}
                  onClick={() => setSelectedRecordId(record.id)}
                >
                  <td>
                    <button
                      type="button"
                      className="cms-ogp-table-thumbnail"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedRecordId(record.id)
                      }}
                      aria-label="OGP詳細を表示"
                    >
                      {record.thumbnail?.trim() ? (
                        <img
                          src={record.thumbnail}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <i className="bi bi-image" aria-hidden="true" />
                      )}
                    </button>
                  </td>
                  <td className="cms-ogp-table-site-cell">
                    {record.site_name?.trim() || '-'}
                  </td>
                  <td className="cms-ogp-table-title-cell">
                    <button
                      type="button"
                      className="cms-ogp-table-title-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedRecordId(record.id)
                      }}
                    >
                      {record.title?.trim() || 'タイトル未取得'}
                    </button>
                  </td>
                  <td className="cms-ogp-table-url-cell">{record.url}</td>
                  <td className="cms-ogp-table-date-cell">{formatCmsDate(record.updated_at)}</td>
                  <td className="console-actions-inline cms-ogp-table-actions">
                    <button
                      type="button"
                      className="console-secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedRecordId(record.id)
                      }}
                    >
                      詳細
                    </button>
                    <Link
                      className="console-secondary"
                      to={`/cms/console/articles/${record.article_id}/edit`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      記事
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedRecord !== null && (
          <section className="console-card cms-ogp-detail-card">
            <div className="console-card-header">
              <div>
                <h2>OGP詳細/更新</h2>
                <p>{selectedRecord.url}</p>
              </div>
            </div>

            <div className="cms-ogp-detail-body">
              <div className="cms-ogp-preview-card">
                <div className="cms-ogp-preview-image">
                  {selectedRecord.thumbnail?.trim() ? (
                    <img
                      src={selectedRecord.thumbnail}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <i className="bi bi-image" aria-hidden="true" />
                  )}
                </div>
                <div className="cms-ogp-preview-copy">
                  <strong>{selectedRecord.title?.trim() || 'タイトル未取得'}</strong>
                  <p>{selectedRecord.summary?.trim() || 'サマリー未取得'}</p>
                  <span>{selectedRecord.site_name?.trim() || selectedRecord.url}</span>
                </div>
              </div>

              <dl className="cms-ogp-detail-meta">
                <div>
                  <dt>記事ID</dt>
                  <dd>{selectedRecord.article_id}</dd>
                </div>
                <div>
                  <dt>更新日時</dt>
                  <dd>{formatCmsDate(selectedRecord.updated_at)}</dd>
                </div>
              </dl>

              <div className="console-form-grid row g-3">
                <label className="console-label col-12 col-lg-6" htmlFor="cms-ogp-site-name">
                  サイト名
                  <input
                    id="cms-ogp-site-name"
                    name="site_name"
                    type="text"
                    className="console-input form-control"
                    value={ogpForm.site_name}
                    onChange={(event) =>
                      setOgpForm((prev) => ({
                        ...prev,
                        site_name: event.target.value,
                      }))
                    }
                    disabled={disablesDetailActions}
                  />
                </label>

                <label className="console-label col-12 col-lg-6" htmlFor="cms-ogp-title">
                  タイトル
                  <input
                    id="cms-ogp-title"
                    name="title"
                    type="text"
                    className="console-input form-control"
                    value={ogpForm.title}
                    onChange={(event) =>
                      setOgpForm((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    disabled={disablesDetailActions}
                  />
                </label>

                <label className="console-label col-12" htmlFor="cms-ogp-summary">
                  サマリー
                  <textarea
                    id="cms-ogp-summary"
                    name="summary"
                    className="console-textarea form-control cms-ogp-summary-input"
                    value={ogpForm.summary}
                    onChange={(event) =>
                      setOgpForm((prev) => ({
                        ...prev,
                        summary: event.target.value,
                      }))
                    }
                    disabled={disablesDetailActions}
                  />
                </label>

                <label className="console-label col-12" htmlFor="cms-ogp-thumbnail">
                  サムネイルURL
                  <input
                    id="cms-ogp-thumbnail"
                    name="thumbnail"
                    type="url"
                    className="console-input form-control"
                    value={ogpForm.thumbnail}
                    onChange={(event) =>
                      setOgpForm((prev) => ({
                        ...prev,
                        thumbnail: event.target.value,
                      }))
                    }
                    disabled={disablesDetailActions}
                  />
                </label>
              </div>

              <div className="cms-ogp-actions d-flex flex-wrap justify-content-end gap-2">
                <Link
                  className="console-secondary console-icon-button"
                  to={`/cms/console/articles/${selectedRecord.article_id}/edit`}
                >
                  <i className="bi bi-pencil-square" aria-hidden="true" />
                  記事を開く
                </Link>
                <button
                  type="button"
                  className="console-secondary console-icon-button"
                  onClick={() => void refetchOgpRecord()}
                  disabled={disablesDetailActions}
                >
                  <i className="bi bi-arrow-repeat" aria-hidden="true" />
                  再取得
                </button>
                <button
                  type="button"
                  className="console-secondary console-icon-button"
                  onClick={() => void saveOgpRecord()}
                  disabled={disablesDetailActions}
                >
                  <i className="bi bi-check2-circle" aria-hidden="true" />
                  保存
                </button>
                <button
                  type="button"
                  className="console-secondary console-icon-button is-danger"
                  onClick={() => void deleteOgpRecord()}
                  disabled={disablesDetailActions}
                >
                  <i className="bi bi-trash3" aria-hidden="true" />
                  削除
                </button>
              </div>
            </div>
          </section>
        )}
      </section>
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded">{content}</div>
  }

  return <div className="console-dashboard">{content}</div>
}
