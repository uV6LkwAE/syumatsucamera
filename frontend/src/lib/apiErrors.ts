import { ApiError } from '../api/client'

export type ApiErrorFieldEntry = {
  path: string
  label: string
  messages: string[]
}

export type ApiErrorViewModel = {
  title: string
  status: number | null
  code: string
  detail: string
  fields: ApiErrorFieldEntry[]
}

const DEFAULT_FIELD_LABELS: Record<string, string> = {
  article_id: '記事',
  body: '本文',
  body_html: '本文',
  category_id: 'カテゴリ',
  code: 'エラーコード',
  company_name: '会社名',
  current_password: '現在のパスワード',
  delete_images: '削除画像',
  description: '説明文',
  detail: '詳細',
  display_name: '表示名',
  email: 'メールアドレス',
  exif_watermark: 'EXIF透かし',
  file: 'ファイル',
  file_name: 'ファイル名',
  header_image: 'ヘッダー画像',
  header_image_file: 'ヘッダー画像',
  icon: 'アイコン画像',
  icon_file: 'アイコン画像',
  instagram_url: 'Instagram URL',
  is_active: '有効状態',
  label: '表示名',
  lock_token: 'ロックトークン',
  meta_items: '追加プロフィール項目',
  name: '名前',
  new_images: '新規画像',
  non_field_errors: '全体エラー',
  options: '画像オプション',
  parent_id: '親カテゴリ',
  person_name: 'お名前',
  profile: '自己紹介',
  role: '権限',
  selected_option_ids: '記事オプション',
  site_logo_watermark: 'サイトロゴ透かし',
  status: '公開状態',
  subject_type: '問い合わせ種別',
  summary: '要約',
  tag_names: 'タグ',
  thumbnail_mode: 'サムネイル設定',
  thumbnail_request: 'サムネイル',
  thumbnail_upload_file_name: 'サムネイル画像',
  title: 'タイトル',
  token: '認証トークン',
  turnstile_token: 'Turnstile',
  twitter_card: 'Twitter Card',
  value: '内容',
  website_url: 'Webサイト URL',
  x_url: 'X URL',
}

type PathSegment = {
  type: 'key' | 'index'
  value: string
}

function isPrimitiveMessage(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  )
}

function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  const pattern = /([^[.\]]+)|\[(\d+)\]/g

  for (const match of path.matchAll(pattern)) {
    const key = match[1]
    const index = match[2]
    if (key !== undefined) {
      segments.push({ type: 'key', value: key })
    } else if (index !== undefined) {
      segments.push({ type: 'index', value: index })
    }
  }

  return segments
}

function formatSegmentsForLabel(path: string, labels: Record<string, string>): string {
  const segments = parsePath(path)
  const parts: string[] = []

  for (const segment of segments) {
    if (segment.type === 'index') {
      continue
    }

    const label = labels[segment.value] ?? DEFAULT_FIELD_LABELS[segment.value]
    parts.push(label ?? segment.value.replace(/_/g, ' '))
  }

  return parts.join(' / ') || path
}

function collectFieldEntries(
  value: unknown,
  pathSegments: string[] = [],
): Array<{ path: string; messages: string[] }> {
  if (value === null || value === undefined) {
    return []
  }

  if (isPrimitiveMessage(value)) {
    const message = String(value).trim()
    if (message === '') {
      return []
    }
    return [
      {
        path: pathSegments.join('.'),
        messages: [message],
      },
    ]
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item === null || item === undefined || isPrimitiveMessage(item))) {
      const messages = value
        .map((item) => String(item ?? '').trim())
        .filter((item) => item !== '')
      if (messages.length === 0) {
        return []
      }
      return [
        {
          path: pathSegments.join('.'),
          messages,
        },
      ]
    }

    return value.flatMap((item, index) => collectFieldEntries(item, [...pathSegments, `[${index}]`]))
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nextValue]) =>
      collectFieldEntries(nextValue, [...pathSegments, key]))
  }

  return []
}

function buildTitle(error: ApiError): string {
  if (error.status === 400 || error.code === 'VALIDATION_ERROR') {
    return '入力エラー'
  }
  if (error.status === 401 || error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_TOKEN_INVALID') {
    return '認証エラー'
  }
  if (error.status === 403 || error.code === 'PERMISSION_DENIED') {
    return '権限エラー'
  }
  if (error.status === 404 || error.code === 'RESOURCE_NOT_FOUND') {
    return '対象が見つかりません'
  }
  if (error.status === 409 || error.code === 'RESOURCE_CONFLICT') {
    return '競合エラー'
  }
  if (error.status >= 500) {
    return 'サーバーエラー'
  }
  return 'エラー'
}

export function createValidationApiError(
  errors: Record<string, string | string[]>,
  detail = '入力エラーです。',
): ApiError {
  const normalizedErrors: Record<string, string[]> = {}

  for (const [field, messages] of Object.entries(errors)) {
    const values = Array.isArray(messages) ? messages : [messages]
    const normalizedMessages = values
      .map((message) => String(message).trim())
      .filter((message) => message !== '')
    if (normalizedMessages.length === 0) {
      continue
    }
    normalizedErrors[field] = normalizedMessages
  }

  return new ApiError(400, {
    detail,
    code: 'VALIDATION_ERROR',
    errors: normalizedErrors,
  })
}

export function buildApiErrorViewModel(
  error: unknown,
  fieldLabels: Record<string, string> = {},
): ApiErrorViewModel | null {
  if (error === null || error === undefined) {
    return null
  }

  if (typeof error === 'string') {
    const detail = error.trim()
    if (detail === '') {
      return null
    }
    return {
      title: 'エラー',
      status: null,
      code: 'API_ERROR',
      detail,
      fields: [],
    }
  }

  if (error instanceof ApiError) {
    const mergedLabels = { ...DEFAULT_FIELD_LABELS, ...fieldLabels }
    const fieldEntries = error.errors === undefined
      ? []
      : collectFieldEntries(error.errors).map((entry) => ({
          path: entry.path,
          label: formatSegmentsForLabel(entry.path, mergedLabels),
          messages: entry.messages,
        }))

    return {
      title: buildTitle(error),
      status: error.status,
      code: error.code,
      detail: error.detail,
      fields: fieldEntries,
    }
  }

  if (error instanceof Error) {
    const detail = error.message.trim()
    return {
      title: 'エラー',
      status: null,
      code: 'API_ERROR',
      detail: detail === '' ? '通信中に予期しないエラーが発生しました。' : detail,
      fields: [],
    }
  }

  return {
    title: 'エラー',
    status: null,
    code: 'API_ERROR',
    detail: '通信中に予期しないエラーが発生しました。',
    fields: [],
  }
}

