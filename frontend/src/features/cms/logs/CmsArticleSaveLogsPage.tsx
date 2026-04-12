import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import ApiErrorPopup from '../../../components/ApiErrorPopup'
import CmsTabGuide from '../../../components/CmsTabGuide'
import ConsoleNotice from '../../../components/ConsoleNotice'
import { formatCmsDate } from '../helpers'
import type {
  CmsArticleDetail,
  CmsArticleListResponse,
  CmsArticleSummary,
  CmsImageJobStatus,
  CmsSaveLogItem,
  CmsSaveLogListResponse,
} from '../types'

type CmsArticleSaveLogsPageProps = {
  embedded?: boolean
}

type SaveLogSessionGroup = {
  lockToken: string
  startedAt: string
  endedAt: string
  items: CmsSaveLogItem[]
}

const ARTICLE_PICKER_PAGE_SIZE = 10
const MAX_LOG_ITEMS = 100

function toImageJobStatusLabel(status: CmsImageJobStatus): string {
  if (status === 'pending') {
    return '未処理'
  }
  if (status === 'processing') {
    return '処理中'
  }
  if (status === 'completed') {
    return '完了'
  }
  return '失敗'
}

function toSaveLogStatusLabel(status: CmsSaveLogItem['status']): string {
  if (status === 'started') {
    return '開始'
  }
  if (status === 'completed') {
    return '完了'
  }
  return '失敗'
}

function toSaveLogStatusIcon(status: CmsSaveLogItem['status']): string {
  if (status === 'started') {
    return 'bi-play-circle'
  }
  if (status === 'completed') {
    return 'bi-check-circle'
  }
  return 'bi-exclamation-triangle'
}

