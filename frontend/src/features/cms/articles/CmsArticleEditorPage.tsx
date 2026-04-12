import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
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
  extractMediaFileName,
  replaceImageSourceInHtml,
} from '../helpers'
import type {
  CmsArticleDetail,
  CmsArticleMediaAsset,
  CmsArticleMutationResponse,
  CmsArticleOptionItem,
  CmsArticleOptionListResponse,
  CmsArticleSessionResponse,
  CmsCategoryTreeResponse,
  CmsImageProcessingOptions,
  CmsImageUploadResponse,
  CmsTagSuggestion,
  CmsTagSuggestionListResponse,
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

type ImageProcessingOptions = CmsImageProcessingOptions

type JoditEditorInstance = {
  value: string
  s?: {
    focus?: (options?: FocusOptions) => boolean
    insertCursorAtPoint?: (x: number, y: number) => boolean
    insertImage?: (
      url: string,
      styles?: Record<string, string> | null,
      defaultWidth?: number | string | null,
    ) => void
  }
  e?: {
    fire?: (eventName: string, ...args: unknown[]) => void
  }
}

type BrowserCaretPosition = {
  offsetNode: Node
  offset: number
}

type ImageSelectionMode = 'hover' | 'pinned' | null

type ImageOverlayPosition = {
  top: number
  left: number
  width: number
}

type ArticleFormState = {
  categoryId: string
  title: string
  summary: string
  bodyHtml: string
  status: 'draft' | 'publish' | 'private'
  twitterCard: CmsTwitterCard
  selectedOptionIds: string[]
  tagNames: string[]
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
const ARTICLE_TAG_MAX_LENGTH = 100
const ARTICLE_TAG_MAX_COUNT = 5
const ARTICLE_TAG_SUGGESTION_LIMIT = 8
const ARTICLE_TAG_SUGGESTION_DEBOUNCE_MS = 180
const ARTICLE_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'gif'] as const
const ARTICLE_IMAGE_ACCEPT = 'image/jpeg,image/gif'
const ARTICLE_IMAGE_ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/gif'])

const DEFAULT_IMAGE_OPTIONS: ImageProcessingOptions = {
  exif_watermark: false,
  site_logo_watermark: false,
}

const DEFAULT_ARTICLE_FORM: ArticleFormState = {
  categoryId: '',
  title: '',
  summary: '',
  bodyHtml: '<p></p>',
  status: 'draft',
  twitterCard: 'summary_large_image',
  selectedOptionIds: [],
  tagNames: [],
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
  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }
  if (mimeType === 'image/gif') {
    return 'gif'
  }
  if (ARTICLE_IMAGE_EXTENSIONS.some((extension) => extension === fromName)) {
    return fromName
  }
  return 'jpg'
}

function isAllowedArticleImageFile(file: File): boolean {
  if (file.type !== '') {
    return ARTICLE_IMAGE_ALLOWED_MIME_TYPES.has(file.type)
  }

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ARTICLE_IMAGE_EXTENSIONS.some((allowedExtension) => allowedExtension === extension)
}

function renameFileWithUuid(file: File): File {
  return new File([file], createUuidFileName(file.name, file.type), {
    type: file.type,
    lastModified: file.lastModified,
  })
}

function getDroppedFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files)
}

function hasDroppedFiles(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files.length > 0) {
    return true
  }
  return Array.from(dataTransfer.items).some((item) => item.kind === 'file')
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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

function findAssetByFileName(
  assets: CmsArticleMediaAsset[],
  fileName: string,
): CmsArticleMediaAsset | null {
  return assets.find((asset) => asset.file_name === fileName) ?? null
}

function buildOriginalMediaPath(originalFilePath: string): string {
  const trimmed = originalFilePath.trim()
  if (trimmed === '') {
    return ''
  }
  if (trimmed.startsWith('/media/')) {
    return trimmed
  }
  return `/media/${trimmed}`
}

