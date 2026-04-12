import { useEffect, useMemo } from 'react'
import { buildApiErrorViewModel } from '../lib/apiErrors'

type ApiErrorPopupProps = {
  error: unknown
  onClose: () => void
  fieldLabels?: Record<string, string>
}

export default function ApiErrorPopup({
  error,
  onClose,
  fieldLabels,
}: ApiErrorPopupProps) {
  const viewModel = useMemo(() => buildApiErrorViewModel(error, fieldLabels), [error, fieldLabels])

  useEffect(() => {
    if (viewModel === null) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, viewModel])

  if (viewModel === null) {
    return null
  }

  return (
    <div
      className="api-error-popup-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.currentTarget !== event.target) {
          return
        }
        onClose()
      }}
    >
      <section
        className="api-error-popup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-error-popup-title"
      >
        <div className="api-error-popup-head">
          <div className="api-error-popup-title-wrap">
            <div className="api-error-popup-badge" aria-hidden="true">
              <i className="bi bi-exclamation-triangle" />
            </div>
            <div className="api-error-popup-title-copy">
              <strong id="api-error-popup-title">{viewModel.title}</strong>
              <span>
                {viewModel.status !== null ? `[${viewModel.status}] ` : ''}
                {viewModel.code}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="api-error-popup-close"
            onClick={onClose}
            aria-label="閉じる"
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <p className="api-error-popup-detail">{viewModel.detail}</p>

        {viewModel.fields.length > 0 && (
          <div className="api-error-popup-fields">
            <strong className="api-error-popup-fields-title">問題のある項目</strong>
            <div className="api-error-popup-field-list">
              {viewModel.fields.map((field) => (
                <div key={`${field.path}-${field.label}`} className="api-error-popup-field">
                  <div className="api-error-popup-field-label-wrap">
                    <span className="api-error-popup-field-label">{field.label}</span>
                    <span className="api-error-popup-field-path">{field.path}</span>
                  </div>
                  <ul className="api-error-popup-field-messages">
                    {field.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

