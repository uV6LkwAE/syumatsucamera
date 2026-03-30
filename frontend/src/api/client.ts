const API_BASE_PATH = '/api'
const ACCESS_JWT_STORAGE_KEY = 'cf_access_jwt_assertion'

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
