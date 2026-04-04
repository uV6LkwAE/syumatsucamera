import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import JoditEditor from 'jodit-react'
import 'jodit/es2021/jodit.min.css'
import { apiRequest, getStoredAccessJwt } from '../../../api/client'
import ConsoleNotice from '../../../components/ConsoleNotice'
import ConsoleDropdown from '../../../components/ConsoleDropdown'
import CmsTabGuide from '../../../components/CmsTabGuide'
import CmsCategoryVisualPicker from '../components/CmsCategoryVisualPicker'
import {
  normalizeStoredArticleHtml,
  resolveDeleteImageIds,
  toApiMessage,
  collectTempImageFileNames,
} from '../helpers'
import type {
  CmsArticleDetail,
  CmsArticleMediaAsset,
  CmsArticleMutationResponse,
  CmsArticleOptionItem,
  CmsArticleOptionListResponse,
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
  selectedOptionIds: string[]
  customOptionLabels: string[]
  tagIds: string[]
}

type ArticleEditorBootstrapPayload = {
  categories: CmsCategoryTreeResponse['items']
  optionCatalog: CmsArticleOptionItem[]
  session: CmsArticleSessionResponse
  article: CmsArticleDetail | null
}

type ArticleEditorBootstrapCacheEntry = {
  consumers: number
  lockToken: string
  promise: Promise<ArticleEditorBootstrapPayload>
}

const ARTICLE_TITLE_MAX_LENGTH = 255
const ARTICLE_SUMMARY_MAX_LENGTH = 200
const ARTICLE_CUSTOM_OPTION_MAX_LENGTH = 100

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
  selectedOptionIds: [],
  customOptionLabels: [],
  tagIds: [],
}

const SESSION_REFRESH_INTERVAL_MS = 120_000

const TWITTER_CARD_OPTIONS: Array<{
  value: CmsTwitterCard
  label: string
}> = [
  {
    value: 'summary_large_image',
    label: 'summary_large_image',
  },
  {
    value: 'summary',
    label: 'summary',
  },
]

const articleEditorBootstrapCache = new Map<string, ArticleEditorBootstrapCacheEntry>()

function buildArticleEditorBootstrapKey(isCreate: boolean, articleId: string | undefined): string {
  if (isCreate) {
    return 'new'
  }
  return `article:${articleId ?? ''}`
}

async function fetchArticleEditorBootstrap(
  isCreate: boolean,
  articleId: string | undefined,
): Promise<ArticleEditorBootstrapPayload> {
  const [categoryPayload, optionPayload, sessionPayload] = await Promise.all([
    apiRequest<CmsCategoryTreeResponse>('/cms/categories?limit=200'),
    apiRequest<CmsArticleOptionListResponse>('/cms/article-options'),
    apiRequest<CmsArticleSessionResponse>('/cms/article-sessions', {
      method: 'POST',
      body: isCreate ? {} : { article_id: articleId },
    }),
  ])

  let article: CmsArticleDetail | null = null
  if (!isCreate && articleId !== undefined) {
    article = await apiRequest<CmsArticleDetail>(`/cms/articles/${articleId}`)
  }

  return {
    categories: categoryPayload.items,
    optionCatalog: optionPayload.items,
    session: sessionPayload,
    article,
  }
}

function getArticleEditorBootstrapEntry(
  isCreate: boolean,
  articleId: string | undefined,
): {
  cacheKey: string
  entry: ArticleEditorBootstrapCacheEntry
} {
  const cacheKey = buildArticleEditorBootstrapKey(isCreate, articleId)
  const existingEntry = articleEditorBootstrapCache.get(cacheKey)
  if (existingEntry !== undefined) {
    return {
      cacheKey,
      entry: existingEntry,
    }
  }

  const entry: ArticleEditorBootstrapCacheEntry = {
    consumers: 0,
    lockToken: '',
    promise: Promise.resolve()
      .then(() => fetchArticleEditorBootstrap(isCreate, articleId))
      .then((payload) => {
        const currentEntry = articleEditorBootstrapCache.get(cacheKey)
        if (currentEntry === entry) {
          currentEntry.lockToken = payload.session.lock_token
          if (currentEntry.consumers === 0) {
            void apiRequest(`/cms/article-sessions/${payload.session.lock_token}`, {
              method: 'DELETE',
            })
              .catch(() => undefined)
              .finally(() => {
                if (articleEditorBootstrapCache.get(cacheKey) === currentEntry) {
                  articleEditorBootstrapCache.delete(cacheKey)
                }
              })
          }
        }
        return payload
      })
      .catch((error) => {
        if (articleEditorBootstrapCache.get(cacheKey) === entry) {
          articleEditorBootstrapCache.delete(cacheKey)
        }
        throw error
      }),
  }

  articleEditorBootstrapCache.set(cacheKey, entry)
  return {
    cacheKey,
    entry,
  }
}