function normalizeTagNameForCompare(value: string): string {
  return value.trim().toLocaleLowerCase()
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
  const tagInputId = useId()

  const releaseSessionOnLeaveRef = useRef(true)
  const sessionRefreshTimerRef = useRef<number | null>(null)
  const lockTokenRef = useRef('')
  const bootstrapCacheKeyRef = useRef('')
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const imageOptionPanelRef = useRef<HTMLDivElement | null>(null)
  const editorInstanceRef = useRef<JoditEditorInstance | null>(null)
  const editorSelectionRangeRef = useRef<Range | null>(null)
  const activeImageSelectionRef = useRef<{
    fileName: string
    source: string
    originalFilePath: string
    mode: ImageSelectionMode
  }>({
    fileName: '',
    source: '',
    originalFilePath: '',
    mode: null,
  })
  const activeImageSelectionVersionRef = useRef(0)
  const imageOptionUpdateInFlightRef = useRef(false)
  const imageOptionPanelHoveredRef = useRef(false)

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
  // jodit-react は value 変更のたびに内部の jodit.value を再同期するため、
  // 編集中の本文と保存用 state を分離してスクロール位置の巻き戻りを防ぐ。
  const [editorBodyHtml, setEditorBodyHtml] = useState(DEFAULT_ARTICLE_FORM.bodyHtml)
  const [uploadedImageOptions, setUploadedImageOptions] = useState<Record<string, ImageProcessingOptions>>({})
  const [uploadedImageOriginalPaths, setUploadedImageOriginalPaths] = useState<Record<string, string>>({})
  const uploadedImageOriginalPathsRef = useRef<Record<string, string>>({})
  const [selectedImageFileName, setSelectedImageFileName] = useState('')
  const [selectedImageSource, setSelectedImageSource] = useState('')
  const [imageOptionOverlayPosition, setImageOptionOverlayPosition] = useState<ImageOverlayPosition | null>(null)
  const [updatingImageOptions, setUpdatingImageOptions] = useState(false)

  const [thumbnailMode, setThumbnailMode] = useState<InternalThumbnailMode>('generate_from_title')
  const [thumbnailUploadFileName, setThumbnailUploadFileName] = useState('')
  const [defaultThumbnailPreviewPath, setDefaultThumbnailPreviewPath] = useState('')
  const [thumbnailPreviewPath, setThumbnailPreviewPath] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [tagSuggestions, setTagSuggestions] = useState<CmsTagSuggestion[]>([])
  const [tagSuggestionLoading, setTagSuggestionLoading] = useState(false)
  const [tagSuggestionError, setTagSuggestionError] = useState('')
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)

  const statusOptions = toStatusOptions(sessionUser?.role, form.status)
  function resolveCurrentImageOriginalFilePath(fileName: string): string {
    const fromState = uploadedImageOriginalPathsRef.current[fileName]
    if (fromState !== '') {
      if (fromState !== undefined) {
        return fromState
      }
    }
    if (activeImageSelectionRef.current.fileName === fileName) {
      return activeImageSelectionRef.current.originalFilePath
    }
    const fromInitialAssets = initialMediaAssets.find((asset) => asset.file_name === fileName)
    if (fromInitialAssets !== undefined) {
      return fromInitialAssets.original_file_path ?? ''
    }
    return ''
  }

  const handleEditorRef = useCallback((instance: JoditEditorInstance | null) => {
    editorInstanceRef.current = instance
  }, [])
  const handleEditorBlur = useCallback((nextContent: string) => {
    setForm((prev) => ({ ...prev, bodyHtml: nextContent }))
  }, [])

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
        setDefaultThumbnailPreviewPath(payload.session.default_thumbnail_preview_path)

        if (payload.article !== null) {
          const thumbnailAsset = findCurrentThumbnail(payload.article.media_assets)
          const assetOptionMap = payload.article.media_assets.reduce<Record<string, ImageProcessingOptions>>(
            (nextMap, asset) => {
              nextMap[asset.file_name] = asset.processing_options
              return nextMap
            },
            {},
          )
          const assetOriginalPathMap = payload.article.media_assets.reduce<Record<string, string>>(
            (nextMap, asset) => {
              nextMap[asset.file_name] = asset.original_file_path ?? ''
              return nextMap
            },
            {},
          )
          uploadedImageOriginalPathsRef.current = assetOriginalPathMap
          setArticle(payload.article)
          setInitialMediaAssets(payload.article.media_assets)
          setCurrentThumbnailAsset(thumbnailAsset)
          setEditorBodyHtml(normalizeStoredArticleHtml(payload.article.body_html))
          setForm({
            categoryId: payload.article.category_id,
            title: payload.article.title,
            summary: payload.article.summary,
            bodyHtml: normalizeStoredArticleHtml(payload.article.body_html),
            status: payload.article.status,
            twitterCard: payload.article.twitter_card,
            selectedOptionIds: payload.article.article_option.items.map((item) => item.id),
            tagNames: payload.article.tags.map((tag) => tag.name),
          })
          setUploadedImageOptions(assetOptionMap)
          setUploadedImageOriginalPaths(assetOriginalPathMap)
          setThumbnailMode(thumbnailAsset === null ? 'use_default' : 'keep_current')
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath(payload.article.thumbnail_preview_path)
          setTagDraft('')
          setTagSuggestions([])
          setTagSuggestionError('')
          setShowTagSuggestions(false)
          setSelectedImageFileName('')
          setSelectedImageSource('')
        } else {
          setArticle(null)
          setInitialMediaAssets([])
          setCurrentThumbnailAsset(null)
          setEditorBodyHtml(DEFAULT_ARTICLE_FORM.bodyHtml)
          setForm(DEFAULT_ARTICLE_FORM)
          setUploadedImageOptions({})
          setUploadedImageOriginalPaths({})
          uploadedImageOriginalPathsRef.current = {}
          setThumbnailMode('generate_from_title')
          setThumbnailUploadFileName('')
          setThumbnailPreviewPath(payload.session.default_thumbnail_preview_path)
          setTagDraft('')
          setTagSuggestions([])
          setTagSuggestionError('')
          setShowTagSuggestions(false)
          setSelectedImageFileName('')
          setSelectedImageSource('')
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

  useEffect(() => {
    const normalizedQuery = tagDraft.trim()
    if (normalizedQuery === '') {
      setTagSuggestions([])
      setTagSuggestionLoading(false)
      setTagSuggestionError('')
      return
    }

    let active = true
    const timerId = window.setTimeout(() => {
      const searchParams = new URLSearchParams({
        q: normalizedQuery,
        limit: String(ARTICLE_TAG_SUGGESTION_LIMIT),
      })
      setTagSuggestionLoading(true)
      setTagSuggestionError('')
      void apiRequest<CmsTagSuggestionListResponse>(`/cms/tags?${searchParams.toString()}`, {
        showLoading: false,
      })
        .then((payload) => {
          if (!active) {
            return
          }
          const selectedTagNames = new Set(form.tagNames.map(normalizeTagNameForCompare))
          setTagSuggestions(
            payload.items.filter(
              (item) => !selectedTagNames.has(normalizeTagNameForCompare(item.name)),
            ),
          )
        })
        .catch((error) => {
          if (active) {
            setTagSuggestions([])
            setTagSuggestionError(toApiMessage(error))
          }
        })
        .finally(() => {
          if (active) {
            setTagSuggestionLoading(false)
          }
        })
    }, ARTICLE_TAG_SUGGESTION_DEBOUNCE_MS)

    return () => {
      active = false
      window.clearTimeout(timerId)
    }
  }, [tagDraft, form.tagNames])

  async function uploadTempImage(file: File): Promise<CmsImageUploadResponse> {
    if (lockToken === '') {
      throw new Error('編集中セッションが確立されていません。')
    }
    if (!isAllowedArticleImageFile(file)) {
      throw new Error('アップロードできる画像形式は jpg/jpeg/gif のみです。')
    }

    const formData = new FormData()
    formData.append('lock_token', lockToken)
    formData.append('file', renameFileWithUuid(file))

    return apiRequest<CmsImageUploadResponse>('/cms/article-images', {
      method: 'POST',
      body: formData,
    })
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
      return {
        mode: 'keep_current',
      }
    }

    return {
      mode: 'use_default',
    }
  }

  function getCurrentEditorHtml(): string {
    return editorInstanceRef.current?.value ?? form.bodyHtml
  }

  function isImageOptionPanelElement(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement
      && imageOptionPanelRef.current !== null
      && imageOptionPanelRef.current.contains(target)
    )
  }

  function getEditorElement(): HTMLElement | null {
    return editorShellRef.current?.querySelector('.jodit-wysiwyg') ?? null
  }

  function getEditorWorkplaceElement(): HTMLElement | null {
    return editorShellRef.current?.querySelector('.jodit-workplace') ?? null
  }

  function getRangeContainer(range: Range): Node | null {
    const container = range.commonAncestorContainer
    if (container.nodeType === Node.ELEMENT_NODE) {
      return container
    }
    return container.parentNode
  }

  function isRangeInsideEditor(range: Range): boolean {
    const editorElement = getEditorElement()
    const rangeContainer = getRangeContainer(range)
    return (
      editorElement !== null
      && rangeContainer !== null
      && editorElement.contains(rangeContainer)
    )
  }

  function selectEditorRange(range: Range): boolean {
    if (!isRangeInsideEditor(range)) {
      return false
    }

    const selection = window.getSelection()
    if (selection === null) {
      return false
    }

    selection.removeAllRanges()
    selection.addRange(range)
    editorSelectionRangeRef.current = range.cloneRange()
    return true
  }

  function saveEditorSelection(): void {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) {
      return
    }

    const range = selection.getRangeAt(0)
    if (!isRangeInsideEditor(range)) {
      return
    }

    editorSelectionRangeRef.current = range.cloneRange()
  }

  function restoreEditorSelection(): boolean {
    const range = editorSelectionRangeRef.current
    if (range !== null) {
      try {
        if (selectEditorRange(range.cloneRange())) {
          return true
        }
      } catch {
        editorSelectionRangeRef.current = null
      }
    }

    return editorInstanceRef.current?.s?.focus?.({ preventScroll: true }) ?? false
  }

  function setActiveImageSelection(
    nextSelection: {
      fileName: string
      source: string
      originalFilePath: string
      mode: ImageSelectionMode
    },
  ): void {
    const currentSelection = activeImageSelectionRef.current
    if (
      currentSelection.fileName === nextSelection.fileName
      && currentSelection.source === nextSelection.source
      && currentSelection.originalFilePath === nextSelection.originalFilePath
      && currentSelection.mode === nextSelection.mode
    ) {
      return
    }

    activeImageSelectionVersionRef.current += 1
    activeImageSelectionRef.current = nextSelection
    setSelectedImageFileName(nextSelection.fileName)
    setSelectedImageSource(nextSelection.source)
  }

  function clearActiveImageSelection(): void {
    imageOptionPanelHoveredRef.current = false
    activeImageSelectionVersionRef.current += 1
    activeImageSelectionRef.current = {
      fileName: '',
      source: '',
      originalFilePath: '',
      mode: null,
    }
    setSelectedImageFileName('')
    setSelectedImageSource('')
    setImageOptionOverlayPosition(null)
  }

  function findEditorImageBySource(source: string): HTMLImageElement | null {
    const editorElement = getEditorElement()
    if (editorElement === null) {
      return null
    }

    const normalizedSource = source.trim()
    if (normalizedSource === '') {
      return null
    }

    const matchesSource = (candidate: string): boolean => {
      const normalizedCandidate = candidate.trim()
      if (normalizedCandidate === '') {
        return false
      }
      if (normalizedCandidate === normalizedSource) {
        return true
      }
      return (
        normalizedCandidate.endsWith(normalizedSource)
        || normalizedSource.endsWith(normalizedCandidate)
      )
    }

    return Array.from(editorElement.querySelectorAll('img')).find((image) => {
      const src = image.getAttribute('src') ?? ''
      const currentSrc = image.currentSrc ?? ''
      return matchesSource(src) || matchesSource(currentSrc)
    }) ?? null
  }

  function syncImageOptionOverlayPosition(): void {
    const { source } = activeImageSelectionRef.current
    const shell = editorShellRef.current
    const image = findEditorImageBySource(source)
    if (shell === null || image === null) {
      setImageOptionOverlayPosition(null)
      return
    }

    const shellRect = shell.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    const padding = 12
    const desiredWidth = Math.min(
      360,
      Math.max(220, imageRect.width - padding * 2),
      Math.max(220, shellRect.width - padding * 2),
    )
    const maxLeft = Math.max(padding, shellRect.width - desiredWidth - padding)
    const nextLeft = Math.min(
      Math.max(padding, imageRect.left - shellRect.left + padding),
      maxLeft,
    )

    setImageOptionOverlayPosition({
      top: Math.max(padding, imageRect.top - shellRect.top + padding),
      left: nextLeft,
      width: desiredWidth,
    })
  }

  function buildRangeAtPoint(x: number, y: number): Range | null {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => BrowserCaretPosition | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }

    const caretPosition = documentWithCaret.caretPositionFromPoint?.(x, y)
    if (caretPosition !== undefined && caretPosition !== null) {
      const range = document.createRange()
      range.setStart(caretPosition.offsetNode, caretPosition.offset)
      range.collapse(true)
      return range
    }

    return documentWithCaret.caretRangeFromPoint?.(x, y) ?? null
  }

  function setEditorCursorAtPoint(x: number, y: number): boolean {
    const inserted = editorInstanceRef.current?.s?.insertCursorAtPoint?.(x, y) ?? false
    if (inserted) {
      saveEditorSelection()
      return true
    }

    const range = buildRangeAtPoint(x, y)
    if (range === null) {
      return false
    }
    return selectEditorRange(range)
  }

  function selectImageBySource(source: string, mode: ImageSelectionMode): void {
    const fileName = extractMediaFileName(source)
    if (fileName === '') {
      clearActiveImageSelection()
      return
    }

    const originalFilePath = resolveCurrentImageOriginalFilePath(fileName)

    setActiveImageSelection({
      fileName,
      source,
      originalFilePath,
      mode,
    })
  }

  function insertUploadedImagePaths(
    imagePaths: string[],
    point?: { x: number; y: number },
  ): void {
    if (imagePaths.length === 0) {
      return
    }

    if (point !== undefined) {
      setEditorCursorAtPoint(point.x, point.y)
    } else {
      restoreEditorSelection()
    }

    const editor = editorInstanceRef.current
    for (const imagePath of imagePaths) {
      if (editor?.s?.insertImage !== undefined) {
        editor.s.insertImage(imagePath, null, null)
      } else {
        document.execCommand(
          'insertHTML',
          false,
          `<p><img src="${escapeHtmlAttribute(imagePath)}" alt="" /></p>`,
        )
      }
    }

    editor?.e?.fire?.('synchro')
    const nextBodyHtml = editor?.value ?? getEditorElement()?.innerHTML ?? form.bodyHtml
    setForm((prev) => ({
      ...prev,
      bodyHtml: nextBodyHtml,
    }))
    saveEditorSelection()
  }

  function isEditorDropTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    const editorElement = target.closest('.jodit-wysiwyg')
    return (
      editorElement !== null
      && editorShellRef.current !== null
      && editorShellRef.current.contains(editorElement)
    )
  }

  function getEditorImageTarget(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof HTMLElement) || isImageOptionPanelElement(target)) {
      return null
    }

    const selectedImage = target.closest('img')
    if (!(selectedImage instanceof HTMLImageElement)) {
      return null
    }

    const editorElement = selectedImage.closest('.jodit-wysiwyg')
    if (
      editorElement === null
      || editorShellRef.current === null
      || !editorShellRef.current.contains(editorElement)
    ) {
      return null
    }

    return selectedImage
  }

  function getEventClientPoint(event: Event): { x: number; y: number } | null {
    const pointerEvent = event as Event & {
      clientX?: unknown
      clientY?: unknown
      touches?: TouchList
      changedTouches?: TouchList
    }

    if (typeof pointerEvent.clientX === 'number' && typeof pointerEvent.clientY === 'number') {
      return {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      }
    }

    const touch = pointerEvent.touches?.[0] ?? pointerEvent.changedTouches?.[0]
    if (touch === undefined) {
      return null
    }
    return {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  function getEditorImageAtPoint(x: number, y: number): HTMLImageElement | null {
    const editorElement = getEditorElement()
    if (editorElement === null) {
      return null
    }

    for (const element of document.elementsFromPoint(x, y)) {
      const selectedImage = element instanceof HTMLImageElement
        ? element
        : element.closest('img')
      if (
        selectedImage instanceof HTMLImageElement
        && editorElement.contains(selectedImage)
      ) {
        return selectedImage
      }
    }

    const images = Array.from(editorElement.querySelectorAll('img'))
    return images.find((image) => {
      const rect = image.getBoundingClientRect()
      return (
        x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom
      )
    }) ?? null
  }

  function getEditorImageFromEvent(event: Event): HTMLImageElement | null {
    if (isImageOptionPanelElement(event.target)) {
      return null
    }

    const selectedImage = getEditorImageTarget(event.target)
    if (selectedImage !== null) {
      return selectedImage
    }

    const point = getEventClientPoint(event)
    if (point === null) {
      return null
    }
    return getEditorImageAtPoint(point.x, point.y)
  }

  async function uploadArticleImages(files: File[]): Promise<string[]> {
    if (files.some((file) => !isAllowedArticleImageFile(file))) {
      throw new Error('アップロードできる画像形式は jpg/jpeg/gif のみです。')
    }

    const uploadedPaths: string[] = []
    for (const file of files) {
      const uploaded = await uploadTempImage(file)
      uploadedPaths.push(uploaded.path)
      setUploadedImageOptions((prev) => ({
        ...prev,
        [uploaded.file_name]: DEFAULT_IMAGE_OPTIONS,
      }))
      setUploadedImageOriginalPaths((prev) => {
        const next = {
          ...prev,
          [uploaded.file_name]: prev[uploaded.file_name] ?? '',
        }
        uploadedImageOriginalPathsRef.current = next
        return next
      })
    }
    return uploadedPaths
  }

  function handleEditorDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    if (!isEditorDropTarget(event.target) || !hasDroppedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleEditorDrop(event: ReactDragEvent<HTMLDivElement>): void {
    if (!isEditorDropTarget(event.target) || !hasDroppedFiles(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const droppedFiles = getDroppedFiles(event.dataTransfer)
    const dropPoint = {
      x: event.clientX,
      y: event.clientY,
    }
    setEditorCursorAtPoint(dropPoint.x, dropPoint.y)
    setErrorMessage('')

    void uploadArticleImages(droppedFiles)
      .then((uploadedPaths) => {
        insertUploadedImagePaths(uploadedPaths)
      })
      .catch((error) => {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        } else {
          setErrorMessage(toApiMessage(error))
        }
      })
  }

  useEffect(() => {
    const captureOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    }
    const editorImageEvents = [
      'pointermove',
      'pointerdown',
      'touchstart',
      'click',
    ]

    function stopEditorImageEvent(event: Event): HTMLImageElement | null {
      if (isImageOptionPanelElement(event.target)) {
        return null
      }

      const selectedImage = getEditorImageFromEvent(event)
      if (selectedImage === null) {
        return null
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return selectedImage
    }

    function handleEditorImageEvent(event: Event): void {
      const selectedImage = stopEditorImageEvent(event)
      if (selectedImage === null) {
        if (isImageOptionPanelElement(event.target)) {
          return
        }
        const currentSelection = activeImageSelectionRef.current
        if (
          event.type === 'pointermove'
          && currentSelection.mode === 'hover'
          && !imageOptionPanelHoveredRef.current
        ) {
          clearActiveImageSelection()
        }
        return
      }

      const pointerEvent = event as PointerEvent & { pointerType?: string }
      const source = selectedImage.getAttribute('src')?.trim() || selectedImage.currentSrc.trim()

      if (event.type === 'pointermove') {
        if (activeImageSelectionRef.current.mode === 'pinned') {
          return
        }
        if (pointerEvent.pointerType !== 'mouse') {
          return
        }
        selectImageBySource(source, 'hover')
        syncImageOptionOverlayPosition()
        return
      }

      if (event.type === 'pointerdown' || event.type === 'touchstart') {
        selectImageBySource(
          source,
          pointerEvent.pointerType === 'touch' || event.type === 'touchstart'
            ? 'pinned'
            : 'hover',
        )
        syncImageOptionOverlayPosition()
        return
      }

      if (event.type === 'click') {
        if (pointerEvent.pointerType === 'touch') {
          selectImageBySource(source, 'pinned')
          syncImageOptionOverlayPosition()
        }
      }
    }

    function handleDocumentClick(event: MouseEvent): void {
      if (isImageOptionPanelElement(event.target)) {
        return
      }

      if (getEditorImageTarget(event.target) === null) {
        clearActiveImageSelection()
      }
    }

    for (const eventName of editorImageEvents) {
      window.addEventListener(eventName, handleEditorImageEvent, captureOptions)
    }
    document.addEventListener('click', handleDocumentClick, captureOptions)
    return () => {
      for (const eventName of editorImageEvents) {
        window.removeEventListener(eventName, handleEditorImageEvent, captureOptions)
      }
      document.removeEventListener('click', handleDocumentClick, captureOptions)
    }
  }, [])

  useLayoutEffect(() => {
    if (selectedImageFileName === '' || selectedImageSource === '') {
      setImageOptionOverlayPosition(null)
      return
    }

    let disposed = false
    let animationFrameId = window.requestAnimationFrame(() => {
      syncPosition()
    })

    function syncPosition(): void {
      if (disposed) {
        return
      }
      syncImageOptionOverlayPosition()
    }

    syncPosition()

    const workplace = getEditorWorkplaceElement()
    window.addEventListener('resize', syncPosition)
    workplace?.addEventListener('scroll', syncPosition, { passive: true })

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', syncPosition)
      workplace?.removeEventListener('scroll', syncPosition)
    }
  }, [selectedImageFileName, selectedImageSource])

  async function ensureEditableSelectedImage(
    selectionVersion: number,
    preferOriginal: boolean,
  ): Promise<{
    fileName: string
    source: string
  }> {
    const currentSelection = activeImageSelectionRef.current
    if (currentSelection.fileName === '' || currentSelection.source === '') {
      throw new Error('画像が選択されていません。')
    }

    const originalSource = currentSelection.originalFilePath === ''
      ? ''
      : buildOriginalMediaPath(currentSelection.originalFilePath)
    const sourceToFetch = preferOriginal && originalSource !== ''
      ? originalSource
      : currentSelection.source

    const tempPrefix = `/media/tmp/${lockToken}/`
    if (sourceToFetch.startsWith(tempPrefix)) {
      return {
        fileName: currentSelection.fileName,
        source: sourceToFetch,
      }
    }

    const response = await fetch(sourceToFetch)
    if (!response.ok) {
      throw new Error('既存画像の再処理用コピーに失敗しました。')
    }

    const blob = await response.blob()
    const tempFile = new File(
      [blob],
      createUuidFileName(currentSelection.fileName, blob.type),
      {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      },
    )
    const uploaded = await uploadTempImage(tempFile)
    const currentBodyHtml = getCurrentEditorHtml()
    const nextBodyHtml = replaceImageSourceInHtml(
      currentBodyHtml,
      currentSelection.source,
      uploaded.path,
    )

    if (editorInstanceRef.current !== null) {
      editorInstanceRef.current.value = nextBodyHtml
    }

    setForm((prev) => ({
      ...prev,
      bodyHtml: nextBodyHtml,
    }))
    setUploadedImageOptions((prev) => ({
      ...prev,
      [uploaded.file_name]: prev[currentSelection.fileName] ?? DEFAULT_IMAGE_OPTIONS,
    }))
    setUploadedImageOriginalPaths((prev) => {
      const next = {
        ...prev,
        [uploaded.file_name]: currentSelection.originalFilePath,
      }
      uploadedImageOriginalPathsRef.current = next
      return next
    })
    if (selectionVersion === activeImageSelectionVersionRef.current) {
      activeImageSelectionRef.current = {
        fileName: uploaded.file_name,
        source: uploaded.path,
        originalFilePath: currentSelection.originalFilePath,
        mode: currentSelection.mode,
      }
      setSelectedImageFileName(uploaded.file_name)
      setSelectedImageSource(uploaded.path)
    }
    return {
      fileName: uploaded.file_name,
      source: uploaded.path,
    }
  }

  async function updateSelectedImageOption(
    key: keyof ImageProcessingOptions,
    checked: boolean,
  ): Promise<void> {
    const currentSelection = activeImageSelectionRef.current
    if (currentSelection.fileName === '' || currentSelection.source === '') {
      return
    }
    if (imageOptionUpdateInFlightRef.current) {
      return
    }

    const selectionVersion = activeImageSelectionVersionRef.current
    imageOptionUpdateInFlightRef.current = true
    setUpdatingImageOptions(true)
    setErrorMessage('')
    try {
      const editableImage = await ensureEditableSelectedImage(selectionVersion, !checked)
      setUploadedImageOptions((prev) => ({
        ...prev,
        [editableImage.fileName]: {
          ...(prev[editableImage.fileName] ?? DEFAULT_IMAGE_OPTIONS),
          [key]: checked,
        },
      }))
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage(toApiMessage(error))
      }
    } finally {
      imageOptionUpdateInFlightRef.current = false
      setUpdatingImageOptions(false)
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
      const currentBodyHtml = getCurrentEditorHtml()
      const thumbnailRequest = await buildThumbnailRequest()
      const newImageFileNames = collectTempImageFileNames(currentBodyHtml, lockToken)
      const deleteImageIds = resolveDeleteImageIds(initialMediaAssets, currentBodyHtml)

      const payload = {
        category_id: form.categoryId,
        title: form.title,
        summary: form.summary,
        body_html: currentBodyHtml,
        status: form.status,
        tag_names: form.tagNames,
        twitter_card: form.twitterCard,
        article_option: {
          selected_option_ids: form.selectedOptionIds,
        },
        image_diff: {
          lock_token: lockToken,
          new_images: newImageFileNames.map((fileName) => ({
            file_name: fileName,
            ...(() => {
              const originalFilePath = resolveCurrentImageOriginalFilePath(fileName)
              return originalFilePath.trim() === ''
                ? {}
                : {
                    original_file_path: originalFilePath,
                  }
            })(),
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
          saveLogArticleTitle: form.title.trim(),
        },
      })
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage(toApiMessage(error))
      }
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

  const joditConfig = useMemo(() => ({
    readonly: false,
    language: 'ja',
    height: 900,
    toolbarSticky: false,
    imageDefaultWidth: null,
    disablePlugins: ['imageProcessor', 'resizer'],
    toolbarInlineDisableFor: ['img'],
    popup: {
      img: [],
    },
    uploader: {
      insertImageAsBase64URI: false,
      imagesExtensions: [...ARTICLE_IMAGE_EXTENSIONS],
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

        const uploadedPaths = await uploadArticleImages(files)
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
      defaultHandlerSuccess(data: { baseurl?: string; files?: unknown[] }) {
        const baseurl = typeof data.baseurl === 'string' ? data.baseurl : ''
        const imagePaths = Array.isArray(data.files)
          ? data.files
            .filter((fileName): fileName is string => typeof fileName === 'string')
            .map((fileName) => `${baseurl}${fileName}`)
          : []
        insertUploadedImagePaths(imagePaths)
      },
    },
  }), [lockToken])

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
  const selectedImageOptions = selectedImageFileName === ''
    ? DEFAULT_IMAGE_OPTIONS
    : (uploadedImageOptions[selectedImageFileName] ?? DEFAULT_IMAGE_OPTIONS)

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

  function handleThumbnailModeChange(nextMode: InternalThumbnailMode): void {
    setThumbnailMode(nextMode)
    if (nextMode === 'use_default') {
      setThumbnailPreviewPath(defaultThumbnailPreviewPath)
      setThumbnailUploadFileName('')
      return
    }
    if (nextMode === 'keep_current') {
      setThumbnailPreviewPath(currentThumbnailAsset?.public_path ?? article?.thumbnail_preview_path ?? '')
      setThumbnailUploadFileName('')
      return
    }
    setThumbnailPreviewPath('')
    if (nextMode !== 'use_uploaded') {
      setThumbnailUploadFileName('')
    }
  }

  function addTagName(rawName = tagDraft): void {
    const normalizedName = rawName.trim()
    if (normalizedName === '') {
      return
    }
    if (normalizedName.length > ARTICLE_TAG_MAX_LENGTH) {
      setErrorMessage(`タグ名は${ARTICLE_TAG_MAX_LENGTH}文字以内で入力してください。`)
      return
    }
    const alreadyAdded = form.tagNames.some(
      (tagName) =>
        normalizeTagNameForCompare(tagName) === normalizeTagNameForCompare(normalizedName),
    )
    if (alreadyAdded) {
      setTagDraft('')
      setTagSuggestions([])
      setShowTagSuggestions(false)
      return
    }
    if (form.tagNames.length >= ARTICLE_TAG_MAX_COUNT) {
      setErrorMessage(`タグは${ARTICLE_TAG_MAX_COUNT}件以内で設定してください。`)
      return
    }

    setForm((prev) => ({
      ...prev,
      tagNames: [...prev.tagNames, normalizedName],
    }))
    setTagDraft('')
    setTagSuggestions([])
    setTagSuggestionError('')
    setShowTagSuggestions(false)
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
              onChange={(nextValue) => handleThumbnailModeChange(nextValue as InternalThumbnailMode)}
            />
          </label>

          {thumbnailMode === 'use_uploaded' && (
            <label className="console-label col-12 col-lg-6">
              サムネイル画像
              <input
                className="console-input form-control"
                type="file"
                accept={ARTICLE_IMAGE_ACCEPT}
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
          title="ハッシュタグ"
          helpLines={[
            'タグ名を入力すると既存のタグがサジェストされます。',
            '既存のタグを優先的に選択してください。',
            '入力値そのままでも、候補からでもタグを確定できます。',
          ]}
          compact
          showDivider={false}
        />
        <div className="cms-article-tag-combobox">
          <div className="console-label cms-article-tag-input-label">
            <span className="cms-article-field-head">
              <label htmlFor={tagInputId}>タグ名</label>
              <span className="cms-article-field-counter">
                {tagDraft.length}/{ARTICLE_TAG_MAX_LENGTH}
              </span>
            </span>
            <div
              className="cms-article-tag-input-shell"
              onClick={() => tagInputRef.current?.focus()}
            >
              {form.tagNames.map((tagName) => (
                <button
                  key={tagName}
                  type="button"
                  className="cms-tag-chip is-removable"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      tagNames: prev.tagNames.filter((item) => item !== tagName),
                    }))
                  }
                >
                  #{tagName}
                  <i className="bi bi-x-lg" aria-hidden="true" />
                </button>
              ))}
              <input
                id={tagInputId}
                ref={tagInputRef}
                className="cms-article-tag-inline-input"
                type="text"
                value={tagDraft}
                onChange={(event) => {
                  setTagDraft(event.target.value)
                  setShowTagSuggestions(true)
                }}
                onFocus={() => {
                  if (tagDraft.trim() !== '') {
                    setShowTagSuggestions(true)
                  }
                }}
                onBlur={() => setShowTagSuggestions(false)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return
                  }
                  event.preventDefault()
                  addTagName()
                }}
                maxLength={ARTICLE_TAG_MAX_LENGTH}
                placeholder={form.tagNames.length === 0 ? '例: Nikon Z9' : ''}
              />
            </div>
          </div>
          {showTagSuggestions && tagDraft.trim() !== '' ? (
            <div className="cms-article-tag-suggest-panel" role="listbox">
              {tagSuggestionLoading ? (
                <div className="cms-article-tag-suggest-status">候補を取得しています。</div>
              ) : tagSuggestionError !== '' ? (
                <div className="cms-article-tag-suggest-status is-error">{tagSuggestionError}</div>
              ) : tagSuggestions.length > 0 ? (
                tagSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="cms-article-tag-suggest-item"
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={() => addTagName(suggestion.name)}
                  >
                    <span className="cms-article-tag-suggest-name">#{suggestion.name}</span>
                    <span className="cms-article-tag-suggest-count">
                      {suggestion.article_count.toLocaleString('ja-JP')}件
                    </span>
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  className="cms-article-tag-suggest-item is-create"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => addTagName()}
                >
                  <span className="cms-article-tag-suggest-name">#{tagDraft.trim()}</span>
                  <span className="cms-article-tag-suggest-count">
                    <span className="cms-article-tag-suggest-action is-desktop">Enterで追加</span>
                    <span className="cms-article-tag-suggest-action is-mobile">タップで追加</span>
                  </span>
                </button>
              )}
            </div>
          ) : null}
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
            '既存のオプションから必要なものを選択してください。',
            'オプションの作成や編集はオプションタブで行います。',
            '記事内にAmazonアフィリエイトリンクを挿入する場合はADを必ず選択してください。',
            'メーカーより提供がある製品をレビューする場合PRを必ず選択してください。',
          ]}
          compact
          showDivider={false}
        />
        {optionCatalog.length > 0 ? (
          <fieldset className="cms-article-option-grid">
            <legend className="visually-hidden">記事オプション</legend>
            {optionCatalog.map((option) => {
              const inputId = `cms-article-option-${option.id}`
              const selected = form.selectedOptionIds.includes(option.id)

              return (
                <label
                  key={option.id}
                  className={`cms-article-option-choice${selected ? ' is-selected' : ''}`}
                  htmlFor={inputId}
                >
                  <span className="cms-article-option-choice-head">
                    <input
                      id={inputId}
                      type="checkbox"
                      name="article_option"
                      value={option.id}
                      checked={selected}
                      onChange={() => toggleExistingOption(option.id)}
                    />
                    <span>{option.label}</span>
                  </span>
                  <span className="cms-article-option-choice-text">
                    {option.description}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ) : (
          <div className="console-placeholder">オプションがありません。オプションタブで作成してください。</div>
        )}
      </div>

      <div className="console-card">
        <CmsTabGuide title="本文" helpLines={[]} compact showDivider={false} />
        <div
          ref={editorShellRef}
          className="cms-article-editor-shell"
          onDragOverCapture={handleEditorDragOver}
          onDropCapture={handleEditorDrop}
          onFocusCapture={saveEditorSelection}
          onKeyUpCapture={saveEditorSelection}
          onMouseUpCapture={saveEditorSelection}
          onTouchEndCapture={saveEditorSelection}
          >
          <JoditEditor
            value={editorBodyHtml}
            editorRef={handleEditorRef}
            config={joditConfig}
            onBlur={handleEditorBlur}
          />
          {selectedImageFileName !== '' && imageOptionOverlayPosition !== null && (
            <div
              ref={imageOptionPanelRef}
              className="cms-image-option-panel cms-image-option-panel-overlay"
              style={{
                top: `${imageOptionOverlayPosition.top}px`,
                left: `${imageOptionOverlayPosition.left}px`,
                width: `${imageOptionOverlayPosition.width}px`,
              }}
              onPointerEnter={() => {
                imageOptionPanelHoveredRef.current = true
              }}
              onPointerLeave={(event) => {
                imageOptionPanelHoveredRef.current = false
                if (activeImageSelectionRef.current.mode !== 'hover') {
                  return
                }

                const relatedTarget = event.relatedTarget
                if (relatedTarget instanceof HTMLElement) {
                  if (
                    isImageOptionPanelElement(relatedTarget)
                    || getEditorImageTarget(relatedTarget) !== null
                  ) {
                    return
                  }
                }

                clearActiveImageSelection()
              }}
            >
              <div className="cms-image-option-panel-head">
                <strong>画像処理オプション</strong>
                <span>{selectedImageFileName}</span>
              </div>
              <label className="cms-image-option-toggle">
                <input
                  type="checkbox"
                  checked={selectedImageOptions.exif_watermark}
                  onChange={(event) => {
                    void updateSelectedImageOption('exif_watermark', event.target.checked)
                  }}
                  disabled={updatingImageOptions}
                />
                <span className="cms-image-option-switch" aria-hidden="true" />
                <span>EXIF透かし</span>
              </label>
              <label className="cms-image-option-toggle">
                <input
                  type="checkbox"
                  checked={selectedImageOptions.site_logo_watermark}
                  onChange={(event) => {
                    void updateSelectedImageOption('site_logo_watermark', event.target.checked)
                  }}
                  disabled={updatingImageOptions}
                />
                <span className="cms-image-option-switch" aria-hidden="true" />
                <span>サイトロゴ透かし</span>
              </label>
              <p className="cms-image-option-help">
                画像をクリックまたはタップすると、この画像だけの透かし設定を変更できます。
              </p>
            </div>
          )}
        </div>

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
