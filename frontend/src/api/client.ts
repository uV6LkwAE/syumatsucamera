const API_BASE_PATH = '/api'
const ACCESS_JWT_STORAGE_KEY = 'cf_access_jwt_assertion'
const API_LOADING_MIN_VISIBLE_MS = 500

const apiLoadingListeners = new Set<() => void>()

let pendingApiRequestCount = 0
let apiLoadingVisible = false
let apiLoadingMinimumVisibleUntil = 0
let apiLoadingHideTimer: number | null = null

type ApiRequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type ApiRequestOptions = {
  method?: ApiRequestMethod
  body?: unknown
  withAuth?: boolean
  headers?: Record<string, string>
}

type ApiErrorPayload = {
  detail?: string
  code?: string
  errors?: Record<string, unknown>
}

type DevelopmentAccessTokenResponse = {
  token_type: string
  token: string
  expires_at: string
  email: string
  sub: string
}

export class ApiError extends Error {
  status: number
  code: string
  detail: string
  errors?: Record<string, unknown>

  constructor(status: number, payload?: ApiErrorPayload) {
    const detail = payload?.detail ?? 'APIリクエストに失敗しました。'
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = payload?.code ?? 'API_ERROR'
    this.detail = detail
    this.errors = payload?.errors
  }
}

function emitApiLoadingChange(): void {
  for (const listener of apiLoadingListeners) {
    listener()
  }
}

function setApiLoadingVisible(nextVisible: boolean): void {
  if (apiLoadingVisible === nextVisible) {
    return
  }

  apiLoadingVisible = nextVisible
  emitApiLoadingChange()
}

function beginApiRequestLoading(): void {
  const now = Date.now()

  pendingApiRequestCount += 1
  apiLoadingMinimumVisibleUntil = Math.max(
    apiLoadingMinimumVisibleUntil,
    now + API_LOADING_MIN_VISIBLE_MS,
  )

  if (apiLoadingHideTimer !== null) {
    window.clearTimeout(apiLoadingHideTimer)
    apiLoadingHideTimer = null
  }

  setApiLoadingVisible(true)
}

function finishApiRequestLoading(): void {
  pendingApiRequestCount = Math.max(0, pendingApiRequestCount - 1)
  if (pendingApiRequestCount > 0) {
    return
  }

  const remaining = Math.max(apiLoadingMinimumVisibleUntil - Date.now(), 0)
  if (remaining === 0) {
    apiLoadingMinimumVisibleUntil = 0
    setApiLoadingVisible(false)
    return
  }

  apiLoadingHideTimer = window.setTimeout(() => {
    apiLoadingHideTimer = null
    if (pendingApiRequestCount === 0) {
      apiLoadingMinimumVisibleUntil = 0
      setApiLoadingVisible(false)
    }
  }, remaining)
}

export function subscribeApiLoading(listener: () => void): () => void {
  apiLoadingListeners.add(listener)
  return () => {
    apiLoadingListeners.delete(listener)
  }
}

export function getApiLoadingSnapshot(): boolean {
  return apiLoadingVisible
}

export function getStoredAccessJwt(): string {
  return window.localStorage.getItem(ACCESS_JWT_STORAGE_KEY) ?? ''
}

export function setStoredAccessJwt(token: string): void {
  if (token.trim() === '') {
    window.localStorage.removeItem(ACCESS_JWT_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(ACCESS_JWT_STORAGE_KEY, token.trim())
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return undefined
  }

  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  beginApiRequestLoading()

  const method = options.method ?? 'GET'
  const withAuth = options.withAuth ?? true
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  if (withAuth) {
    const accessJwt = getStoredAccessJwt()
    if (accessJwt !== '') {
      headers['Cf-Access-Jwt-Assertion'] = accessJwt
    }
  }

  try {
    const response = await fetch(`${API_BASE_PATH}${path}`, {
      method,
      headers,
      body,
    })

    const payload = await parseJsonSafely(response)

    if (!response.ok) {
      throw new ApiError(response.status, payload as ApiErrorPayload | undefined)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return payload as T
  } finally {
    finishApiRequestLoading()
  }
}

export async function bootstrapDevelopmentAccessJwt(): Promise<void> {
  if (!import.meta.env.DEV) {
    return
  }
  setStoredAccessJwt('')
  const payload = await apiRequest<DevelopmentAccessTokenResponse>(
    '/system/dev-access-token',
    {
      withAuth: false,
    },
  )
  setStoredAccessJwt(payload.token)
}
