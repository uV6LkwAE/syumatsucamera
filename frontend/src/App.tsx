import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router-dom'
import {
  ApiError,
  apiRequest,
  getApiLoadingSnapshot,
  subscribeApiLoading,
} from './api/client'
import ConsoleHeroCard from './components/ConsoleHeroCard'
import ConsoleNotice from './components/ConsoleNotice'
import ContactsPage from './features/contacts/ContactsPage'
import CmsArticleEditorPage from './features/cms/articles/CmsArticleEditorPage'
import CmsArticlesPage from './features/cms/articles/CmsArticlesPage'
import CmsCategoriesPage from './features/cms/categories/CmsCategoriesPage'
import UsersPage from './features/users/UsersPage'

function Home() {
  return (
    <main className="page">
      <h1>週末カメラ</h1>
      <p>
        ご覧いただきありがとうございます。
        <br />
        現在、週末カメラは新サイトへ移行作業中です。
        <br />
        ご不便をおかけしますが、再開まで今しばらくお待ちください。
        <br />
        再開は5月中を予定しています。
        <br />
        <br />
        お問い合わせは以下のメールアドレスより受け付けております。
        <br />
        <br />
        syumatsu.camera[*]gmail.com
        <br />
        <br />
        *を@に置き換えてください。
      </p>
    </main>
  )
}

type CmsNavItem = {
  to: string
  label: string
  icon: string
}

const CMS_NAV_ITEMS: CmsNavItem[] = [
  {
    to: '/cms/console/articles',
    label: '記事',
    icon: 'bi-file-earmark-text',
  },
  {
    to: '/cms/console/categories',
    label: 'カテゴリー',
    icon: 'bi-diagram-3',
  },
  {
    to: '/cms/console/contacts',
    label: '問い合わせ',
    icon: 'bi-envelope',
  },
  {
    to: '/cms/console/users',
    label: 'ユーザー',
    icon: 'bi-people',
  },
  {
    to: '/cms/console/ogp',
    label: 'OGP',
    icon: 'bi-link-45deg',
  },
  {
    to: '/cms/console/impressions',
    label: 'インプレッション',
    icon: 'bi-bar-chart-line',
  },
]

type CmsTabKey =
  | 'articles'
  | 'categories'
  | 'contacts'
  | 'users'
  | 'ogp'
  | 'impressions'

type CmsSessionUser = {
  id: string
  email: string
  display_name: string | null
  icon: string | null
  header_image: string | null
  profile: string | null
  meta: Record<string, string>
  meta_help_text?: string
  role: 'admin' | 'author'
  is_active: boolean
}

type CmsOutletContext = {
  sessionUser: CmsSessionUser | null
  setSessionUser: (user: CmsSessionUser | null) => void
}

type ProfileMetaItem = {
  id: string
  key: string
  value: string
}

type ProfileFormState = {
  display_name: string
  profile: string
  meta_items: ProfileMetaItem[]
}

type ProfileValidationResult = {
  valid: boolean
  message: string
  normalizedMeta: Record<string, string>
}

const PROFILE_META_MAX_ITEMS = 20
const PROFILE_META_KEY_MAX_LENGTH = 50
const PROFILE_META_VALUE_MAX_LENGTH = 300

function createProfileMetaItem(key = '', value = ''): ProfileMetaItem {
  const randomPart = Math.random().toString(16).slice(2)
  return {
    id: `meta-${Date.now()}-${randomPart}`,
    key,
    value,
  }
}

function toProfileMetaItems(meta: Record<string, string> | null | undefined): ProfileMetaItem[] {
  if (meta === null || meta === undefined) {
    return []
  }
  return Object.entries(meta).map(([key, value]) => createProfileMetaItem(key, value))
}

