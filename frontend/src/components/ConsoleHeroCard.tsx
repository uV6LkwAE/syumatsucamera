type ConsoleHeroCardProps = {
  badge: string
  title: string
  subtitle: string
  icon: string
}

export default function ConsoleHeroCard({
  badge,
  title,
  subtitle,
  icon,
}: ConsoleHeroCardProps) {
  return (
    <div className="console-card console-card-hero">
      <div className="console-hero-content">
        <div>
          <div className="console-badge">{badge}</div>
          <h1 className="console-title">{title}</h1>
          <p className="console-subtitle">{subtitle}</p>
        </div>
        <div className="console-hero-icon">
          <i className={`bi ${icon}`} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
