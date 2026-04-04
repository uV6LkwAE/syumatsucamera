import { FormEvent, useEffect, useState } from 'react'
import { ApiError, apiRequest } from '../../api/client'
import CmsTabGuide from '../../components/CmsTabGuide'
import ConsoleDropdown, { ConsoleDropdownOption } from '../../components/ConsoleDropdown'
import ConsoleNotice from '../../components/ConsoleNotice'

type UserRole = 'admin' | 'author'

type UsersUserSummary = {
  id: string
  email: string
  display_name: string | null
  icon: string | null
  header_image: string | null
  role: UserRole
  is_active: boolean
  last_login_at: string | null
}

type UsersUserListResponse = {
  items: UsersUserSummary[]
}

type UsersUserDetail = {
  id: string
  email: string
  display_name: string | null
  icon: string | null
  header_image: string | null
  profile: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

type UsersInviteResponse = {
  user_id: string
  email: string
  role: UserRole
  activate_path: string
}

type CreateForm = {
  email: string
  role: UserRole
}

type UpdateForm = {
  display_name: string
  profile: string
  role: UserRole
  is_active: boolean
  icon: string
  header_image: string
}

const USER_ROLE_OPTIONS: Array<ConsoleDropdownOption<UserRole>> = [
  { value: 'author', label: '執筆者' },
  { value: 'admin', label: '管理者' },
]

function formatDate(value: string | null): string {
  if (value === null || value === '') {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('ja-JP')
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.code}: ${error.detail}`
  }
  return '通信中に予期しないエラーが発生しました。'
}

type UsersPageProps = {
  embedded?: boolean
}

export default function UsersPage({ embedded = false }: UsersPageProps) {
  const [limit, setLimit] = useState<number>(20)
  const [users, setUsers] = useState<UsersUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<UsersUserDetail | null>(null)
  const [inviteResult, setInviteResult] = useState<UsersInviteResponse | null>(null)

  const [createForm, setCreateForm] = useState<CreateForm>({
    email: '',
    role: 'author',
  })
  const [updateForm, setUpdateForm] = useState<UpdateForm>({
    display_name: '',
    profile: '',
    role: 'author',
    is_active: false,
    icon: '',
    header_image: '',
  })

  const [updateIconFile, setUpdateIconFile] = useState<File | null>(null)
  const [updateHeaderFile, setUpdateHeaderFile] = useState<File | null>(null)

  const [loadingUsers, setLoadingUsers] = useState<boolean>(false)
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false)
  const [submittingCreate, setSubmittingCreate] = useState<boolean>(false)
  const [submittingUpdate, setSubmittingUpdate] = useState<boolean>(false)

  const [message, setMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  async function fetchUsersList(): Promise<void> {
    setLoadingUsers(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<UsersUserListResponse>(`/users?limit=${limit}`)
      setUsers(payload.items)
    } catch (error) {
      setErrorMessage(toMessage(error))
    } finally {
      setLoadingUsers(false)
    }
  }

  async function fetchUserDetail(userId: string): Promise<void> {
    setLoadingDetail(true)
    setInviteResult(null)
    setErrorMessage('')
    try {
      const payload = await apiRequest<UsersUserDetail>(`/users/${userId}`)
      setSelectedUser(payload)
      setUpdateForm({
        display_name: payload.display_name ?? '',
        profile: payload.profile ?? '',
        role: payload.role,
        is_active: payload.is_active,
        icon: payload.icon ?? '',
        header_image: payload.header_image ?? '',
      })
      setUpdateIconFile(null)
      setUpdateHeaderFile(null)
    } catch (error) {
      setSelectedUser(null)
      setErrorMessage(toMessage(error))
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    void fetchUsersList()
  }, [])

  async function onSubmitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmittingCreate(true)
    setMessage('')
    setErrorMessage('')
    try {
      await apiRequest<UsersUserDetail>('/users', {
        method: 'POST',
        body: {
          email: createForm.email,
          role: createForm.role,
        },
      })
      setCreateForm({ email: '', role: 'author' })
      setMessage('仮登録ユーザーを作成しました。')
      await fetchUsersList()
    } catch (error) {
      setErrorMessage(toMessage(error))
    } finally {
      setSubmittingCreate(false)
    }
  }

  async function onSubmitUpdate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (selectedUser === null) {
      setErrorMessage('更新対象ユーザーを先に選択してください。')
      return
    }
    setSubmittingUpdate(true)
    setMessage('')
    setErrorMessage('')
    try {
      if (updateIconFile !== null || updateHeaderFile !== null) {
        const formData = new FormData()
        formData.append('display_name', updateForm.display_name)
        formData.append('profile', updateForm.profile)
        formData.append('role', updateForm.role)
        formData.append('is_active', String(updateForm.is_active))
        if (updateIconFile !== null) {
          formData.append('icon_file', updateIconFile)
        }
        if (updateHeaderFile !== null) {
          formData.append('header_image_file', updateHeaderFile)
        }
        const updated = await apiRequest<UsersUserDetail>(`/users/${selectedUser.id}`, {
          method: 'PATCH',
          body: formData,
        })
        setSelectedUser(updated)
      } else {
        const updated = await apiRequest<UsersUserDetail>(`/users/${selectedUser.id}`, {
          method: 'PATCH',
          body: {
            display_name: updateForm.display_name,
            profile: updateForm.profile,
            role: updateForm.role,
            is_active: updateForm.is_active,
            icon: updateForm.icon === '' ? null : updateForm.icon,
            header_image:
              updateForm.header_image === '' ? null : updateForm.header_image,
          },
        })
        setSelectedUser(updated)
      }
      setMessage('ユーザーを更新しました。')
      setUpdateIconFile(null)
      setUpdateHeaderFile(null)
      await fetchUsersList()
    } catch (error) {
      setErrorMessage(toMessage(error))
    } finally {
      setSubmittingUpdate(false)
    }
  }

  async function issueInvite(userId: string): Promise<void> {
    setInviteResult(null)
    setMessage('')
    setErrorMessage('')
    try {
      const payload = await apiRequest<UsersInviteResponse>(`/users/${userId}/invite`, {
        method: 'POST',
      })
      setInviteResult(payload)
      setMessage('招待URLを発行しました。')
    } catch (error) {
      setErrorMessage(toMessage(error))
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}
      <CmsTabGuide
        title="ユーザーの作成と更新"
        helpLines={[
          '仮登録ユーザーを作成して招待URLを発行できます。',
          '一覧から対象ユーザーを選ぶと詳細を更新できます。',
          '権限や有効状態の変更もこのタブで行います。',
        ]}
      />

      <div className="console-card">
        <div className="console-card-header">
          <h2>仮登録ユーザー作成</h2>
          <p>招待対象ユーザーのメールアドレスと権限を登録します。</p>
        </div>
        <form className="console-form-grid row g-3" onSubmit={(event) => void onSubmitCreate(event)}>
          <label className="console-label col-12 col-md-8">
            メールアドレス
            <input
              className="console-input form-control"
              type="email"
              required
              value={createForm.email}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </label>
          <label className="console-label col-12 col-md-4">
            権限
            <ConsoleDropdown
              value={createForm.role}
              options={USER_ROLE_OPTIONS}
              onChange={(nextValue) =>
                setCreateForm((prev) => ({ ...prev, role: nextValue }))
              }
            />
          </label>
          <div className="console-actions col-12 d-flex">
            <button type="submit" className="console-primary" disabled={submittingCreate}>
              {submittingCreate ? '作成中...' : '仮登録ユーザーを作成'}
            </button>
          </div>
        </form>
      </div>

      <div className="console-card">
        <div className="console-card-header">
          <h2>ユーザー一覧</h2>
          <p>登録済みユーザーの状態を確認し、詳細画面へ遷移します。</p>
        </div>
        <div className="console-actions console-actions-spread d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center gap-3">
          <div className="console-actions d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
            <label className="console-inline-label d-inline-flex align-items-center gap-2">
              表示件数
              <input
                className="console-input form-control"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
              />
            </label>
            <div className="console-static-value">件数: {users.length}</div>
          </div>
          <button
            type="button"
            className="console-secondary console-icon-button"
            onClick={() => void fetchUsersList()}
            disabled={loadingUsers}
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
            再読み込み
          </button>
        </div>
        <div className="table-responsive console-table-scroll">
          <table className="table table-hover align-middle mb-0 console-table-basic">
            <thead>
              <tr>
                <th>メールアドレス</th>
                <th>表示名</th>
                <th>権限</th>
                <th>有効状態</th>
                <th>最終ログイン</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.display_name ?? '-'}</td>
                  <td>{item.role === 'admin' ? '管理者' : '執筆者'}</td>
                  <td>{item.is_active ? '有効' : '無効'}</td>
                  <td>{formatDate(item.last_login_at)}</td>
                  <td className="console-actions-inline">
                    <button
                      type="button"
                      className="console-secondary"
                      onClick={() => void fetchUserDetail(item.id)}
                    >
                      詳細
                    </button>
                    <button
                      type="button"
                      className="console-secondary"
                      onClick={() => void issueInvite(item.id)}
                    >
                      招待URL発行
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser !== null && (
        <div className="console-card">
          <div className="console-card-header">
            <div>
              <h2>ユーザー詳細/更新</h2>
              <p>プロフィール情報と権限を更新します。</p>
            </div>
          </div>
          <div className="console-static-value">
            id: {selectedUser.id}
            <br />
            メールアドレス: {selectedUser.email}
            <br />
            作成日時: {formatDate(selectedUser.created_at)}
            <br />
            更新日時: {formatDate(selectedUser.updated_at)}
          </div>
          <form className="console-form-grid row g-3" onSubmit={(event) => void onSubmitUpdate(event)}>
            <label className="console-label col-12 col-md-6">
              表示名
              <input
                className="console-input form-control"
                required
                value={updateForm.display_name}
                onChange={(event) =>
                  setUpdateForm((prev) => ({ ...prev, display_name: event.target.value }))
                }
              />
            </label>
            <label className="console-label col-12">
              自己紹介
              <textarea
                className="console-textarea form-control"
                required
                value={updateForm.profile}
                onChange={(event) =>
                  setUpdateForm((prev) => ({ ...prev, profile: event.target.value }))
                }
              />
            </label>
            <label className="console-label col-12 col-md-6">
              権限
              <ConsoleDropdown
                value={updateForm.role}
                options={USER_ROLE_OPTIONS}
                onChange={(nextValue) =>
                  setUpdateForm((prev) => ({ ...prev, role: nextValue }))
                }
              />
            </label>
            <label className="console-inline-label col-12 d-inline-flex align-items-center gap-2">
              ユーザーを有効化
              <input
                type="checkbox"
                checked={updateForm.is_active}
                onChange={(event) =>
                  setUpdateForm((prev) => ({ ...prev, is_active: event.target.checked }))
                }
              />
            </label>
            <label className="console-label col-12 col-md-6">
              アイコン画像URL（任意）
              <input
                className="console-input form-control"
                value={updateForm.icon}
                onChange={(event) =>
                  setUpdateForm((prev) => ({ ...prev, icon: event.target.value }))
                }
              />
            </label>
            <label className="console-label col-12 col-md-6">
              ヘッダー画像URL（任意）
              <input
                className="console-input form-control"
                value={updateForm.header_image}
                onChange={(event) =>
                  setUpdateForm((prev) => ({ ...prev, header_image: event.target.value }))
                }
              />
            </label>
            <label className="console-label col-12 col-md-6">
              アイコン画像アップロード（任意）
              <input
                className="console-input form-control"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setUpdateIconFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="console-label col-12 col-md-6">
              ヘッダー画像アップロード（任意）
              <input
                className="console-input form-control"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setUpdateHeaderFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="console-actions col-12 d-flex">
              <button type="submit" className="console-primary" disabled={submittingUpdate}>
                {submittingUpdate ? '更新中...' : 'ユーザー更新'}
              </button>
            </div>
          </form>

          {inviteResult !== null && (
            <div className="console-static-value">
              招待URL: {inviteResult.activate_path}
            </div>
          )}
        </div>
      )}
      <div className="console-card">
        <div className="console-card-header">
          <h2>本登録フロー</h2>
          <p>本登録は、招待URLにアクセスしたユーザー本人が実行します。</p>
        </div>
        <div className="console-static-value">
          管理者は仮登録と招待URL発行のみ行います。<br />
          本登録入力（表示名・プロフィール等）は
          <code> /api/users/activate/{'{user_id}'}</code>
          で本人が完了します。
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