function normalizeProfileMeta(items: ProfileMetaItem[]): ProfileValidationResult {
  if (items.length > PROFILE_META_MAX_ITEMS) {
    return {
      valid: false,
      message: `追加プロフィール項目は最大${PROFILE_META_MAX_ITEMS}件です。`,
      normalizedMeta: {},
    }
  }

  const normalizedMeta: Record<string, string> = {}
  for (const item of items) {
    const key = item.key.trim()
    const value = item.value.trim()

    if (key === '' && value === '') {
      continue
    }
    if (key === '' || value === '') {
      return {
        valid: false,
        message: '追加プロフィール項目は「項目名」と「内容」をセットで入力してください。',
        normalizedMeta: {},
      }
    }
    if (key.length > PROFILE_META_KEY_MAX_LENGTH) {
      return {
        valid: false,
        message: `項目名は${PROFILE_META_KEY_MAX_LENGTH}文字以内で入力してください。`,
        normalizedMeta: {},
      }
    }
    if (value.length > PROFILE_META_VALUE_MAX_LENGTH) {
      return {
        valid: false,
        message: `内容は${PROFILE_META_VALUE_MAX_LENGTH}文字以内で入力してください。`,
        normalizedMeta: {},
      }
    }
    if (normalizedMeta[key] !== undefined) {
      return {
        valid: false,
        message: `追加プロフィール項目の「${key}」が重複しています。`,
        normalizedMeta: {},
      }
    }
    normalizedMeta[key] = value
  }

  return {
    valid: true,
    message: '',
    normalizedMeta,
  }
}

function validateProfileForm(
  form: ProfileFormState,
  options: {
    requireMediaFields: boolean
    existingIcon: string
    existingHeaderImage: string
    hasIconFile: boolean
    hasHeaderImageFile: boolean
  },
): ProfileValidationResult {
  const normalizedDisplayName = form.display_name.trim()
  if (normalizedDisplayName === '') {
    return {
      valid: false,
      message: '表示名は必須です。',
      normalizedMeta: {},
    }
  }
  if (normalizedDisplayName.length > 100) {
    return {
      valid: false,
      message: '表示名は100文字以内で入力してください。',
      normalizedMeta: {},
    }
  }

  const normalizedProfile = form.profile.trim()
  if (normalizedProfile === '') {
    return {
      valid: false,
      message: '自己紹介は必須です。',
      normalizedMeta: {},
    }
  }
  if (normalizedProfile.length > 300) {
    return {
      valid: false,
      message: '自己紹介は300文字以内で入力してください。',
      normalizedMeta: {},
    }
  }

  if (
    options.requireMediaFields
    && options.existingIcon.trim() === ''
    && !options.hasIconFile
  ) {
    return {
      valid: false,
      message: '有効ユーザーはアイコン画像の登録が必須です。',
      normalizedMeta: {},
    }
  }

  if (
    options.requireMediaFields
    && options.existingHeaderImage.trim() === ''
    && !options.hasHeaderImageFile
  ) {
    return {
      valid: false,
      message: '有効ユーザーはヘッダー画像の登録が必須です。',
      normalizedMeta: {},
    }
  }

  const metaValidation = normalizeProfileMeta(form.meta_items)
  if (!metaValidation.valid) {
    return metaValidation
  }

  return {
    valid: true,
    message: '',
    normalizedMeta: metaValidation.normalizedMeta,
  }
}

function toApiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.code}: ${error.detail}`
  }
  return '通信中に予期しないエラーが発生しました。'
}

function getCmsActiveTab(pathname: string): CmsTabKey {
  if (pathname.startsWith('/cms/console/articles')) {
    return 'articles'
  }
  if (pathname.startsWith('/cms/console/categories')) {
    return 'categories'
  }
  if (pathname.startsWith('/cms/console/contacts')) {
    return 'contacts'
  }
  if (pathname.startsWith('/cms/console/users')) {
    return 'users'
  }
  if (pathname.startsWith('/cms/console/ogp')) {
    return 'ogp'
  }
  if (pathname.startsWith('/cms/console/impressions')) {
    return 'impressions'
  }
  return 'articles'
}

function toCmsRoleLabel(role: CmsSessionUser['role'] | undefined): string {
  if (role === 'admin') {
    return '管理者'
  }
  if (role === 'author') {
    return '執筆者'
  }
  return '未認証'
}

function CmsConsoleLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionUser, setSessionUser] = useState<CmsSessionUser | null>(null)
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let active = true

    async function loadSessionMe(): Promise<void> {
      try {
        const payload = await apiRequest<CmsSessionUser>('/users/session/me')
        if (active) {
          setSessionUser(payload)
        }
      } catch {
        if (active) {
          setSessionUser(null)
        }
      }
    }

    void loadSessionMe()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden'
      return
    }
    document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const displayName = sessionUser?.display_name ?? ''
  const userLabel = displayName.trim() !== '' ? displayName : (sessionUser?.email ?? '未認証')
  const roleLabel = toCmsRoleLabel(sessionUser?.role)

  return (
    <>
      <header className="console-header">
        <div className="console-header-content">
          <button
            className="console-menu-button"
            type="button"
            aria-label="メニュー"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <i className="bi bi-list" aria-hidden="true" />
          </button>
          <Link className="console-header-booth" to="/cms/console">
            週末カメラ - 管理画面
          </Link>
          <div className="console-header-right">
            <div className="console-header-user-link console-header-user-trigger">
              <span className={`console-header-role-badge is-${sessionUser?.role ?? 'guest'}`}>
                {roleLabel}
              </span>
              <span className="console-header-user-name">{userLabel}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="console-shell">
        {menuOpen && (
          <>
            <div className="console-sidebar-backdrop" onClick={() => setMenuOpen(false)} />
            <aside className="console-sidebar">
              <div className="console-sidebar-header">
                <span>メニュー</span>
                <button
                  className="console-menu-button"
                  type="button"
                  aria-label="閉じる"
                  onClick={() => setMenuOpen(false)}
                >
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              </div>
              <nav className="console-sidebar-nav console-sidebar-cards">
                {CMS_NAV_ITEMS.map((item) => (
                  <Link
                    key={item.to}
                    className="console-tile console-sidebar-tile"
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                  >
                    <div className="console-tile-icon">
                      <i className={`bi ${item.icon}`} aria-hidden="true" />
                    </div>
                    <div className="console-tile-title">{item.label}</div>
                  </Link>
                ))}
              </nav>
            </aside>
          </>
        )}
        <main className="console-page">
          <Outlet context={{ sessionUser, setSessionUser }} />
        </main>
      </div>
      <footer className="console-fixed-footer">
        <div className="console-fixed-footer-inner">
          <span className="console-fixed-footer-title">週末カメラ CMS</span>
          <span className="console-fixed-footer-sep">|</span>
          <span className="console-fixed-footer-note">管理画面</span>
        </div>
      </footer>
    </>
  )
}

function CmsTabPlaceholder({
  title,
  summary,
  badge,
  icon,
}: {
  badge: string
  icon: string
  title: string
  summary: string
}) {
  return (
    <div className="cms-tab-embedded">
      <ConsoleHeroCard badge={badge} title={title} subtitle={summary} icon={icon} />
      <hr className="cms-console-divider" />
      <div className="console-placeholder">この機能は順次実装します。</div>
    </div>
  )
}

function CmsConsolePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { sessionUser, setSessionUser } = useOutletContext<CmsOutletContext>()
  const activeTab = getCmsActiveTab(location.pathname)
  const [profileEditMode, setProfileEditMode] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    display_name: '',
    profile: '',
    meta_items: [],
  })
  const [profileIconFile, setProfileIconFile] = useState<File | null>(null)
  const [profileHeaderImageFile, setProfileHeaderImageFile] = useState<File | null>(null)
  const [profileIconPreviewUrl, setProfileIconPreviewUrl] = useState<string | null>(null)
  const [profileHeaderPreviewUrl, setProfileHeaderPreviewUrl] = useState<string | null>(null)
  const profileIconInputRef = useRef<HTMLInputElement | null>(null)
  const profileHeaderInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setProfileForm({
      display_name: sessionUser?.display_name ?? '',
      profile: sessionUser?.profile ?? '',
      meta_items: toProfileMetaItems(sessionUser?.meta),
    })
    setProfileIconFile(null)
    setProfileHeaderImageFile(null)
    setProfileIconPreviewUrl(null)
    setProfileHeaderPreviewUrl(null)
    setProfileEditMode(false)
    setProfileMessage('')
    setProfileError('')
  }, [sessionUser?.id, sessionUser?.display_name, sessionUser?.profile, sessionUser?.meta])

  useEffect(() => {
    if (profileIconFile === null) {
      setProfileIconPreviewUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(profileIconFile)
    setProfileIconPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [profileIconFile])

  useEffect(() => {
    if (profileHeaderImageFile === null) {
      setProfileHeaderPreviewUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(profileHeaderImageFile)
    setProfileHeaderPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [profileHeaderImageFile])

  const displayName = sessionUser?.display_name?.trim() ?? ''
  const userLabel = displayName !== '' ? displayName : (sessionUser?.email ?? 'ユーザー')

  const canEditProfile = sessionUser !== null && sessionUser.role === 'admin'
  const profileValidation = validateProfileForm(profileForm, {
    requireMediaFields: sessionUser?.is_active ?? false,
    existingIcon: sessionUser?.icon ?? '',
    existingHeaderImage: sessionUser?.header_image ?? '',
    hasIconFile: profileIconFile !== null,
    hasHeaderImageFile: profileHeaderImageFile !== null,
  })
  const previewIcon = profileIconPreviewUrl ?? sessionUser?.icon ?? ''
  const previewHeaderImage = profileEditMode
    ? (profileHeaderPreviewUrl ?? sessionUser?.header_image ?? '')
    : (sessionUser?.header_image ?? '')
  const canPickProfileImages = canEditProfile && profileEditMode
  const profileMetaEntries = Object.entries(sessionUser?.meta ?? {})

  function addProfileMetaItem(): void {
    setProfileForm((prev) => {
      if (prev.meta_items.length >= PROFILE_META_MAX_ITEMS) {
        return prev
      }
      return {
        ...prev,
        meta_items: [...prev.meta_items, createProfileMetaItem()],
      }
    })
  }

  function updateProfileMetaItem(
    targetId: string,
    field: 'key' | 'value',
    nextValue: string,
  ): void {
    setProfileForm((prev) => ({
      ...prev,
      meta_items: prev.meta_items.map((item) =>
        item.id === targetId ? { ...item, [field]: nextValue } : item),
    }))
  }

  function removeProfileMetaItem(targetId: string): void {
    setProfileForm((prev) => ({
      ...prev,
      meta_items: prev.meta_items.filter((item) => item.id !== targetId),
    }))
  }

  async function saveProfile(): Promise<void> {
    if (!canEditProfile || sessionUser === null) {
      setProfileError('プロフィール編集は管理者のみ実行できます。')
      return
    }
    if (!profileValidation.valid) {
      setProfileError(profileValidation.message)
      return
    }

    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const formData = new FormData()
      formData.append('display_name', profileForm.display_name.trim())
      formData.append('profile', profileForm.profile.trim())
      formData.append('role', sessionUser.role)
      formData.append('is_active', String(sessionUser.is_active))
      if (profileIconFile !== null) {
        formData.append('icon_file', profileIconFile)
      }
      if (profileHeaderImageFile !== null) {
        formData.append('header_image_file', profileHeaderImageFile)
      }
      formData.append('meta', JSON.stringify(profileValidation.normalizedMeta))

      const payload = await apiRequest<CmsSessionUser>(`/users/${sessionUser.id}`, {
        method: 'PATCH',
        body: formData,
      })
      setProfileForm({
        display_name: payload.display_name ?? '',
        profile: payload.profile ?? '',
        meta_items: toProfileMetaItems(payload.meta),
      })
      setProfileIconFile(null)
      setProfileHeaderImageFile(null)
      setSessionUser(payload)
      setProfileEditMode(false)
      setProfileMessage('プロフィールを更新しました。')
    } catch (error) {
      setProfileError(toApiMessage(error))
    } finally {
      setProfileSaving(false)
    }
  }

  function renderTabContent() {
    if (activeTab === 'articles') {
      return <CmsArticlesPage embedded />
    }
    if (activeTab === 'categories') {
      return <CmsCategoriesPage embedded />
    }
    if (activeTab === 'contacts') {
      return <ContactsPage embedded />
    }
    if (activeTab === 'users') {
      return <UsersPage embedded />
    }
    if (activeTab === 'ogp') {
      return (
        <CmsTabPlaceholder
          badge="OGP"
          icon="bi-link-45deg"
          title="OGP"
          summary="公開前にリンクカードのキャッシュ状態をここで確認します。"
        />
      )
    }
    return (
      <CmsTabPlaceholder
        badge="分析"
        icon="bi-bar-chart-line"
        title="インプレッション"
        summary="公開後の流入傾向をこのタブで追えるようにします。"
      />
    )
  }

  return (
    <div className="console-dashboard cms-profile-page">
      <section className="cms-profile-card">
        <div
          className={`cms-profile-banner ${canPickProfileImages ? 'is-editing' : ''}`}
          style={
            previewHeaderImage !== ''
              ? { backgroundImage: `url(${previewHeaderImage})` }
              : undefined
          }
          onClick={() => {
            if (!canPickProfileImages) {
              return
            }
            profileHeaderInputRef.current?.click()
          }}
          onKeyDown={(event) => {
            if (!canPickProfileImages) {
              return
            }
            if (event.key !== 'Enter' && event.key !== ' ') {
              return
            }
            event.preventDefault()
            profileHeaderInputRef.current?.click()
          }}
          role={canPickProfileImages ? 'button' : undefined}
          tabIndex={canPickProfileImages ? 0 : undefined}
          aria-label={canPickProfileImages ? 'ヘッダー画像を選択' : undefined}
        >
          <button
            type="button"
            className="cms-profile-edit-button cms-profile-banner-edit-button"
            onClick={(event) => {
              event.stopPropagation()
              if (!canEditProfile) {
                setProfileError('プロフィール編集は管理者のみ実行できます。')
                return
              }
              if (profileEditMode) {
                void saveProfile()
                return
              }
              setProfileError('')
              setProfileMessage('')
              setProfileEditMode(true)
            }}
            disabled={profileSaving}
            aria-label={profileEditMode ? 'プロフィールを保存' : 'プロフィールを編集'}
            title={profileEditMode ? '保存' : '編集'}
          >
            <i
              className={`bi ${profileEditMode ? 'bi-check2-circle' : 'bi-pencil-square'}`}
              aria-hidden="true"
            />
          </button>
          {canPickProfileImages && (
            <div className="cms-profile-banner-upload-badge" aria-hidden="true">
              <i className="bi bi-cloud-arrow-up" />
            </div>
          )}
        </div>
        <div className="cms-profile-body">
          <div
            className={`cms-profile-avatar-wrap ${canPickProfileImages ? 'is-editing' : ''}`}
            onClick={() => {
              if (!canPickProfileImages) {
                return
              }
              profileIconInputRef.current?.click()
            }}
            onKeyDown={(event) => {
              if (!canPickProfileImages) {
                return
              }
              if (event.key !== 'Enter' && event.key !== ' ') {
                return
              }
              event.preventDefault()
              profileIconInputRef.current?.click()
            }}
            role={canPickProfileImages ? 'button' : undefined}
            tabIndex={canPickProfileImages ? 0 : undefined}
            aria-label={canPickProfileImages ? 'アイコン画像を選択' : undefined}
          >
            {previewIcon !== '' ? (
              <img
                className="cms-profile-avatar"
                src={previewIcon}
                alt="profile"
              />
            ) : (
              <div className="cms-profile-avatar cms-profile-avatar-empty" aria-hidden="true" />
            )}
            {canPickProfileImages && (
              <span className="cms-profile-avatar-upload-badge" aria-hidden="true">
                <i className="bi bi-camera-fill" />
              </span>
            )}
          </div>

          <div className="cms-profile-meta">
            <div className="cms-profile-meta-top">
              {profileEditMode ? (
                <input
                  type="text"
                  className="console-input cms-profile-input"
                  id="profile-display-name"
                  name="display_name"
                  aria-label="表示名"
                  value={profileForm.display_name}
                  maxLength={100}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      display_name: event.target.value,
                    }))
                  }
                />
              ) : (
                <h1>{userLabel}</h1>
              )}
            </div>

            <p className="cms-profile-email">{sessionUser?.email ?? '-'}</p>

            {profileEditMode ? (
              <>
                <textarea
                  className="console-textarea cms-profile-textarea"
                  id="profile-bio"
                  name="profile"
                  aria-label="自己紹介"
                  value={profileForm.profile}
                  maxLength={300}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      profile: event.target.value,
                    }))
                  }
                />
                <div className="cms-profile-meta-editor">
                  <div className="cms-profile-meta-editor-head">
                    <h2 className="cms-profile-meta-editor-title">追加プロフィール項目</h2>
                    <button
                      type="button"
                      className="console-secondary cms-profile-meta-add-button"
                      onClick={addProfileMetaItem}
                      disabled={profileForm.meta_items.length >= PROFILE_META_MAX_ITEMS}
                    >
                      <i className="bi bi-plus-lg" aria-hidden="true" />
                      項目を追加
                    </button>
                  </div>
                  <p className="cms-profile-meta-editor-caption">
                    {sessionUser?.meta_help_text ?? '任意のプロフィール情報を追加できます。'}
                  </p>
                  {profileForm.meta_items.length === 0 && (
                    <div className="cms-profile-meta-empty">追加項目はまだありません。</div>
                  )}
                  {profileForm.meta_items.map((item) => (
                    <div key={item.id} className="cms-profile-meta-row">
                      <input
                        type="text"
                        className="console-input cms-profile-meta-key"
                        placeholder="項目名（例: 使用機材）"
                        value={item.key}
                        maxLength={PROFILE_META_KEY_MAX_LENGTH}
                        onChange={(event) =>
                          updateProfileMetaItem(item.id, 'key', event.target.value)
                        }
                      />
                      <input
                        type="text"
                        className="console-input cms-profile-meta-value"
                        placeholder="内容（例: Nikon Zf）"
                        value={item.value}
                        maxLength={PROFILE_META_VALUE_MAX_LENGTH}
                        onChange={(event) =>
                          updateProfileMetaItem(item.id, 'value', event.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="console-secondary cms-profile-meta-remove-button"
                        onClick={() => removeProfileMetaItem(item.id)}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
                <input
                  ref={profileIconInputRef}
                  type="file"
                  className="cms-profile-hidden-input"
                  id="profile-icon-file"
                  name="icon_file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    setProfileIconFile(event.target.files?.[0] ?? null)
                  }
                />
                <input
                  ref={profileHeaderInputRef}
                  type="file"
                  className="cms-profile-hidden-input"
                  id="profile-header-image-file"
                  name="header_image_file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    setProfileHeaderImageFile(event.target.files?.[0] ?? null)
                  }
                />
                <div className="cms-profile-upload-hint">
                  アイコンかヘッダー画像をクリックして画像を選択してください。
                </div>
                {(profileIconFile !== null || profileHeaderImageFile !== null) && (
                  <div className="cms-profile-upload-files">
                    {profileIconFile !== null && (
                      <div>アイコン: {profileIconFile.name}</div>
                    )}
                    {profileHeaderImageFile !== null && (
                      <div>ヘッダー: {profileHeaderImageFile.name}</div>
                    )}
                  </div>
                )}
                <div className="cms-profile-validation-row">
                  <span>
                    表示名 {profileForm.display_name.trim().length}/100
                  </span>
                  <span>
                    自己紹介 {profileForm.profile.trim().length}/300
                  </span>
                  <span>
                    追加項目 {Object.keys(profileValidation.normalizedMeta).length}
                    /{PROFILE_META_MAX_ITEMS}
                  </span>
                </div>
                {profileValidation.message !== '' && (
                  <div className="console-error">{profileValidation.message}</div>
                )}
              </>
            ) : (
              <>
                <p className="cms-profile-description">{sessionUser?.profile ?? ''}</p>
                {profileMetaEntries.length > 0 && (
                  <dl className="cms-profile-meta-list">
                    {profileMetaEntries.map(([key, value]) => (
                      <div key={key} className="cms-profile-meta-list-item">
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )}

            <ConsoleNotice
              message={profileMessage}
              onClose={() => setProfileMessage('')}
            />
            {profileError !== '' && <div className="console-error">{profileError}</div>}
          </div>
        </div>
      </section>

      <section className="cms-tabs-shell">
        <div className="cms-tabs" role="tablist" aria-label="CMS tabs">
          {CMS_NAV_ITEMS.map((item) => {
            const tabKey = getCmsActiveTab(item.to)
            const active = tabKey === activeTab
            return (
              <button
                key={item.to}
                type="button"
                role="tab"
                aria-selected={active}
                className={`cms-tab ${active ? 'is-active' : ''}`}
                onClick={() => {
                  if (active) {
                    return
                  }
                  startTransition(() => {
                    navigate(item.to)
                  })
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
        <div key={activeTab} className="cms-tab-panel">
          {renderTabContent()}
        </div>
      </section>

      <Link
        className="console-compose-fab"
        to="/cms/console/articles/new"
        aria-label="記事作成へ移動"
        title="記事作成"
      >
        <i className="bi bi-pencil-square" aria-hidden="true" />
      </Link>
    </div>
  )
}

function CmsNotFound() {
  return (
    <main className="page">
      <h1>CMS 404</h1>
      <p>CMSページが見つかりませんでした。</p>
      <Link to="/cms/console">CMSトップへ戻る</Link>
    </main>
  )
}

function NotFound() {
  return (
    <main className="page">
      <h1>404</h1>
      <p>ページが見つかりませんでした。</p>
      <Link to="/">トップへ戻る</Link>
    </main>
  )
}

function GlobalApiLoadingIndicator() {
  const isLoading = useSyncExternalStore(
    subscribeApiLoading,
    getApiLoadingSnapshot,
    getApiLoadingSnapshot,
  )

  return (
    <div
      className={`global-api-spinner${isLoading ? ' is-visible' : ''}`}
      aria-hidden={!isLoading}
    >
      <div className="global-api-spinner-chip" role="status" aria-live="polite" aria-label="通信中">
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
        <span className="visually-hidden">通信中</span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <>
      <GlobalApiLoadingIndicator />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cms" element={<Navigate to="/cms/console/articles" replace />} />
        <Route path="/cms/console" element={<CmsConsoleLayout />}>
          <Route index element={<Navigate to="/cms/console/articles" replace />} />
          <Route path="me" element={<Navigate to="/cms/console" replace />} />
          <Route path="articles/new" element={<CmsArticleEditorPage />} />
          <Route path="articles/:articleId/edit" element={<CmsArticleEditorPage />} />
          <Route
            path="articles"
            element={<CmsConsolePage />}
          />
          <Route
            path="categories"
            element={<CmsConsolePage />}
          />
          <Route
            path="contacts"
            element={<CmsConsolePage />}
          />
          <Route
            path="users"
            element={<CmsConsolePage />}
          />
          <Route
            path="ogp"
            element={<CmsConsolePage />}
          />
          <Route path="impressions" element={<CmsConsolePage />} />
        </Route>
        <Route path="/cms/*" element={<CmsNotFound />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
