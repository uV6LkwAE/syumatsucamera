import { useEffect, useState } from 'react'
import { ApiError, apiRequest } from '../../api/client'
import CmsTabGuide from '../../components/CmsTabGuide'
import ConsoleDropdown, { ConsoleDropdownOption } from '../../components/ConsoleDropdown'

const CONTACT_LIMIT_OPTIONS: Array<ConsoleDropdownOption<number>> = [
  { value: 20, label: '20件' },
  { value: 50, label: '50件' },
  { value: 100, label: '100件' },
]

type ContactSubjectType = 'review' | 'blog'

type ContactItem = {
  id: string
  subject_type: ContactSubjectType
  company_name: string
  person_name: string
  email: string
  body: string
  created_at: string
}

type ContactsListResponse = {
  items: ContactItem[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
  }
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.code}: ${error.detail}`
  }
  return '通信中に予期しないエラーが発生しました。'
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('ja-JP')
}

function toSubjectLabel(value: ContactSubjectType): string {
  if (value === 'review') {
    return 'レビュー'
  }
  return 'ブログ'
}

type ContactsPageProps = {
  embedded?: boolean
}

export default function ContactsPage({ embedded = false }: ContactsPageProps) {
  const [page, setPage] = useState<number>(1)
  const [limit, setLimit] = useState<number>(20)
  const [contacts, setContacts] = useState<ContactItem[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [totalPages, setTotalPages] = useState<number>(0)
  const [loadingCms, setLoadingCms] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string>('')

  async function fetchCmsContacts(): Promise<void> {
    setLoadingCms(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<ContactsListResponse>(
        `/cms/contacts?page=${page}&limit=${limit}`,
      )
      setContacts(payload.items)
      setTotalCount(payload.pagination.total_count)
      setTotalPages(payload.pagination.total_pages)
    } catch (error) {
      setErrorMessage(toMessage(error))
    } finally {
      setLoadingCms(false)
    }
  }

  useEffect(() => {
    void fetchCmsContacts()
  }, [page, limit])

  const content = (
    <>
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}
      <CmsTabGuide
        title="問い合わせの確認"
        helpLines={[
          '新しい問い合わせから順に一覧で確認できます。',
          '表示件数を切り替えながら必要な内容を追えます。',
          '本文は改行を保ったまま一覧内で確認できます。',
        ]}
      />
      <div className="console-card">
        <div className="console-card-header">
          <h2>問い合わせ一覧</h2>
          <p>受信した問い合わせを時系列で確認します。</p>
        </div>
        <div className="console-actions console-actions-spread d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center gap-3">
          <div className="console-actions d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
            <div className="console-inline-label d-inline-flex align-items-center gap-2">
              表示件数
              <ConsoleDropdown
                value={limit}
                options={CONTACT_LIMIT_OPTIONS}
                fullWidth={false}
                onChange={(nextValue) => {
                  setPage(1)
                  setLimit(nextValue)
                }}
              />
            </div>
            <div className="console-static-value">
              合計: {totalCount}件 / {page}ページ目（全{totalPages}ページ）
            </div>
          </div>
          <div className="console-actions d-flex flex-wrap justify-content-start justify-content-lg-end">
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={loadingCms || page <= 1}
            >
              <i className="bi bi-chevron-left" aria-hidden="true" />
              前へ
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => setPage((prev) => (prev < totalPages ? prev + 1 : prev))}
              disabled={loadingCms || page >= totalPages}
            >
              次へ
              <i className="bi bi-chevron-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="console-secondary console-icon-button"
              onClick={() => void fetchCmsContacts()}
              disabled={loadingCms}
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
                <th>受信日時</th>
                <th>種別</th>
                <th>氏名</th>
                <th>メールアドレス</th>
                <th>会社名</th>
                <th>本文</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.created_at)}</td>
                  <td>
                    <span className="contacts-type-badge">
                      {toSubjectLabel(item.subject_type)}
                    </span>
                  </td>
                  <td>{item.person_name}</td>
                  <td>{item.email}</td>
                  <td>{item.company_name || '-'}</td>
                  <td className="contacts-body-cell">{item.body}</td>
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
      {content}
    </div>
  )
}
