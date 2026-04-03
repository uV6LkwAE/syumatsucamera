import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  matchPath,
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
import ConsoleSpinner from './components/ConsoleSpinner'
import CmsTabGuide from './components/CmsTabGuide'
import ConsoleHeroCard from './components/ConsoleHeroCard'
import ConsoleNotice from './components/ConsoleNotice'
import ContactsPage from './features/contacts/ContactsPage'
import CmsArticleEditorPage from './features/cms/articles/CmsArticleEditorPage'
import CmsArticlesPage from './features/cms/articles/CmsArticlesPage'
import CmsCategoriesPage from './features/cms/categories/CmsCategoriesPage'
import CmsArticleSaveLogsPage from './features/cms/logs/CmsArticleSaveLogsPage'
import CmsPublishRequestsPage from './features/cms/requests/CmsPublishRequestsPage'
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
  allowedRoles: Array<CmsSessionUser['role']>
}

const CMS_NAV_ITEMS: CmsNavItem[] = [
  {
    to: '/cms/console/profile',
    label: 'プロフィール',
    icon: 'bi-person-circle',
    allowedRoles: ['admin', 'author'],
  },
  {
    to: '/cms/console/articles',
    label: '記事',
    icon: 'bi-file-earmark-text',
    allowedRoles: ['admin', 'author'],
  },
  {
    to: '/cms/console/articles/new',
    label: '執筆',
    icon: 'bi-pencil-square',
    allowedRoles: ['admin', 'author'],
  },
  {
    to: '/cms/console/logs',
    label: 'ログ',
    icon: 'bi-journal-text',
    allowedRoles: ['admin', 'author'],
  },
  {
    to: '/cms/console/requests',
    label: 'リクエスト',
    icon: 'bi-inbox',
    allowedRoles: ['admin'],
  },
  {
    to: '/cms/console/categories',
    label: 'カテゴリー',
    icon: 'bi-diagram-3',
    allowedRoles: ['admin'],
  },
  {
    to: '/cms/console/contacts',
    label: '問い合わせ',
    icon: 'bi-envelope',
    allowedRoles: ['admin'],
  },
  {
    to: '/cms/console/users',
    label: 'ユーザー',
    icon: 'bi-people',
    allowedRoles: ['admin'],
  },
  {
    to: '/cms/console/ogp',
    label: 'OGP',
    icon: 'bi-link-45deg',
    allowedRoles: ['admin'],
  },
  {
    to: '/cms/console/impressions',
    label: 'インプレッション',
    icon: 'bi-bar-chart-line',
    allowedRoles: ['admin'],
  },
]

