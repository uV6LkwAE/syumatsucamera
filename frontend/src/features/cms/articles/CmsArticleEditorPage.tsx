import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import JoditEditor from 'jodit-react'
import 'jodit/es2021/jodit.min.css'
import { apiRequest, getStoredAccessJwt } from '../../../api/client'
import ConsoleNotice from '../../../components/ConsoleNotice'
import CmsCategoryVisualPicker from '../components/CmsCategoryVisualPicker'
import {
  formatCmsDate,
  normalizeStoredArticleHtml,
  resolveDeleteImageIds,
  toApiMessage,
  collectTempImageFileNames,
} from '../helpers'
import type {
  CmsArticleDetail,
  CmsArticleMediaAsset,
  CmsArticleMutationResponse,
  CmsArticleSessionResponse,
  CmsCategoryTreeResponse,
  CmsImageUploadResponse,
  CmsTwitterCard,
} from '../types'

type CmsOutletContext = {
  sessionUser: {
    role: 'admin' | 'author'
  } | null
}

type InternalThumbnailMode =
  | 'keep_current'
  | 'use_default'
  | 'generate_from_title'
  | 'use_uploaded'

type ImageProcessingOptions = {
  resize: boolean
  exif_watermark: boolean
  site_logo_watermark: boolean
  custom_text_overlay: boolean
  custom_text: string
}

type ArticleFormState = {
  categoryId: string
  title: string
  summary: string
  bodyHtml: string
  status: 'draft' | 'publish' | 'private'
  twitterCard: CmsTwitterCard
  isPr: boolean
  isAd: boolean
  tagIds: string[]
}

const DEFAULT_IMAGE_OPTIONS: ImageProcessingOptions = {
  resize: true,
  exif_watermark: true,
  site_logo_watermark: false,
  custom_text_overlay: false,
  custom_text: '',
}

const DEFAULT_ARTICLE_FORM: ArticleFormState = {
  categoryId: '',
  title: '',
  summary: '',
  bodyHtml: '<p></p>',
  status: 'draft',
  twitterCard: 'summary_large_image',
  isPr: false,
  isAd: false,
  tagIds: [],
}

const SESSION_REFRESH_INTERVAL_MS = 120_000

function createUuidFileName(name: string, mimeType: string): string {
  const extension = resolveFileExtension(name, mimeType)
  return `${crypto.randomUUID()}.${extension}`
}

function resolveFileExtension(name: string, mimeType: string): string {
  const parts = name.split('.')
  const fromName = parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() ?? '' : ''
  if (fromName !== '') {
    return fromName
  }

  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }
  if (mimeType === 'image/png') {
    return 'png'
  }
  if (mimeType === 'image/webp') {
    return 'webp'
  }
  if (mimeType === 'image/gif') {
    return 'gif'
  }
  return 'png'
}

function renameFileWithUuid(file: File): File {
  return new File([file], createUuidFileName(file.name, file.type), {
    type: file.type,
    lastModified: file.lastModified,
  })
}

function toStatusOptions(
  role: 'admin' | 'author' | undefined,
  currentStatus: ArticleFormState['status'],
): Array<{ value: ArticleFormState['status']; label: string }> {
  if (role === 'admin') {
    return [
      { value: 'draft', label: '下書き' },
      { value: 'private', label: '非公開' },
      { value: 'publish', label: '公開' },
    ]
  }

  const options: Array<{ value: ArticleFormState['status']; label: string }> = [
    { value: 'draft', label: '下書き' },
    { value: 'private', label: '非公開' },
  ]
  if (currentStatus === 'publish') {
    options.push({ value: 'publish', label: '公開' })
  }
  return options
}

function findCurrentThumbnail(assets: CmsArticleMediaAsset[]): CmsArticleMediaAsset | null {
  return assets.find((asset) => asset.is_thumbnail) ?? null
}

