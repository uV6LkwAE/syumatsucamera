import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, apiRequest } from '../../api/client'
import ApiErrorPopup from '../../components/ApiErrorPopup'
import CmsTabGuide from '../../components/CmsTabGuide'
import ConsoleNotice from '../../components/ConsoleNotice'

type UserRole = 'admin' | 'author'

type ActivationUserDetail = {
  user_id: string
  email: string
  role: UserRole
  is_active: boolean
  display_name: string | null
  icon: string | null
  header_image: string | null
  profile: string | null
  x_url: string | null
  instagram_url: string | null
  website_url: string | null
  meta: Record<string, string>
}

type RegistrationCompleteForm = {
  display_name: string
  profile: string
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.code}: ${error.detail}`
  }
  return '通信中に予期しないエラーが発生しました。'
}

function toRoleLabel(role: UserRole): string {
  return role === 'admin' ? '管理者' : '執筆者'
}

function buildSocialLinks(user: ActivationUserDetail): Array<{ key: string; url: string; label: string; icon: string }> {
  return [
    user.x_url === null
      ? null
      : { key: 'x', url: user.x_url, label: 'X', icon: 'bi-twitter-x' },
    user.instagram_url === null
      ? null
      : { key: 'instagram', url: user.instagram_url, label: 'Instagram', icon: 'bi-instagram' },
    user.website_url === null
      ? null
      : { key: 'website', url: user.website_url, label: 'Webサイト', icon: 'bi-globe2' },
  ].filter((item): item is { key: string; url: string; label: string; icon: string } => item !== null)
}

export default function UsersActivationPage() {
  const params = useParams()
  const userId = params.userId ?? ''

  const [user, setUser] = useState<ActivationUserDetail | null>(null)
  const [form, setForm] = useState<RegistrationCompleteForm>({
    display_name: '',
    profile: '',
  })
  const [loading, setLoading] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [message, setMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<unknown>('')
  const [completed, setCompleted] = useState<boolean>(false)

  useEffect(() => {
    if (userId === '') {
      setErrorMessage('本登録対象ユーザーが存在しません。')
      return
    }

    let isMounted = true
    async function loadActivationUser(): Promise<void> {
      setLoading(true)
      setErrorMessage('')
      try {
        const payload = await apiRequest<ActivationUserDetail>(`/users/activate/${userId}`)
        if (!isMounted) {
          return
        }
        setUser(payload)
        setForm({
          display_name: payload.display_name ?? '',
          profile: payload.profile ?? '',
        })
      } catch (error) {
        if (!isMounted) {
          return
        }
        setUser(null)
        setErrorMessage(error)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadActivationUser()
    return () => {
      isMounted = false
    }
  }, [userId])

  const socialLinks = useMemo(() => {
    if (user === null) {
      return []
    }
    return buildSocialLinks(user)
  }, [user])

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (user === null) {
      setErrorMessage('本登録対象ユーザーが存在しません。')
      return
    }
    setSubmitting(true)
    setMessage('')
    setErrorMessage('')
    try {
      await apiRequest(`/users/activate/${user.user_id}`, {
        method: 'POST',
        body: {
          display_name: form.display_name,
          profile: form.profile,
          icon: user.icon ?? '',
          header_image: user.header_image ?? '',
        },
      })
      setCompleted(true)
      setMessage('本登録が完了しました。')
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setSubmitting(false)
    }
  }

  const bannerStyle =
    user?.header_image !== undefined && user.header_image !== null && user.header_image.trim() !== ''
      ? { backgroundImage: `url(${user.header_image})` }
      : undefined

  return (
    <div className="console-dashboard cms-profile-page">
      <CmsTabGuide
        title="本登録"
        helpLines={[
          '本登録対象ユーザーの情報を確認し、表示名と自己紹介を入力して完了します。',
          '本登録URLは管理者が表示したものを使用してください。',
          '本登録完了後は同じURLを再利用できません。',
        ]}
      />

      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      <ApiErrorPopup error={errorMessage} onClose={() => setErrorMessage('')} />

      {loading ? (
        <div className="console-card">
          <div className="console-card-header">
            <h2>読み込み中</h2>
            <p>本登録対象ユーザー情報を取得しています。</p>
          </div>
        </div>
      ) : user === null ? (
        <div className="console-card">
          <div className="console-card-header">
            <h2>本登録</h2>
            <p>本登録対象ユーザーを取得できませんでした。</p>
          </div>
          <div className="console-static-value">
            <Link to="/cms/console/profile">プロフィール画面へ戻る</Link>
          </div>
        </div>
      ) : completed ? (
        <div className="console-card">
          <div className="console-card-header">
            <h2>本登録完了</h2>
            <p>本登録が完了しました。</p>
          </div>
          <div className="console-static-value">
            <Link to="/cms/console/profile">プロフィール画面へ戻る</Link>
          </div>
        </div>
      ) : (
        <form className="console-card cms-profile-hero" onSubmit={(event) => void onSubmit(event)}>
          <div className="cms-profile-banner" style={bannerStyle}>
            <button
              type="submit"
              className="cms-profile-edit-button cms-profile-banner-edit-button"
              disabled={submitting}
              aria-label="本登録を完了"
              title="保存"
            >
              <i className={`bi ${submitting ? 'bi-hourglass-split' : 'bi-check2-circle'}`} />
            </button>
          </div>

          <div className="cms-profile-body">
            <div className="cms-profile-avatar-wrap">
              {user.icon !== null && user.icon.trim() !== '' ? (
                <img className="cms-profile-avatar" src={user.icon} alt="avatar" />
              ) : (
                <div className="cms-profile-avatar cms-profile-avatar-empty" aria-hidden="true" />
              )}
            </div>

            <div className="cms-profile-meta">
              <div className="cms-profile-meta-top d-flex flex-column gap-2 align-items-start">
                <h1>{user.display_name ?? user.email}</h1>
                <p className="cms-profile-email">{user.email}</p>
              </div>

              <div className="cms-profile-edit-section">
                <div className="cms-profile-field-head">
                  <label className="cms-profile-field-label" htmlFor="activation-display-name">
                    表示名
                  </label>
                  <span className="cms-profile-field-counter">
                    {form.display_name.length}/100
                  </span>
                </div>
                <input
                  id="activation-display-name"
                  className="console-input form-control cms-profile-input"
                  value={form.display_name}
                  maxLength={100}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, display_name: event.target.value }))
                  }
                />
              </div>

              <div className="cms-profile-edit-section">
                <div className="cms-profile-field-head">
                  <label className="cms-profile-field-label" htmlFor="activation-profile">
                    自己紹介
                  </label>
                  <span className="cms-profile-field-counter">{form.profile.length}/300</span>
                </div>
                <textarea
                  id="activation-profile"
                  className="console-textarea form-control cms-profile-textarea"
                  rows={10}
                  maxLength={300}
                  value={form.profile}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, profile: event.target.value }))
                  }
                />
              </div>

              <div className="cms-profile-social-editor">
                <div className="cms-profile-meta-editor-title-wrap">
                  <h2 className="cms-profile-meta-editor-title">リンク</h2>
                  <span className="cms-profile-meta-editor-caption">
                    本登録前に確認できるリンク情報です。
                  </span>
                </div>
                {socialLinks.length > 0 ? (
                  <div className="cms-profile-social-list">
                    {socialLinks.map((item) => (
                      <a
                        key={item.key}
                        className="cms-profile-social-link"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <i className={`bi ${item.icon}`} aria-hidden="true" />
                        <span>{item.label}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="cms-profile-meta-empty">リンクは登録されていません。</div>
                )}
              </div>

              <dl className="cms-profile-meta-list">
                <div className="cms-profile-meta-list-item">
                  <dt>権限</dt>
                  <dd>{toRoleLabel(user.role)}</dd>
                </div>
                <div className="cms-profile-meta-list-item">
                  <dt>状態</dt>
                  <dd>{user.is_active ? '本登録済み' : '本登録前'}</dd>
                </div>
                {Object.entries(user.meta).map(([key, value]) => (
                  <div key={key} className="cms-profile-meta-list-item">
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
