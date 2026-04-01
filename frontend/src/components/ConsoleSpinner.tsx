type ConsoleSpinnerProps = {
  mode?: 'overlay' | 'block' | 'inline'
  label?: string
  className?: string
}

export default function ConsoleSpinner({
  mode = 'block',
  label = '読み込み中',
  className = '',
}: ConsoleSpinnerProps) {
  const rootClassName = [
    'console-spinner',
    `is-${mode}`,
    className,
  ]
    .filter((value) => value !== '')
    .join(' ')

  const spinnerClassName = mode === 'inline'
    ? 'spinner-border spinner-border-sm'
    : 'spinner-border'

  return (
    <div className={rootClassName}>
      <div className="console-spinner-chip" role="status" aria-live="polite" aria-label={label}>
        <span className={spinnerClassName} aria-hidden="true" />
        <span className="visually-hidden">{label}</span>
      </div>
    </div>
  )
}