function releaseArticleEditorBootstrapEntry(
  cacheKey: string,
  releaseSessionOnLeave: boolean,
  lockToken: string,
): void {
  const entry = articleEditorBootstrapCache.get(cacheKey)
  if (entry === undefined) {
    return
  }

  entry.consumers = Math.max(0, entry.consumers - 1)
  if (entry.consumers > 0) {
    return
  }

  if (!releaseSessionOnLeave) {
    articleEditorBootstrapCache.delete(cacheKey)
    return
  }

  const effectiveLockToken = lockToken.trim() !== '' ? lockToken : entry.lockToken
  if (effectiveLockToken === '') {
    return
  }

  articleEditorBootstrapCache.delete(cacheKey)
  void apiRequest(`/cms/article-sessions/${effectiveLockToken}`, {
    method: 'DELETE',
  }).catch(() => undefined)
}

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

function CmsTwitterCardPreview({ mode }: { mode: CmsTwitterCard }) {
  if (mode === 'summary_large_image') {
    return (
      <svg
        viewBox="0 0 320 200"
        className="cms-twitter-card-preview-svg"
        aria-hidden="true"
      >
        <rect x="12" y="12" width="296" height="176" rx="20" fill="#ffffff" stroke="#cdd8e6" />
        <rect x="28" y="28" width="264" height="96" rx="14" fill="#dbe9fb" />
        <rect x="42" y="44" width="84" height="12" rx="6" fill="#8fb4e7" />
        <rect x="42" y="64" width="116" height="10" rx="5" fill="#aac6ec" />
        <rect x="28" y="140" width="188" height="14" rx="7" fill="#264f87" opacity="0.95" />
        <rect x="28" y="162" width="144" height="10" rx="5" fill="#8b9bb1" />
        <circle cx="270" cy="156" r="16" fill="#edf4fc" />
        <path d="M264 156h12M270 150v12" stroke="#4a79b5" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 320 200"
      className="cms-twitter-card-preview-svg"
      aria-hidden="true"
    >
      <rect x="12" y="12" width="296" height="176" rx="20" fill="#ffffff" stroke="#cdd8e6" />
      <rect x="28" y="36" width="96" height="96" rx="16" fill="#dbe9fb" />
      <rect x="42" y="52" width="52" height="10" rx="5" fill="#8fb4e7" />
      <rect x="42" y="70" width="68" height="10" rx="5" fill="#aac6ec" />
      <rect x="144" y="42" width="118" height="14" rx="7" fill="#264f87" opacity="0.95" />
      <rect x="144" y="68" width="132" height="10" rx="5" fill="#8b9bb1" />
      <rect x="144" y="88" width="118" height="10" rx="5" fill="#9fb0c6" />
      <rect x="144" y="116" width="88" height="24" rx="12" fill="#edf4fc" />
      <circle cx="162" cy="128" r="6" fill="#4a79b5" />
      <rect x="174" y="122" width="42" height="12" rx="6" fill="#4a79b5" opacity="0.92" />
    </svg>
  )
}

type CmsArticleEditorPageProps = {
  embedded?: boolean
}

export default function CmsArticleEditorPage({
  embedded = false,
}: CmsArticleEditorPageProps) {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const { sessionUser } = useOutletContext<CmsOutletContext>()
  const isCreate = articleId === undefined

  const releaseSessionOnLeaveRef = useRef(true)
  const sessionRefreshTimerRef = useRef<number | null>(null)
  const lockTokenRef = useRef('')
  const bootstrapCacheKeyRef = useRef('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submittingPublishRequest, setSubmittingPublishRequest] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const [lockToken, setLockToken] = useState('')
  const [lockExpiresAt, setLockExpiresAt] = useState('')
  const [categories, setCategories] = useState<CmsCategoryTreeResponse['items']>([])
  const [optionCatalog, setOptionCatalog] = useState<CmsArticleOptionItem[]>([])
  const [article, setArticle] = useState<CmsArticleDetail | null>(null)
  const [initialMediaAssets, setInitialMediaAssets] = useState<CmsArticleMediaAsset[]>([])
  const [currentThumbnailAsset, setCurrentThumbnailAsset] = useState<CmsArticleMediaAsset | null>(null)

  const [form, setForm] = useState<ArticleFormState>(DEFAULT_ARTICLE_FORM)
  const [uploadedImageOptions, setUploadedImageOptions] = useState<Record<string, ImageProcessingOptions>>({})

  const [thumbnailMode, setThumbnailMode] = useState<InternalThumbnailMode>('generate_from_title')
  const [thumbnailUploadFileName, setThumbnailUploadFileName] = useState('')
  const [thumbnailPreviewPath, setThumbnailPreviewPath] = useState('')
  const [customOptionDraft, setCustomOptionDraft] = useState('')

  const statusOptions = toStatusOptions(sessionUser?.role, form.status)

  useEffect(() => {
    let active = true
    const { cacheKey, entry } = getArticleEditorBootstrapEntry(isCreate, articleId)
    bootstrapCacheKeyRef.current = cacheKey
    entry.consumers += 1

    async function bootstrap(): Promise<void> {
      setLoading(true)
      setErrorMessage('')
      try {
        const payload = await entry.promise

        if (!active) {
          return
        }

        setCategories(payload.categories)
        setOptionCatalog(payload.optionCatalog)
        setLockToken(payload.session.lock_token)
        setLockExpiresAt(payload.session.lock_expires_at)

        if (payload.article !== null) {
          const thumbnailAsset = findCurrentThumbnail(payload.article.media_assets)
          setArticle(payload.article)
          setInitialMediaAssets(payload.article.media_assets)
          setCurrentThumbnailAsset(thumbnailAsset)
          setForm({
            categoryId: payload.article.category_id,
            title: payload.article.title,
            summary: payload.article.summary,
            bodyHtml: normalizeStoredArticleHtml(payload.article.body_html),
            status: payload.article.status,
            twitterCard: payload.article.twitter_card,
            isPr: payload.article.article_option.is_pr,
            isAd: payload.article.article_option.is_ad,
            selectedOptionIds: payload.article.article_option.items
              .filter((item) => !item.is_system)
              .map((item) => item.id),
            customOptionLabels: [],
            tagIds: payload.article.tags.map((tag) => tag.id),
          })
          setThumbnailMode(thumbnailAsset === null ? 'generate_from_title' : 'keep_current')
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath(thumbnailAsset?.public_path ?? '')
        } else {
          setArticle(null)
          setInitialMediaAssets([])
          setCurrentThumbnailAsset(null)
          setForm(DEFAULT_ARTICLE_FORM)
          setThumbnailMode('generate_from_title')
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath('')
          setCustomOptionDraft('')
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
      releaseArticleEditorBootstrapEntry(
        cacheKey,
        releaseSessionOnLeaveRef.current,
        lockTokenRef.current,
      )
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
        title_text: form.title.trim(),
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
          selected_option_ids: form.selectedOptionIds,
          custom_option_labels: form.customOptionLabels,
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
          saveLogLockToken: lockToken,
          saveLogArticleTitle: response.article.title,
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
    if (embedded) {
      return <div className="cms-tab-embedded cms-article-editor-page console-loading-shell" aria-hidden="true" />
    }

    return <div className="console-dashboard cms-article-editor-page console-loading-shell" aria-hidden="true" />
  }

  const previewThumbnailPath = thumbnailPreviewPath !== ''
    ? thumbnailPreviewPath
    : (thumbnailMode === 'keep_current' ? currentThumbnailAsset?.public_path ?? '' : '')
  const canSubmitPublishRequest = (
    article !== null
    && sessionUser?.role === 'author'
    && article.status !== 'publish'
  )

  const selectableCustomOptions = optionCatalog.filter((option) => !option.is_system)

  function toggleExistingOption(optionId: string): void {
    setForm((prev) => {
      if (prev.selectedOptionIds.includes(optionId)) {
        return {
          ...prev,
          selectedOptionIds: prev.selectedOptionIds.filter((id) => id !== optionId),
        }
      }
      return {
        ...prev,
        selectedOptionIds: [...prev.selectedOptionIds, optionId],
      }
    })
  }

  function addCustomOptionLabel(): void {
    const normalizedLabel = customOptionDraft.trim()
    if (normalizedLabel === '') {
      return
    }
    if (normalizedLabel.length > ARTICLE_CUSTOM_OPTION_MAX_LENGTH) {
      setErrorMessage(`記事オプション名は${ARTICLE_CUSTOM_OPTION_MAX_LENGTH}文字以内で入力してください。`)
      return
    }

    const existingOption = optionCatalog.find(
      (option) => option.label.trim().toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase(),
    )
    if (existingOption !== undefined) {
      setForm((prev) => ({
        ...prev,
        selectedOptionIds: prev.selectedOptionIds.includes(existingOption.id)
          ? prev.selectedOptionIds
          : [...prev.selectedOptionIds, existingOption.id],
      }))
      setCustomOptionDraft('')
      return
    }

    setForm((prev) => {
      const alreadyAdded = prev.customOptionLabels.some(
        (label) => label.toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase(),
      )
      if (alreadyAdded) {
        return prev
      }
      return {
        ...prev,
        customOptionLabels: [...prev.customOptionLabels, normalizedLabel],
      }
    })
    setCustomOptionDraft('')
    setErrorMessage('')
  }

  const content = (
    <>
      <ConsoleNotice message={message} onClose={() => setMessage('')} />
      {errorMessage !== '' && <div className="console-error">{errorMessage}</div>}

      <div className="console-card">
        <CmsTabGuide
          title="サムネイル"
          helpLines={[
            '以下からサムネイルを設定できます。',
            '1. 固定デフォルト画像',
            '2. タイトルから生成',
            '3. オリジナル画像をアップロード',
          ]}
          compact
          showDivider={false}
        />
        <div className="console-form-grid row g-3 cms-thumbnail-grid">
          <label className="console-label col-12 col-lg-6">
            モード
            <ConsoleDropdown
              value={thumbnailMode}
              options={[
                ...(!isCreate && currentThumbnailAsset !== null
                  ? [{ value: 'keep_current' as const, label: '現在のサムネイルを維持' }]
                  : []),
                { value: 'use_default' as const, label: '固定デフォルト画像' },
                { value: 'generate_from_title' as const, label: 'タイトルから生成' },
                { value: 'use_uploaded' as const, label: '画像をアップロード' },
              ]}
              onChange={(nextValue) =>
                setThumbnailMode(nextValue as InternalThumbnailMode)
              }
            />
          </label>

          {thumbnailMode === 'use_uploaded' && (
            <label className="console-label col-12 col-lg-6">
              サムネイル画像
              <input
                className="console-input form-control"
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
        <CmsTabGuide
          title="タイトル"
          helpLines={[
            '興味を引くタイトルを設定しましょう。',
            '特殊文字は使用しないでください。',
          ]}
          compact
          showDivider={false}
        />
        <label className="console-label cms-article-editor-title">
          <span className="cms-article-field-head">
            <span>タイトル</span>
            <span className="cms-article-field-counter">
              {form.title.length}/{ARTICLE_TITLE_MAX_LENGTH}
            </span>
          </span>
          <input
            className="console-input form-control"
            type="text"
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            maxLength={ARTICLE_TITLE_MAX_LENGTH}
          />
        </label>
      </div>

      <div className="console-card">
        <CmsTabGuide
          title="サマリー"
          helpLines={[
            'Googleなどの検索エンジンで表示される要約文です。',
            '120字ほどが適切です。',
          ]}
          compact
          showDivider={false}
        />
        <label className="console-label cms-article-editor-summary">
          <span className="cms-article-field-head">
            <span>サマリー</span>
            <span className="cms-article-field-counter">
              {form.summary.length}/{ARTICLE_SUMMARY_MAX_LENGTH}
            </span>
          </span>
          <textarea
            className="console-textarea form-control"
            value={form.summary}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, summary: event.target.value }))
            }
            maxLength={ARTICLE_SUMMARY_MAX_LENGTH}
          />
        </label>
      </div>

      <div className="console-card">
        <CmsTabGuide
          title="カテゴリー"
          helpLines={[
            '該当するカテゴリーを選択してください。',
            '複数選択はできません。',
            'カテゴリーの作成, 編集, 削除はカテゴリータブから操作してください。',
          ]}
          compact
          showDivider={false}
        />
        <div className="cms-article-category-panel">
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
      </div>

      <div className="console-card">
        <CmsTabGuide
          title="TwitterCard"
          helpLines={[
            'Xのサムネイルの表示方法を選択できます。',
            'サムネイルを大きく見せたい場合、summary_large_imageを選択してください。'
          ]}
          compact
          showDivider={false}
        />
        <fieldset className="cms-twitter-card-grid row g-3">
          <legend className="visually-hidden">TwitterCard</legend>
          {TWITTER_CARD_OPTIONS.map((option) => {
            const inputId = `cms-twitter-card-${option.value}`
            const isSelected = form.twitterCard === option.value

            return (
              <div key={option.value} className="col-12 col-lg-6">
                <label
                  className={`cms-twitter-card-option${
                    isSelected ? ' is-selected' : ''
                  }`}
                  htmlFor={inputId}
                >
                  <div className="cms-twitter-card-preview">
                    <CmsTwitterCardPreview mode={option.value} />
                  </div>
                  <div className="cms-twitter-card-radio-row">
                    <input
                      id={inputId}
                      type="radio"
                      name="twitter_card"
                      value={option.value}
                      checked={isSelected}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          twitterCard: event.target.value as CmsTwitterCard,
                        }))
                      }
                    />
                    <span>{option.label}</span>
                  </div>
                </label>
              </div>
            )
          })}
        </fieldset>
      </div>

      <div className="console-card">
        <CmsTabGuide title="公開状態" helpLines={[]} compact showDivider={false} />
        <div className="console-form-grid row g-3">
          <label className="console-label col-12">
            公開状態
            <ConsoleDropdown
              value={form.status}
              options={statusOptions}
              onChange={(nextValue) =>
                setForm((prev) => ({
                  ...prev,
                  status: nextValue as ArticleFormState['status'],
                }))
              }
            />
          </label>
        </div>
      </div>

      <div className="console-card">
        <CmsTabGuide
          title="記事オプション"
          helpLines={[
            '既存のオプションを選択するか、自身で作成できます。',
            '記事内にAmazonアフィリエイトリンクを挿入する場合はADを必ず選択してください。',
            'メーカーより提供がある製品をレビューする場合PRを必ず選択してください。',
          ]}
          compact
          showDivider={false}
        />
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
        {selectableCustomOptions.length > 0 && (
          <div className="cms-article-existing-options">
            {selectableCustomOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`cms-article-option-chip${
                  form.selectedOptionIds.includes(option.id) ? ' is-selected' : ''
                }`}
                onClick={() => toggleExistingOption(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="console-form-grid row g-3 cms-article-custom-option-row">
          <label className="console-label col-12 col-lg">
            <span className="cms-article-field-head">
              <span>オプションを追加</span>
              <span className="cms-article-field-counter">
                {customOptionDraft.length}/{ARTICLE_CUSTOM_OPTION_MAX_LENGTH}
              </span>
            </span>
            <input
              className="console-input form-control"
              type="text"
              value={customOptionDraft}
              onChange={(event) => setCustomOptionDraft(event.target.value)}
              maxLength={ARTICLE_CUSTOM_OPTION_MAX_LENGTH}
              placeholder="例: スポンサー提供"
            />
          </label>
          <div className="col-12 col-lg-auto d-flex align-items-end">
            <button
              type="button"
              className="console-secondary"
              onClick={addCustomOptionLabel}
            >
              追加
            </button>
          </div>
        </div>
        {form.customOptionLabels.length > 0 && (
          <div className="cms-article-custom-option-list">
            {form.customOptionLabels.map((label) => (
              <button
                key={label}
                type="button"
                className="cms-article-option-chip is-selected"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    customOptionLabels: prev.customOptionLabels.filter((item) => item !== label),
                  }))
                }
              >
                {label}
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="console-card">
        <CmsTabGuide title="本文" helpLines={[]} compact showDivider={false} />
        <JoditEditor
          value={form.bodyHtml}
          config={{
            readonly: false,
            language: 'ja',
            height: 680,
            toolbarSticky: false,
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

        <div className="cms-article-editor-footer d-flex justify-content-end">
          <div className="console-actions d-flex flex-wrap justify-content-end">
            {canSubmitPublishRequest && (
              <button
                type="button"
                className="console-secondary"
                onClick={() => void submitPublishRequest()}
                disabled={submittingPublishRequest}
              >
                {submittingPublishRequest ? '申請中...' : '公開申請'}
              </button>
            )}
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
    </>
  )

  if (embedded) {
    return <div className="cms-tab-embedded cms-article-editor-page">{content}</div>
  }

  return (
    <div className="console-dashboard cms-article-editor-page">
      {content}
    </div>
  )
}
