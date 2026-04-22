type ApiErrorPayload = {
  detail?: string
  code?: string
  errors?: Record<string, unknown>
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

export type { ApiErrorPayload }
