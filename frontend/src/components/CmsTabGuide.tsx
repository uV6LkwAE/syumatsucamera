type CmsTabGuideProps = {
  title: string
  summary?: string
  helpLines: string[]
  showDivider?: boolean
  compact?: boolean
  required?: boolean
}

export default function CmsTabGuide({
  title,
  summary,
  helpLines,
  showDivider = true,
  compact = false,
  required = false,
}: CmsTabGuideProps) {
  const className = compact
    ? 'cms-tab-guide cms-tab-guide-compact container-fluid px-0'
    : 'cms-tab-guide container-fluid px-0'

  return (
    <section className={className}>
      <div className="cms-tab-guide-head">
        <h2>{title}</h2>
        {required && <span className="cms-tab-guide-required">必須*</span>}
      </div>
      {summary && summary.trim() !== '' && (
        <p className="cms-tab-guide-summary">{summary}</p>
      )}
      {helpLines.length > 0 && (
        <div className="cms-tab-guide-help">
          <i className="bi bi-question-circle" aria-hidden="true" />
          <div className="cms-tab-guide-help-copy">
            {helpLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      )}
      {showDivider && <hr className="cms-console-divider cms-tab-guide-divider" />}
    </section>
  )
}