function buildSaveLogSessionGroups(saveLogs: CmsSaveLogItem[]): SaveLogSessionGroup[] {
  const groupsByLockToken = new Map<string, SaveLogSessionGroup>()

  for (const saveLog of saveLogs) {
    const currentGroup = groupsByLockToken.get(saveLog.lock_token)
    if (currentGroup === undefined) {
      groupsByLockToken.set(saveLog.lock_token, {
        lockToken: saveLog.lock_token,
        startedAt: saveLog.occurred_at,
        endedAt: saveLog.occurred_at,
        items: [saveLog],
      })
      continue
    }

    currentGroup.items.push(saveLog)
    if (new Date(saveLog.occurred_at).getTime() < new Date(currentGroup.startedAt).getTime()) {
      currentGroup.startedAt = saveLog.occurred_at
    }
    if (new Date(saveLog.occurred_at).getTime() > new Date(currentGroup.endedAt).getTime()) {
      currentGroup.endedAt = saveLog.occurred_at
    }
  }

  return Array.from(groupsByLockToken.values()).sort(
    (left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime(),
  )
}

export default function CmsArticleSaveLogsPage({
  embedded = false,
}: CmsArticleSaveLogsPageProps) {
  const navigate = useNavigate()
  const { articleId = '' } = useParams<{ articleId?: string }>()
  const normalizedArticleId = articleId.trim()
  const showsArticleList = normalizedArticleId === ''

  const [articles, setArticles] = useState<CmsArticleSummary[]>([])
  const [articleQuery, setArticleQuery] = useState('')
  const [draftArticleQuery, setDraftArticleQuery] = useState('')
  const [articlePage, setArticlePage] = useState(1)
  const [articleTotalPages, setArticleTotalPages] = useState(1)
  const [articleTotalCount, setArticleTotalCount] = useState(0)
  const [selectedArticleTitle, setSelectedArticleTitle] = useState('')
  const [selectedArticlePath, setSelectedArticlePath] = useState('')
  const [saveLogs, setSaveLogs] = useState<CmsSaveLogItem[]>([])
  const [expandedLockTokens, setExpandedLockTokens] = useState<Record<string, boolean>>({})
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<unknown>('')

  const saveLogGroups = useMemo(() => buildSaveLogSessionGroups(saveLogs), [saveLogs])

  async function fetchArticles(): Promise<void> {
    setLoadingArticles(true)
    setErrorMessage('')

    try {
      const searchParams = new URLSearchParams({
        page: String(articlePage),
        limit: String(ARTICLE_PICKER_PAGE_SIZE),
        ordering: 'newest',
      })
      const normalizedQuery = articleQuery.trim()
      if (normalizedQuery !== '') {
        searchParams.set('title', normalizedQuery)
      }

      const payload = await apiRequest<CmsArticleListResponse>(
        `/cms/articles?${searchParams.toString()}`,
      )
      setArticles(payload.items)
      setArticleTotalPages(Math.max(payload.pagination.total_pages, 1))
      setArticleTotalCount(payload.pagination.total_count)
      setMessage(payload.items.length === 0 ? '対象記事がありません。' : '')
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setLoadingArticles(false)
    }
  }

  async function fetchSaveLogsByArticle(currentArticleId: string): Promise<void> {
    if (currentArticleId.trim() === '') {
      setSelectedArticleTitle('')
      setSelectedArticlePath('')
      setSaveLogs([])
      setExpandedLockTokens({})
      return
    }

    setLoadingLogs(true)
    setErrorMessage('')

    const searchParams = new URLSearchParams({
      page: '1',
      limit: String(MAX_LOG_ITEMS),
      article_id: currentArticleId,
    })

    try {
      const [articleDetail, logPayload] = await Promise.all([
        apiRequest<CmsArticleDetail>(`/cms/articles/${currentArticleId}`),
        apiRequest<CmsSaveLogListResponse>(
          `/cms/article-save-logs?${searchParams.toString()}`,
        ),
      ])
      const nextGroups = buildSaveLogSessionGroups(logPayload.items)
      setSelectedArticleTitle(articleDetail.title)
      setSelectedArticlePath(articleDetail.path)
      setSaveLogs(logPayload.items)
      setExpandedLockTokens((prev) => {
        const nextExpanded: Record<string, boolean> = {}
        for (const [index, group] of nextGroups.entries()) {
          nextExpanded[group.lockToken] = prev[group.lockToken] ?? index === 0
        }
        return nextExpanded
      })
      setMessage(nextGroups.length === 0 ? 'この記事にはまだ保存ログがありません。' : '')
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setLoadingLogs(false)
    }
  }

  useEffect(() => {
    if (!showsArticleList) {
      return
    }
    void fetchArticles()
  }, [articlePage, articleQuery, showsArticleList])

  useEffect(() => {
    if (showsArticleList) {
      setSelectedArticleTitle('')
      setSelectedArticlePath('')
      setSaveLogs([])
      setExpandedLockTokens({})
      return
    }
    void fetchSaveLogsByArticle(normalizedArticleId)
  }, [normalizedArticleId, showsArticleList])

  function renderArticleListView() {
    return (
      <>
        <CmsTabGuide
          title="保存ログの記事選択"
          helpLines={[
            '保存ログを確認したい記事を選択してください。',
            '記事数が多い場合はタイトル検索で対象を絞り込めます。',
          ]}
        />

        <section className="cms-save-log-page-shell">
          <div className="cms-save-log-page-toolbar row g-3 align-items-end">
            <label
              htmlFor="cms-save-log-article-query"
              className="console-label col-12 col-lg-8"
            >
              対象記事を検索
              <input
                id="cms-save-log-article-query"
                name="article_query"
                type="search"
                className="console-input form-control"
                value={draftArticleQuery}
                onChange={(event) => setDraftArticleQuery(event.target.value)}
                placeholder="タイトルで部分一致検索"
                autoComplete="off"
              />
            </label>

            <div className="col-12 col-lg-4 d-flex flex-wrap justify-content-start justify-content-lg-end gap-2">
              <button
                type="button"
                className="console-primary console-icon-button"
                onClick={() => {
                  setArticlePage(1)
                  setArticleQuery(draftArticleQuery.trim())
                }}
                disabled={loadingArticles}
              >
                <i className="bi bi-search" aria-hidden="true" />
                検索
              </button>
              <button
                type="button"
                className="console-secondary console-icon-button"
                onClick={() => {
                  void fetchArticles()
                }}
                disabled={loadingArticles}
              >
                <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                更新
              </button>
            </div>
          </div>

          <div className="cms-save-log-page-article-picker">
            <div className="cms-save-log-page-article-picker-head">
              <div className="cms-save-log-page-article-title">
                <span>記事一覧</span>
                <strong>対象記事を選択してください。</strong>
              </div>
              <p className="cms-save-log-page-article-count">
                合計 {articleTotalCount}件 / {articlePage}ページ目 / 全
                {articleTotalPages}ページ
              </p>
            </div>

            {articles.length === 0 ? (
              <div className="cms-article-empty-state cms-save-log-page-empty">
                <strong>表示できる記事がありません。</strong>
                <span>タイトル条件を変えて再検索してください。</span>
              </div>
            ) : (
              <div className="cms-save-log-article-list">
                {articles.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className="cms-save-log-article-item"
                    onClick={() => navigate(`/cms/console/logs/${article.id}`)}
                  >
                    <div className="cms-save-log-article-item-copy">
                      <strong>{article.title}</strong>
                      <span>{article.path}</span>
                    </div>
                    <span className={`cms-job-badge is-${article.image_job_status}`}>
                      {toImageJobStatusLabel(article.image_job_status)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="cms-save-log-page-pager">
              <button
                type="button"
                className="console-secondary console-icon-button"
                onClick={() => setArticlePage((prev) => Math.max(prev - 1, 1))}
                disabled={loadingArticles || articlePage <= 1}
              >
                <i className="bi bi-chevron-left" aria-hidden="true" />
                前へ
              </button>
              <button
                type="button"
                className="console-secondary console-icon-button"
                onClick={() =>
                  setArticlePage((prev) => Math.min(prev + 1, articleTotalPages))
                }
                disabled={loadingArticles || articlePage >= articleTotalPages}
              >
                次へ
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      </>
    )
  }

  function renderLogSessionView() {
    return (
      <>
        <CmsTabGuide
          title="lock token ごとの保存ログ"
          helpLines={[
            '選択記事の保存後処理ログを lock token 単位で確認できます。',
            '各セッションを開くと、処理開始から終了までの詳細ログを確認できます。',
          ]}
        />

        <section className="cms-save-log-page-shell">
          <div className="cms-save-log-page-toolbar row g-3 align-items-center">
            <div className="col-12 col-lg-8">
              <div className="cms-save-log-page-article-title">
                <span>選択中の記事</span>
                <strong>{selectedArticleTitle.trim() || '-'}</strong>
                {selectedArticlePath.trim() !== '' && <em>{selectedArticlePath}</em>}
              </div>
            </div>
            <div className="col-12 col-lg-4 d-flex flex-wrap justify-content-start justify-content-lg-end gap-2">
              <button
                type="button"
                className="console-secondary console-icon-button"
                onClick={() => navigate('/cms/console/logs')}
              >
                <i className="bi bi-chevron-left" aria-hidden="true" />
                記事選択へ戻る
              </button>
              <button
                type="button"
                className="console-secondary console-icon-button"
                onClick={() => {
                  void fetchSaveLogsByArticle(normalizedArticleId)
                }}
                disabled={loadingLogs}
              >
                <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                更新
              </button>
            </div>
          </div>

          {saveLogGroups.length === 0 ? (
            <div className="cms-article-empty-state cms-save-log-page-empty">
              <strong>表示できる保存ログはありません。</strong>
              <span>記事保存後にここへ lock token 単位のログが表示されます。</span>
            </div>
          ) : (
            <div className="cms-save-log-session-list">
              {saveLogGroups.map((group) => {
                const expanded = expandedLockTokens[group.lockToken] ?? false

                return (
                  <article key={group.lockToken} className="cms-save-log-session-card">
                    <button
                      type="button"
                      className="cms-save-log-session-head"
                      onClick={() =>
                        setExpandedLockTokens((prev) => ({
                          ...prev,
                          [group.lockToken]: !(prev[group.lockToken] ?? false),
                        }))
                      }
                      aria-expanded={expanded}
                    >
                      <div className="cms-save-log-session-summary">
                        <strong>{group.lockToken}</strong>
                        <span>
                          {formatCmsDate(group.startedAt)} - {formatCmsDate(group.endedAt)}
                        </span>
                      </div>
                      <span
                        className={`cms-save-log-session-toggle${
                          expanded ? ' is-expanded' : ''
                        }`}
                        aria-hidden="true"
                      >
                        <i className="bi bi-chevron-down" aria-hidden="true" />
                      </span>
                    </button>

                    <div
                      className={`console-expandable-region cms-save-log-session-region${
                        expanded ? ' is-expanded' : ''
                      }`}
                    >
                      <div className="console-expandable-region-inner">
                        <div className="cms-save-log-modal-list" aria-live="polite">
                          {group.items.map((saveLog) => (
                            <article
                              key={`${saveLog.occurred_at}-${saveLog.target ?? '-'}-${saveLog.status}`}
                              className={`cms-save-log-modal-item is-${saveLog.status}`}
                            >
                              <div className="cms-save-log-modal-item-icon">
                                <i
                                  className={`bi ${toSaveLogStatusIcon(saveLog.status)}`}
                                  aria-hidden="true"
                                />
                              </div>
                              <div className="cms-save-log-modal-item-body">
                                <div className="cms-save-log-modal-item-top">
                                  <strong>{toSaveLogStatusLabel(saveLog.status)}</strong>
                                  <time>{formatCmsDate(saveLog.occurred_at)}</time>
                                </div>
                                <div className="cms-save-log-modal-item-target">
                                  対象: {saveLog.target?.trim() || '-'}
                                </div>
                                {saveLog.message !== null && saveLog.message.trim() !== '' && (
                                  <p className="cms-save-log-modal-item-message">
                                    {saveLog.message}
                                  </p>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </>
    )
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      <ApiErrorPopup error={errorMessage} onClose={() => setErrorMessage('')} />
      {showsArticleList ? renderArticleListView() : renderLogSessionView()}
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded">{content}</div>
  }

  return <div className="console-dashboard">{content}</div>
}
