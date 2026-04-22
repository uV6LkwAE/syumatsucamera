import { FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/apiError'
import { apiRequest } from '../../api/client'
import ApiErrorPopup from '../../components/ApiErrorPopup'
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
  x_url: string | null
  instagram_url: string | null
  website_url: string | null
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
  x_url: string | null
  instagram_url: string | null
  website_url: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

type CreateForm = {
  email: string
  role: UserRole
}

type UpdateForm = {
  email: string
  display_name: string
  profile: string
  x_url: string
  instagram_url: string
  website_url: string
  role: UserRole
  is_active: boolean
  icon: string
  header_image: string
}

const USER_ROLE_OPTIONS: Array<ConsoleDropdownOption<UserRole>> = [
  { value: 'author', label: '執筆者' },
  { value: 'admin', label: '管理者' },
]

const LIMIT_OPTIONS: Array<ConsoleDropdownOption<number>> = [
  { value: 20, label: '20件' },
  { value: 50, label: '50件' },
  { value: 100, label: '100件' },
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

function toUserRoleLabel(role: UserRole): string {
  return role === 'admin' ? '管理者' : '執筆者'
}

function buildActivationUrl(userId: string): string {
  return `${window.location.origin}/cms/users/activate/${userId}`
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const successful = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!successful) {
    throw new Error('クリップボードへのコピーに失敗しました。')
  }
}

type UsersPageProps = {
  embedded?: boolean
}

export default function UsersPage({ embedded = false }: UsersPageProps) {
  const [limit, setLimit] = useState<number>(20)
  const [users, setUsers] = useState<UsersUserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState<UsersUserDetail | null>(null)

  const [createForm, setCreateForm] = useState<CreateForm>({
    email: '',
    role: 'author',
  })
  const [updateForm, setUpdateForm] = useState<UpdateForm>({
    email: '',
    display_name: '',
    profile: '',
    x_url: '',
    instagram_url: '',
    website_url: '',
    role: 'author',
    is_active: false,
    icon: '',
    header_image: '',
  })

  const [updateIconFile, setUpdateIconFile] = useState<File | null>(null)
  const [updateHeaderFile, setUpdateHeaderFile] = useState<File | null>(null)
  const [updateIconPreviewUrl, setUpdateIconPreviewUrl] = useState<string | null>(null)
  const [updateHeaderPreviewUrl, setUpdateHeaderPreviewUrl] = useState<string | null>(null)

  const updateIconInputRef = useRef<HTMLInputElement | null>(null)
  const updateHeaderInputRef = useRef<HTMLInputElement | null>(null)

  const [loadingUsers, setLoadingUsers] = useState<boolean>(false)
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false)
  const [submittingCreate, setSubmittingCreate] = useState<boolean>(false)
  const [submittingUpdate, setSubmittingUpdate] = useState<boolean>(false)

  const [message, setMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<unknown>('')

  useEffect(() => {
    if (updateIconFile === null) {
      setUpdateIconPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(updateIconFile)
    setUpdateIconPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [updateIconFile])

  useEffect(() => {
    if (updateHeaderFile === null) {
      setUpdateHeaderPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(updateHeaderFile)
    setUpdateHeaderPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [updateHeaderFile])

  async function fetchUsersList(): Promise<void> {
    setLoadingUsers(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<UsersUserListResponse>(`/users/?limit=${limit}`)
      setUsers(payload.items)
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setLoadingUsers(false)
    }
  }

  async function fetchUserDetail(userId: string): Promise<void> {
    setLoadingDetail(true)
    setErrorMessage('')
    try {
      const payload = await apiRequest<UsersUserDetail>(`/users/${userId}`)
      setSelectedUser(payload)
      setUpdateForm({
        email: payload.email,
        display_name: payload.display_name ?? '',
        profile: payload.profile ?? '',
        x_url: payload.x_url ?? '',
        instagram_url: payload.instagram_url ?? '',
        website_url: payload.website_url ?? '',
        role: payload.role,
        is_active: payload.is_active,
        icon: payload.icon ?? '',
        header_image: payload.header_image ?? '',
      })
      setUpdateIconFile(null)
      setUpdateHeaderFile(null)
    } catch (error) {
      setSelectedUser(null)
      setErrorMessage(error)
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    void fetchUsersList()
  }, [limit])

  async function onSubmitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmittingCreate(true)
    setMessage('')
    setErrorMessage('')
    try {
      await apiRequest<UsersUserDetail>('/users/', {
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
      setErrorMessage(error)
    } finally {
      setSubmittingCreate(false)
    }
  }

  async function saveSelectedUser(): Promise<void> {
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
        formData.append('email', updateForm.email)
        formData.append('display_name', updateForm.display_name)
        formData.append('profile', updateForm.profile)
        formData.append('x_url', updateForm.x_url.trim())
        formData.append('instagram_url', updateForm.instagram_url.trim())
        formData.append('website_url', updateForm.website_url.trim())
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
            email: updateForm.email,
            display_name: updateForm.display_name,
            profile: updateForm.profile,
            x_url: updateForm.x_url.trim() === '' ? null : updateForm.x_url.trim(),
            instagram_url:
              updateForm.instagram_url.trim() === '' ? null : updateForm.instagram_url.trim(),
            website_url: updateForm.website_url.trim() === '' ? null : updateForm.website_url.trim(),
            role: updateForm.role,
            is_active: updateForm.is_active,
            icon: updateForm.icon === '' ? null : updateForm.icon,
            header_image:
              updateForm.header_image === '' ? null : updateForm.header_image,
          },
        })
        setSelectedUser(updated)
        setUpdateForm({
          email: updated.email,
          display_name: updated.display_name ?? '',
          profile: updated.profile ?? '',
          x_url: updated.x_url ?? '',
          instagram_url: updated.instagram_url ?? '',
          website_url: updated.website_url ?? '',
          role: updated.role,
          is_active: updated.is_active,
          icon: updated.icon ?? '',
          header_image: updated.header_image ?? '',
        })
      }
      setMessage('ユーザーを更新しました。')
      setUpdateIconFile(null)
      setUpdateHeaderFile(null)
      await fetchUsersList()
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setSubmittingUpdate(false)
    }
  }

  async function onSubmitUpdate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await saveSelectedUser()
  }

  async function copyActivationUrl(userId: string): Promise<void> {
    setMessage('')
    setErrorMessage('')
    try {
      const activationUrl = buildActivationUrl(userId)
      await copyTextToClipboard(activationUrl)
      setMessage('招待URLをコピーしました。')
    } catch (_error) {
      setErrorMessage('招待URLのコピーに失敗しました。')
    }
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      <ApiErrorPopup error={errorMessage} onClose={() => setErrorMessage('')} />
      <CmsTabGuide
        title="ユーザーの作成と更新"
        helpLines={[
          '仮登録ユーザーを作成し、一覧から招待URLをコピーできます。',
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
        <div className="cms-article-toolbar row g-3 align-items-center">
          <div className="cms-article-toolbar-meta col-12 col-lg d-flex flex-column flex-md-row align-items-start align-items-md-center gap-3">
            <p className="cms-article-toolbar-stat">合計 {users.length}件</p>
            <div className="console-inline-label cms-article-limit-field d-inline-flex align-items-center gap-2">
              <span>表示件数</span>
              <ConsoleDropdown
                value={limit}
                options={LIMIT_OPTIONS}
                fullWidth={false}
                onChange={(nextValue) => {
                  setLimit(nextValue)
                }}
              />
            </div>
          </div>
          <div className="cms-article-toolbar-actions col-12 col-lg-auto d-flex flex-wrap justify-content-start justify-content-lg-end gap-2">
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
                  <td>{toUserRoleLabel(item.role)}</td>
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
                      disabled={item.is_active}
                      onClick={() => void copyActivationUrl(item.id)}
                    >
                      招待URLをコピー
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser !== null && (
        <form className="console-card cms-profile-hero" onSubmit={(event) => void onSubmitUpdate(event)}>
          <div
            className={`cms-profile-banner cms-profile-banner-edit-view ${
              loadingDetail || submittingUpdate ? '' : 'is-editing'
            }`}
            style={
              updateHeaderPreviewUrl !== null
                ? { backgroundImage: `url(${updateHeaderPreviewUrl})` }
                : selectedUser.header_image !== null
                  ? { backgroundImage: `url(${selectedUser.header_image})` }
                  : undefined
            }
            onClick={() => {
              if (loadingDetail || submittingUpdate) {
                return
              }
              updateHeaderInputRef.current?.click()
            }}
            onKeyDown={(event) => {
              if (loadingDetail || submittingUpdate) {
                return
              }
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              updateHeaderInputRef.current?.click()
            }}
            role={loadingDetail || submittingUpdate ? undefined : 'button'}
            tabIndex={loadingDetail || submittingUpdate ? undefined : 0}
            aria-label={loadingDetail || submittingUpdate ? undefined : 'ヘッダー画像を選択'}
          >
            <button
              type="submit"
              className="cms-profile-edit-button cms-profile-banner-edit-button"
              onClick={(event) => {
                event.stopPropagation()
              }}
              disabled={submittingUpdate}
              aria-label="ユーザーを保存"
              title="保存"
            >
              <i className={`bi ${submittingUpdate ? 'bi-hourglass-split' : 'bi-check2-circle'}`} />
            </button>
            {!loadingDetail && !submittingUpdate && (
              <div className="cms-profile-banner-upload-badge" aria-hidden="true">
                <i className="bi bi-cloud-arrow-up" />
              </div>
            )}
          </div>
          <div className="cms-profile-body">
            <div
              className={`cms-profile-avatar-wrap ${loadingDetail || submittingUpdate ? '' : 'is-editing'}`}
              onClick={() => {
                if (loadingDetail || submittingUpdate) {
                  return
                }
                updateIconInputRef.current?.click()
              }}
              onKeyDown={(event) => {
                if (loadingDetail || submittingUpdate) {
                  return
                }
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return
                }
                event.preventDefault()
                updateIconInputRef.current?.click()
              }}
              role={loadingDetail || submittingUpdate ? undefined : 'button'}
              tabIndex={loadingDetail || submittingUpdate ? undefined : 0}
              aria-label={loadingDetail || submittingUpdate ? undefined : 'アイコン画像を選択'}
            >
              {updateIconPreviewUrl !== null ? (
                <img className="cms-profile-avatar" src={updateIconPreviewUrl} alt="icon preview" />
              ) : selectedUser.icon !== null ? (
                <img className="cms-profile-avatar" src={selectedUser.icon} alt="icon preview" />
              ) : (
                <div className="cms-profile-avatar cms-profile-avatar-empty" aria-hidden="true" />
              )}
              {!loadingDetail && !submittingUpdate && (
                <span className="cms-profile-avatar-upload-badge" aria-hidden="true">
                  <i className="bi bi-camera-fill" />
                </span>
              )}
            </div>

            <div className="cms-profile-meta">
              <div className="cms-profile-meta-top d-flex flex-column gap-2 align-items-start">
                <div className="cms-profile-edit-section">
                  <div className="cms-profile-field-head">
                    <label className="cms-profile-field-label" htmlFor="user-display-name">
                      表示名
                    </label>
                    <span className="cms-profile-field-counter">
                      {updateForm.display_name.length}/100
                    </span>
                  </div>
                  <input
                    type="text"
                    className="console-input form-control cms-profile-input"
                    id="user-display-name"
                    name="display_name"
                    aria-label="表示名"
                    value={updateForm.display_name}
                    maxLength={100}
                    onChange={(event) =>
                      setUpdateForm((prev) => ({
                        ...prev,
                        display_name: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="cms-profile-edit-section">
                <div className="cms-profile-field-head">
                  <label className="cms-profile-field-label" htmlFor="user-email">
                    メールアドレス
                  </label>
                  <span className="cms-profile-field-counter">
                    {updateForm.email.length}/255
                  </span>
                </div>
                <input
                  type="email"
                  className="console-input form-control cms-profile-input"
                  id="user-email"
                  name="email"
                  aria-label="メールアドレス"
                  value={updateForm.email}
                  maxLength={255}
                  required
                  onChange={(event) =>
                    setUpdateForm((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="cms-profile-edit-section">
                <div className="cms-profile-field-head">
                  <label className="cms-profile-field-label" htmlFor="user-bio">
                    自己紹介
                  </label>
                  <span className="cms-profile-field-counter">
                    {updateForm.profile.length}/300
                  </span>
                </div>
                <textarea
                  className="console-textarea form-control cms-profile-textarea"
                  id="user-bio"
                  name="profile"
                  aria-label="自己紹介"
                  value={updateForm.profile}
                  maxLength={300}
                  rows={10}
                  onChange={(event) =>
                    setUpdateForm((prev) => ({
                      ...prev,
                      profile: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="cms-profile-social-editor">
                <div className="cms-profile-meta-editor-title-wrap">
                  <h2 className="cms-profile-meta-editor-title">リンク</h2>
                  <span className="cms-profile-meta-editor-caption">
                    プロフィールに紐づけるURLを入力します。
                  </span>
                </div>
                <div className="cms-profile-social-grid row g-3">
                  <label className="console-label col-12 col-lg-4">
                    <span className="cms-profile-field-head">
                      <span className="cms-profile-field-label">X URL</span>
                      <span className="cms-profile-field-counter">{updateForm.x_url.length}/500</span>
                    </span>
                    <input
                      className="console-input form-control cms-profile-input cms-profile-url-input"
                      type="url"
                      value={updateForm.x_url}
                      maxLength={500}
                      placeholder="https://x.com/..."
                      onChange={(event) =>
                        setUpdateForm((prev) => ({
                          ...prev,
                          x_url: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="console-label col-12 col-lg-4">
                    <span className="cms-profile-field-head">
                      <span className="cms-profile-field-label">Instagram URL</span>
                      <span className="cms-profile-field-counter">
                        {updateForm.instagram_url.length}/500
                      </span>
                    </span>
                    <input
                      className="console-input form-control cms-profile-input cms-profile-url-input"
                      type="url"
                      value={updateForm.instagram_url}
                      maxLength={500}
                      placeholder="https://www.instagram.com/..."
                      onChange={(event) =>
                        setUpdateForm((prev) => ({
                          ...prev,
                          instagram_url: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="console-label col-12 col-lg-4">
                    <span className="cms-profile-field-head">
                      <span className="cms-profile-field-label">Webサイト URL</span>
                      <span className="cms-profile-field-counter">
                        {updateForm.website_url.length}/500
                      </span>
                    </span>
                    <input
                      className="console-input form-control cms-profile-input cms-profile-url-input"
                      type="url"
                      value={updateForm.website_url}
                      maxLength={500}
                      placeholder="https://example.com/"
                      onChange={(event) =>
                        setUpdateForm((prev) => ({
                          ...prev,
                          website_url: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="cms-profile-meta-editor">
                <div className="cms-profile-meta-editor-head d-flex flex-column flex-md-row align-items-start justify-content-between gap-2">
                  <div className="cms-profile-meta-editor-title-wrap d-flex flex-wrap align-items-baseline gap-2">
                    <h2 className="cms-profile-meta-editor-title">権限と状態</h2>
                    <span className="cms-profile-field-counter">ユーザー属性を更新します。</span>
                  </div>
                </div>
                <div className="cms-profile-social-grid row g-3">
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
                </div>
              </div>

              <input
                ref={updateIconInputRef}
                type="file"
                className="cms-profile-hidden-input"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setUpdateIconFile(event.target.files?.[0] ?? null)}
              />
              <input
                ref={updateHeaderInputRef}
                type="file"
                className="cms-profile-hidden-input"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setUpdateHeaderFile(event.target.files?.[0] ?? null)}
              />

              {(updateIconFile !== null || updateHeaderFile !== null) && (
                <div className="cms-profile-upload-files">
                  {updateIconFile !== null && <div>アイコン: {updateIconFile.name}</div>}
                  {updateHeaderFile !== null && <div>ヘッダー: {updateHeaderFile.name}</div>}
                </div>
              )}

            </div>
          </div>
        </form>
      )}
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
