import { ApiError, type ApiErrorPayload } from './apiError'

const API_BASE_PATH = '/api'

type ApiRequestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

type ApiRequestOptions = {
  method?: ApiRequestMethod
  body?: unknown
  headers?: Record<string, string>
  withAuth?: boolean
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
  } catch (error) {
    throw error
  }
}