export default function CmsArticleEditorPage() {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const { sessionUser } = useOutletContext<CmsOutletContext>()
  const isCreate = articleId === undefined

  const releaseSessionOnLeaveRef = useRef(true)
  const sessionRefreshTimerRef = useRef<number | null>(null)
  const lockTokenRef = useRef('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submittingPublishRequest, setSubmittingPublishRequest] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [lockToken, setLockToken] = useState('')
  const [lockExpiresAt, setLockExpiresAt] = useState('')
  const [categories, setCategories] = useState<CmsCategoryTreeResponse['items']>([])
  const [article, setArticle] = useState<CmsArticleDetail | null>(null)
  const [initialMediaAssets, setInitialMediaAssets] = useState<CmsArticleMediaAsset[]>([])
  const [currentThumbnailAsset, setCurrentThumbnailAsset] = useState<CmsArticleMediaAsset | null>(null)

  const [form, setForm] = useState<ArticleFormState>(DEFAULT_ARTICLE_FORM)
  const [uploadedImageOptions, setUploadedImageOptions] = useState<Record<string, ImageProcessingOptions>>({})

  const [thumbnailMode, setThumbnailMode] = useState<InternalThumbnailMode>('generate_from_title')
  const [thumbnailTitleText, setThumbnailTitleText] = useState('')
  const [thumbnailUploadFileName, setThumbnailUploadFileName] = useState('')
  const [thumbnailPreviewPath, setThumbnailPreviewPath] = useState('')

  const statusOptions = toStatusOptions(sessionUser?.role, form.status)

  useEffect(() => {
    let active = true

    async function bootstrap(): Promise<void> {
      setLoading(true)
      setErrorMessage('')
      try {
        const [categoryPayload, sessionPayload] = await Promise.all([
          apiRequest<CmsCategoryTreeResponse>('/cms/categories?limit=200'),
          apiRequest<CmsArticleSessionResponse>('/cms/article-sessions', {
            method: 'POST',
            body: isCreate ? {} : { article_id: articleId },
          }),
        ])

        if (!active) {
          return
        }

        setCategories(categoryPayload.items)
        setLockToken(sessionPayload.lock_token)
        setLockExpiresAt(sessionPayload.lock_expires_at)

        if (!isCreate && articleId !== undefined) {
          const detail = await apiRequest<CmsArticleDetail>(`/cms/articles/${articleId}`)
          if (!active) {
            return
          }
          const thumbnailAsset = findCurrentThumbnail(detail.media_assets)
          setArticle(detail)
          setInitialMediaAssets(detail.media_assets)
          setCurrentThumbnailAsset(thumbnailAsset)
          setForm({
            categoryId: detail.category_id,
            title: detail.title,
            summary: detail.summary,
            bodyHtml: normalizeStoredArticleHtml(detail.body_html),
            status: detail.status,
            twitterCard: detail.twitter_card,
            isPr: detail.article_option.is_pr,
            isAd: detail.article_option.is_ad,
            tagIds: detail.tags.map((tag) => tag.id),
          })
          setThumbnailMode(thumbnailAsset === null ? 'generate_from_title' : 'keep_current')
          setThumbnailTitleText(detail.title)
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath(thumbnailAsset?.public_path ?? '')
        } else {
          setForm(DEFAULT_ARTICLE_FORM)
          setThumbnailMode('generate_from_title')
          setThumbnailTitleText('')
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath('')
        }
      } catch (error) {
        if (active) {
          setErrorMessage(toApiMessage(error))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void bootstrap()

    return () => {
      active = false
    }
  }, [articleId, isCreate])

  useEffect(() => {
    lockTokenRef.current = lockToken
  }, [lockToken])

  useEffect(() => {
    return () => {
      if (sessionRefreshTimerRef.current !== null) {
        window.clearInterval(sessionRefreshTimerRef.current)
        sessionRefreshTimerRef.current = null
      }
      if (releaseSessionOnLeaveRef.current && lockTokenRef.current !== '') {
        void apiRequest(`/cms/article-sessions/${lockTokenRef.current}`, {
          method: 'DELETE',
        }).catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    if (lockToken === '') {
      return
    }
    if (sessionRefreshTimerRef.current !== null) {
      window.clearInterval(sessionRefreshTimerRef.current)
    }
    sessionRefreshTimerRef.current = window.setInterval(() => {
      void apiRequest<CmsArticleSessionResponse>(`/cms/article-sessions/${lockToken}`, {
        method: 'PATCH',
      })
        .then((payload) => {
          setLockExpiresAt(payload.lock_expires_at)
        })
        .catch(() => undefined)
    }, SESSION_REFRESH_INTERVAL_MS)

    return () => {
      if (sessionRefreshTimerRef.current !== null) {
        window.clearInterval(sessionRefreshTimerRef.current)
        sessionRefreshTimerRef.current = null
      }
    }
  }, [lockToken])

  async function uploadTempImage(file: File): Promise<CmsImageUploadResponse> {
    if (lockToken === '') {
      throw new Error('編集中セッションが確立されていません。')
    }

    const formData = new FormData()
    formData.append('lock_token', lockToken)
    formData.append('file', renameFileWithUuid(file))

    return apiRequest<CmsImageUploadResponse>('/cms/article-images', {
      method: 'POST',
      body: formData,
    })
  }

  async function uploadExistingThumbnailAsTemp(): Promise<CmsImageUploadResponse> {
    if (currentThumbnailAsset === null) {
      throw new Error('現在のサムネイルが存在しません。')
    }

    const response = await fetch(currentThumbnailAsset.public_path)
    if (!response.ok) {
      throw new Error('既存サムネイルの再アップロードに失敗しました。')
    }

    const blob = await response.blob()
    const file = new File(
      [blob],
      createUuidFileName(currentThumbnailAsset.file_name, blob.type),
      {
        type: blob.type || 'image/png',
      },
    )
    return uploadTempImage(file)
  }

  async function buildThumbnailRequest(): Promise<Record<string, string>> {
    if (thumbnailMode === 'use_uploaded') {
      if (thumbnailUploadFileName.trim() === '') {
        throw new Error('サムネイル画像をアップロードしてください。')
      }
      return {
        mode: 'use_uploaded',
        file_name: thumbnailUploadFileName,
      }
    }

    if (thumbnailMode === 'generate_from_title') {
      return {
        mode: 'generate_from_title',
        title_text: thumbnailTitleText.trim() !== '' ? thumbnailTitleText.trim() : form.title.trim(),
      }
    }

    if (thumbnailMode === 'keep_current') {
      const uploaded = await uploadExistingThumbnailAsTemp()
      return {
        mode: 'use_uploaded',
        file_name: uploaded.file_name,
      }
    }

    return {
      mode: 'use_default',
    }
  }

  async function saveArticle(): Promise<void> {
    if (lockToken === '') {
      setErrorMessage('編集中セッションが未取得です。ページを再読み込みしてください。')
      return
    }
    if (form.categoryId === '') {
      setErrorMessage('カテゴリを選択してください。')
      return
    }
    if (form.title.trim() === '') {
      setErrorMessage('タイトルは必須です。')
      return
    }
    if (form.summary.trim() === '') {
      setErrorMessage('要約は必須です。')
      return
    }

    setSaving(true)
    setErrorMessage('')
    setMessage('')

    try {
      const thumbnailRequest = await buildThumbnailRequest()
      const newImageFileNames = collectTempImageFileNames(form.bodyHtml, lockToken)
      const deleteImageIds = resolveDeleteImageIds(initialMediaAssets, form.bodyHtml)

      const payload = {
        category_id: form.categoryId,
        title: form.title,
        summary: form.summary,
        body_html: form.bodyHtml,
        status: form.status,
        tag_ids: form.tagIds,
        twitter_card: form.twitterCard,
        article_option: {
          is_pr: form.isPr,
          is_ad: form.isAd,
        },
        image_diff: {
          lock_token: lockToken,
          new_images: newImageFileNames.map((fileName) => ({
            file_name: fileName,
            options: uploadedImageOptions[fileName] ?? DEFAULT_IMAGE_OPTIONS,
          })),
          delete_images: deleteImageIds,
          thumbnail_request: thumbnailRequest,
        },
      }

      const endpoint = isCreate ? '/cms/articles' : `/cms/articles/${articleId}`
      const method = isCreate ? 'POST' : 'PATCH'
      const response = await apiRequest<CmsArticleMutationResponse>(endpoint, {
        method,
        body: payload,
      })

      releaseSessionOnLeaveRef.current = false
      navigate('/cms/console/articles', {
        replace: true,
        state: {
          notice: `${response.postprocess_job.job_name} を受け付けました。保存後処理はバックグラウンドで続行します。`,
        },
      })
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function submitPublishRequest(): Promise<void> {
    if (article === null) {
      setErrorMessage('保存済み記事でのみ公開申請できます。')
      return
    }

    setSubmittingPublishRequest(true)
    setErrorMessage('')
    setMessage('')
    try {
      await apiRequest(`/cms/articles/${article.id}/publish-requests`, {
        method: 'POST',
        body: {},
      })
      setMessage('公開申請を送信しました。')
    } catch (error) {
      setErrorMessage(toApiMessage(error))
    } finally {
      setSubmittingPublishRequest(false)
    }
  }

  if (loading) {
    return (
      <div className="console-dashboard">
        <div className="console-card">
          <div className="console-placeholder">記事編集画面を読み込んでいます。</div>
        </div>
      </div>
    )
  }

  const previewThumbnailPath = thumbnailPreviewPath !== ''
    ? thumbnailPreviewPath
    : (thumbnailMode === 'keep_current' ? currentThumbnailAsset?.public_path ?? '' : '')

  return (
    <div className="console-dashboard cms-article-editor-page">
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <div className="console-card">
        <div className="console-card-header">
          <h2>{isCreate ? '記事作成' : '記事編集'}</h2>
          <p>Jodit で本文を編集し、保存時に画像処理ジョブと OGP 取得を起動します。</p>
        </div>
        <div className="console-actions console-actions-spread">
          <div className="console-actions">
            <Link className="console-secondary" to="/cms/console/articles">
              一覧へ戻る
            </Link>
            {!isCreate && (
              <button
                type="button"
                className="console-secondary"
                onClick={() => void submitPublishRequest()}
                disabled={submittingPublishRequest}
              >
                {submittingPublishRequest ? '申請中...' : '公開申請'}
              </button>
            )}
          </div>
          <div className="console-static-value">
            ロック有効期限: {formatCmsDate(lockExpiresAt)}
          </div>
        </div>
      </div>

      <div className="console-card">
        <div className="console-form-grid cms-article-editor-grid">
          <div className="cms-article-category-panel">
            <div className="console-card-header">
              <h2>カテゴリ</h2>
              <p>親子関係を見ながら保存先カテゴリを選択します。</p>
            </div>
            {categories.length === 0 ? (
              <div className="console-placeholder">カテゴリがまだありません。先にカテゴリ管理で作成してください。</div>
            ) : (
              <CmsCategoryVisualPicker
                items={categories}
                selectedId={form.categoryId}
                onSelect={(categoryId) =>
                  setForm((prev) => ({ ...prev, categoryId }))
                }
              />
            )}
          </div>

          <label className="console-label">
            公開状態
            <select
              className="console-select"
              value={form.status}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  status: event.target.value as ArticleFormState['status'],
                }))
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="console-label cms-article-editor-title">
            タイトル
            <input
              className="console-input"
              type="text"
              value={form.title}
              onChange={(event) => {
                const nextTitle = event.target.value
                setForm((prev) => ({ ...prev, title: nextTitle }))
                if (thumbnailTitleText.trim() === '' || thumbnailTitleText === form.title) {
                  setThumbnailTitleText(nextTitle)
                }
              }}
              maxLength={255}
            />
          </label>

          <label className="console-label cms-article-editor-summary">
            要約
            <textarea
              className="console-textarea"
              value={form.summary}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, summary: event.target.value }))
              }
              maxLength={200}
            />
          </label>

          <label className="console-label">
            Twitter Card
            <select
              className="console-select"
              value={form.twitterCard}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  twitterCard: event.target.value as CmsTwitterCard,
                }))
              }
            >
              <option value="summary">summary</option>
              <option value="summary_large_image">summary_large_image</option>
            </select>
          </label>

          <div className="console-label">
            記事オプション
            <div className="cms-article-option-grid">
              <label className="console-inline-label">
                <input
                  type="checkbox"
                  checked={form.isPr}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isPr: event.target.checked }))
                  }
                />
                PR
              </label>
              <label className="console-inline-label">
                <input
                  type="checkbox"
                  checked={form.isAd}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isAd: event.target.checked }))
                  }
                />
                AD
              </label>
            </div>
          </div>
        </div>

        <div className="cms-article-tag-box">
          <strong>タグ</strong>
          <div className="cms-article-tag-list">
            {form.tagIds.length === 0 ? (
              <span>タグは未設定です。</span>
            ) : (
              form.tagIds.map((tagId) => (
                <span key={tagId} className="cms-tag-chip">
                  {tagId}
                </span>
              ))
            )}
          </div>
          <p className="cms-article-help-text">
            タグ一覧 API が未実装のため、この画面では既存タグの保持のみを行います。
          </p>
        </div>
      </div>

      <div className="console-card">
        <div className="console-card-header">
          <h2>サムネイル</h2>
          <p>保持、固定画像、タイトル生成、アップロード画像のいずれかで保存します。</p>
        </div>
        <div className="console-form-grid cms-thumbnail-grid">
          <label className="console-label">
            モード
            <select
              className="console-select"
              value={thumbnailMode}
              onChange={(event) =>
                setThumbnailMode(event.target.value as InternalThumbnailMode)
              }
            >
              {!isCreate && currentThumbnailAsset !== null && (
                <option value="keep_current">現在のサムネイルを維持</option>
              )}
              <option value="use_default">固定デフォルト画像</option>
              <option value="generate_from_title">タイトルから生成</option>
              <option value="use_uploaded">画像をアップロード</option>
            </select>
          </label>

          {thumbnailMode === 'generate_from_title' && (
            <label className="console-label">
              生成文字列
              <input
                className="console-input"
                type="text"
                value={thumbnailTitleText}
                onChange={(event) => setThumbnailTitleText(event.target.value)}
              />
            </label>
          )}

          {thumbnailMode === 'use_uploaded' && (
            <label className="console-label">
              サムネイル画像
              <input
                className="console-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  if (file === null) {
                    return
                  }
                  void uploadTempImage(file)
                    .then((payload) => {
                      setThumbnailUploadFileName(payload.file_name)
                      setThumbnailPreviewPath(payload.path)
                    })
                    .catch((error) => {
                      setErrorMessage(toApiMessage(error))
                    })
                }}
              />
            </label>
          )}
        </div>

        {previewThumbnailPath !== '' && (
          <div className="cms-thumbnail-preview-wrap">
            <img className="cms-thumbnail-preview" src={previewThumbnailPath} alt="thumbnail preview" />
          </div>
        )}
      </div>

      <div className="console-card">
        <div className="console-card-header">
          <h2>本文</h2>
          <p>画像アップロードは Jodit から直接行えます。保存前に本文を確定してください。</p>
        </div>
        <JoditEditor
          value={form.bodyHtml}
          config={{
            readonly: false,
            language: 'ja',
            height: 680,
            toolbarSticky: false,
            buttons: [
              'source',
              '|',
              'bold',
              'italic',
              'underline',
              'strikethrough',
              '|',
              'ul',
              'ol',
              '|',
              'font',
              'fontsize',
              'brush',
              'paragraph',
              '|',
              'image',
              'link',
              'table',
              '|',
              'align',
              'undo',
              'redo',
              '|',
              'hr',
              'eraser',
              'fullsize',
            ],
            uploader: {
              insertImageAsBase64URI: false,
              imagesExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
              headers: {
                'Cf-Access-Jwt-Assertion': getStoredAccessJwt(),
              },
              processFileName(this: unknown, key: string, file: File): [string, File, string] {
                const renamed = renameFileWithUuid(file)
                return [key, renamed, renamed.name]
              },
              customUploadFunction: async (
                requestData: FormData | Record<string, unknown> | string,
                showProgress: (progress: number) => void,
              ) => {
                if (!(requestData instanceof FormData)) {
                  throw new Error('画像アップロードデータの形式が不正です。')
                }

                const files: File[] = []
                for (const value of requestData.values()) {
                  if (value instanceof File) {
                    files.push(value)
                  }
                }

                const uploadedPaths: string[] = []
                for (const file of files) {
                  const uploaded = await uploadTempImage(file)
                  uploadedPaths.push(uploaded.path)
                  setUploadedImageOptions((prev) => ({
                    ...prev,
                    [uploaded.file_name]: DEFAULT_IMAGE_OPTIONS,
                  }))
                }

                showProgress(100)
                return {
                  success: true,
                  time: new Date().toISOString(),
                  data: {
                    baseurl: '',
                    files: uploadedPaths,
                    isImages: uploadedPaths.map(() => true),
                  },
                }
              },
            },
          }}
          onBlur={(nextContent) => setForm((prev) => ({ ...prev, bodyHtml: nextContent }))}
          onChange={() => undefined}
        />

        <div className="cms-article-editor-footer">
          <div className="console-static-value">
            文字数: {form.bodyHtml.replace(/<[^>]+>/g, '').trim().length}
          </div>
          <div className="console-actions">
            <button
              type="button"
              className="console-primary"
              onClick={() => void saveArticle()}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>

      {article !== null && (
        <div className="console-card">
          <div className="console-card-header">
            <h2>現在の状態</h2>
            <p>記事 ID、更新日時、画像後処理状態を確認できます。</p>
          </div>
          <div className="cms-article-meta-grid">
            <div>
              <strong>記事ID</strong>
              <span>{article.id}</span>
            </div>
            <div>
              <strong>スラッグ</strong>
              <span>{article.slug}</span>
            </div>
            <div>
              <strong>更新日時</strong>
              <span>{formatCmsDate(article.updated_at)}</span>
            </div>
            <div>
              <strong>画像処理</strong>
              <span>{article.image_job_status}</span>
            </div>
          </div>
          <div className="cms-article-help-text">
            保存後は編集ロックがバックグラウンドジョブ側で解放されます。続けて編集する場合は一覧から再度開いてください。
          </div>
        </div>
      )}
    </div>
  )
}