type CmsTabKey =
  | 'profile'
  | 'articles'
  | 'compose'
  | 'logs'
  | 'requests'
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
  sessionResolved: boolean
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
const PROFILE_DISPLAY_NAME_MAX_LENGTH = 100
const PROFILE_BIO_MAX_LENGTH = 300
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
  if (normalizedDisplayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `表示名は${PROFILE_DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください。`,
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
  if (normalizedProfile.length > PROFILE_BIO_MAX_LENGTH) {
    return {
      valid: false,
      message: `自己紹介は${PROFILE_BIO_MAX_LENGTH}文字以内で入力してください。`,
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
  if (pathname.startsWith('/cms/console/profile')) {
    return 'profile'
  }
  if (pathname === '/cms/console/articles/new') {
    return 'compose'
  }
  if (matchPath('/cms/console/articles/:articleId/edit', pathname) !== null) {
    return 'compose'
  }
  if (pathname.startsWith('/cms/console/logs')) {
    return 'logs'
  }
  if (pathname === '/cms/console/articles') {
    return 'articles'
  }
  if (pathname.startsWith('/cms/console/articles')) {
    return 'articles'
  }
  if (pathname.startsWith('/cms/console/requests')) {
    return 'requests'
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
  return 'profile'
}

function canAccessCmsTab(
  tabKey: CmsTabKey,
  role: CmsSessionUser['role'] | undefined,
): boolean {
  if (role === undefined) {
    return tabKey === 'profile'
  }

  return CMS_NAV_ITEMS.some(
    (item) =>
      getCmsActiveTab(item.to) === tabKey
      && item.allowedRoles.includes(role),
  )
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
  const [sessionUser, setSessionUser] = useState<CmsSessionUser | null>(null)
  const [sessionResolved, setSessionResolved] = useState(false)

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
      } finally {
        if (active) {
          setSessionResolved(true)
        }
      }
    }

    void loadSessionMe()
    return () => {
      active = false
    }
  }, [])

  const displayName = sessionUser?.display_name ?? ''
  const userLabel = displayName.trim() !== '' ? displayName : (sessionUser?.email ?? '未認証')
  const roleLabel = toCmsRoleLabel(sessionUser?.role)

  return (
    <>
      <header className="console-header">
        <div className="console-header-content container-xxl px-3 px-md-4 d-flex align-items-center justify-content-between gap-3">
          <Link className="console-header-booth" to="/cms/console">
            週末カメラ
          </Link>
          <div className="console-header-right d-flex align-items-center">
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
        <main className="console-page container-xxl px-0">
          <Outlet context={{ sessionUser, setSessionUser, sessionResolved }} />
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
  helpLines,
}: {
  title: string
  helpLines: string[]
}) {
  return (
    <div className="cms-tab-embedded">
      <CmsTabGuide title={title} helpLines={helpLines} />
      <div className="console-placeholder">この機能は順次実装します。</div>
    </div>
  )
}

function CmsPermissionLockedPanel() {
  return (
    <div className="cms-tab-embedded">
      <div className="cms-permission-locked-panel">
        <i className="bi bi-shield-lock" aria-hidden="true" />
        <div className="cms-permission-locked-copy">
          <strong>管理者のみ操作できます</strong>
          <span>このタブの操作権限が必要な場合は、管理者へ権限付与を依頼してください。</span>
        </div>
      </div>
    </div>
  )
}

function CmsConsolePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { sessionUser, setSessionUser, sessionResolved } = useOutletContext<CmsOutletContext>()
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

  function renderProfileHero(): JSX.Element {
    return (
      <section className="console-card cms-profile-hero">
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
            <div className="cms-profile-meta-top d-flex flex-column gap-2 align-items-start">
              {profileEditMode ? (
                <div className="cms-profile-edit-section">
                  <div className="cms-profile-field-head">
                    <label className="cms-profile-field-label" htmlFor="profile-display-name">
                      表示名
                    </label>
                    <span className="cms-profile-field-counter">
                      {profileForm.display_name.length}/{PROFILE_DISPLAY_NAME_MAX_LENGTH}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="console-input form-control cms-profile-input"
                    id="profile-display-name"
                    name="display_name"
                    aria-label="表示名"
                    value={profileForm.display_name}
                    maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH}
                    onChange={(event) =>
                      setProfileForm((prev) => ({
                        ...prev,
                        display_name: event.target.value,
                      }))
                    }
                  />
                </div>
              ) : (
                <h1>{userLabel}</h1>
              )}
            </div>

            <p className="cms-profile-email">{sessionUser?.email ?? '-'}</p>

            {profileEditMode ? (
              <>
                <div className="cms-profile-edit-section">
                  <div className="cms-profile-field-head">
                    <label className="cms-profile-field-label" htmlFor="profile-bio">
                      自己紹介
                    </label>
                    <span className="cms-profile-field-counter">
                      {profileForm.profile.length}/{PROFILE_BIO_MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    className="console-textarea form-control cms-profile-textarea"
                    id="profile-bio"
                    name="profile"
                    aria-label="自己紹介"
                    value={profileForm.profile}
                    maxLength={PROFILE_BIO_MAX_LENGTH}
                    onChange={(event) =>
                      setProfileForm((prev) => ({
                        ...prev,
                        profile: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="cms-profile-meta-editor">
                  <div className="cms-profile-meta-editor-head d-flex flex-column flex-md-row align-items-start justify-content-between gap-2">
                    <div className="cms-profile-meta-editor-title-wrap d-flex flex-wrap align-items-baseline gap-2">
                      <h2 className="cms-profile-meta-editor-title">追加プロフィール項目</h2>
                      <span className="cms-profile-field-counter">
                        {profileForm.meta_items.length}/{PROFILE_META_MAX_ITEMS}
                      </span>
                    </div>
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
                    <div key={item.id} className="cms-profile-meta-row d-flex flex-column flex-xl-row align-items-stretch gap-3">
                      <div className="cms-profile-meta-row-field">
                        <div className="cms-profile-field-head is-compact">
                          <label
                            className="cms-profile-field-label"
                            htmlFor={`profile-meta-key-${item.id}`}
                          >
                            項目名
                          </label>
                          <span className="cms-profile-field-counter">
                            {item.key.length}/{PROFILE_META_KEY_MAX_LENGTH}
                          </span>
                        </div>
                        <input
                          type="text"
                          id={`profile-meta-key-${item.id}`}
                          name={`meta_key_${item.id}`}
                          className="console-input form-control cms-profile-meta-key"
                          placeholder="項目名（例: 使用機材）"
                          value={item.key}
                          maxLength={PROFILE_META_KEY_MAX_LENGTH}
                          onChange={(event) =>
                            updateProfileMetaItem(item.id, 'key', event.target.value)
                          }
                        />
                      </div>
                      <div className="cms-profile-meta-row-field">
                        <div className="cms-profile-field-head is-compact">
                          <label
                            className="cms-profile-field-label"
                            htmlFor={`profile-meta-value-${item.id}`}
                          >
                            内容
                          </label>
                          <span className="cms-profile-field-counter">
                            {item.value.length}/{PROFILE_META_VALUE_MAX_LENGTH}
                          </span>
                        </div>
                        <input
                          type="text"
                          id={`profile-meta-value-${item.id}`}
                          name={`meta_value_${item.id}`}
                          className="console-input form-control cms-profile-meta-value"
                          placeholder="内容（例: Nikon Zf）"
                          value={item.value}
                          maxLength={PROFILE_META_VALUE_MAX_LENGTH}
                          onChange={(event) =>
                            updateProfileMetaItem(item.id, 'value', event.target.value)
                          }
                        />
                      </div>
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
    )
  }

  function renderTabHero(): JSX.Element {
    if (activeTab === 'profile') {
      return (
        <ConsoleHeroCard
          badge="プロフィール"
          title="プロフィール"
          subtitle="表示名、自己紹介、画像、追加項目をここで管理します。"
          icon="bi-person-circle"
        />
      )
    }
    if (activeTab === 'articles') {
      return (
        <ConsoleHeroCard
          badge="記事"
          title="記事管理"
          subtitle="まず絞り込みで対象を見つけてから、編集や削除へ進みます。"
          icon="bi-file-earmark-text"
        />
      )
    }
    if (activeTab === 'compose') {
      return (
        <ConsoleHeroCard
          badge="執筆"
          title="記事執筆"
          subtitle="新規作成と既存記事の編集をここで行います。"
          icon="bi-pencil-square"
        />
      )
    }
    if (activeTab === 'categories') {
      return (
        <ConsoleHeroCard
          badge="カテゴリー"
          title="カテゴリ管理"
          subtitle="左から右へ階層を追いながら、親子関係を崩さず整理します。"
          icon="bi-diagram-3"
        />
      )
    }
    if (activeTab === 'logs') {
      return (
        <ConsoleHeroCard
          badge="ログ"
          title="保存ログ"
          subtitle="記事ごとの保存後処理ログを確認し、lock token 単位で実行履歴を追跡します。"
          icon="bi-journal-text"
        />
      )
    }
    if (activeTab === 'requests') {
      return (
        <ConsoleHeroCard
          badge="リクエスト"
          title="公開申請"
          subtitle="公開前の記事を確認し、承認または却下でステータスを整理します。"
          icon="bi-inbox"
        />
      )
    }
    if (activeTab === 'contacts') {
      return (
        <ConsoleHeroCard
          badge="お問い合わせ"
          title="問い合わせ管理"
          subtitle="新しい問い合わせから順に確認し、必要な内容を本文で追います。"
          icon="bi-envelope"
        />
      )
    }
    if (activeTab === 'users') {
      return (
        <ConsoleHeroCard
          badge="Users"
          title="ユーザー管理"
          subtitle="まず一覧で対象を選び、詳細画面で権限と招待を整えます。"
          icon="bi-people"
        />
      )
    }
    if (activeTab === 'ogp') {
      return (
        <ConsoleHeroCard
          badge="OGP"
          title="OGP"
          subtitle="公開前にリンクカードのキャッシュ状態をここで確認します。"
          icon="bi-link-45deg"
        />
      )
    }
    return (
      <ConsoleHeroCard
        badge="分析"
        title="インプレッション"
        subtitle="公開後の流入傾向をこのタブで追えるようにします。"
        icon="bi-bar-chart-line"
      />
    )
  }

  function renderTabContent() {
    if (!sessionResolved) {
      return <div className="console-loading-shell" />
    }

    if (!canAccessCmsTab(activeTab, sessionUser?.role)) {
      return <CmsPermissionLockedPanel />
    }

    if (activeTab === 'profile') {
      return (
        <div className="cms-tab-embedded">
          <CmsTabGuide
            title="プロフィールの作成と編集"
            helpLines={[
              '記事ページに執筆者の紹介として表示されます。',
              'ヘッダー画像とアイコン画像を更新できます。',
              '管理者のみプロフィールを編集できます。',
              '追加項目は表示用プロフィールとして公開側でも利用できます。'
            ]}
          />
          {renderProfileHero()}
        </div>
      )
    }
    if (activeTab === 'articles') {
      return <CmsArticlesPage embedded />
    }
    if (activeTab === 'compose') {
      return <CmsArticleEditorPage embedded />
    }
    if (activeTab === 'logs') {
      return <CmsArticleSaveLogsPage embedded />
    }
    if (activeTab === 'categories') {
      return <CmsCategoriesPage embedded />
    }
    if (activeTab === 'requests') {
      return <CmsPublishRequestsPage embedded />
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
          title="OGPキャッシュの確認"
          helpLines={[
            '公開前にタイトルや画像の取得結果を確認できます。',
            '再取得や更新系の操作はこのタブに集約します。',
            '未実装の機能は順次追加します。',
          ]}
        />
      )
    }
    return (
      <CmsTabPlaceholder
        title="インプレッションの確認"
        helpLines={[
          'PVや流入傾向を一覧で確認できる想定です。',
          '分析条件の切り替えはこのタブに集約します。',
          '未実装の機能は順次追加します。',
        ]}
      />
    )
  }

  return (
    <div className="console-dashboard cms-profile-page">
      {renderTabHero()}
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

  if (!isLoading) {
    return null
  }

  return <ConsoleSpinner mode="overlay" label="通信中" />
}

export default function App() {
  return (
    <>
      <GlobalApiLoadingIndicator />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cms" element={<Navigate to="/cms/console/profile" replace />} />
        <Route path="/cms/console" element={<CmsConsoleLayout />}>
          <Route index element={<Navigate to="/cms/console/profile" replace />} />
          <Route path="me" element={<Navigate to="/cms/console/profile" replace />} />
          <Route path="profile" element={<CmsConsolePage />} />
          <Route path="articles/new" element={<CmsConsolePage />} />
          <Route path="articles/:articleId/edit" element={<CmsConsolePage />} />
          <Route
            path="articles"
            element={<CmsConsolePage />}
          />
          <Route
            path="logs"
            element={<CmsConsolePage />}
          />
          <Route
            path="logs/:articleId"
            element={<CmsConsolePage />}
          />
          <Route
            path="categories"
            element={<CmsConsolePage />}
          />
          <Route
            path="requests"
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
