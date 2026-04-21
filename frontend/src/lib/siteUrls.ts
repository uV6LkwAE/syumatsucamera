const CMS_HOST_PREFIX = 'cms.'

export function getPublicSiteOrigin(): string {
  if (typeof window === 'undefined') {
    return 'https://syumatsucamera.com'
  }

  const { protocol, hostname, port, origin } = window.location
  if (!hostname.startsWith(CMS_HOST_PREFIX)) {
    return origin
  }

  const publicHostname = hostname.slice(CMS_HOST_PREFIX.length)
  const portSuffix = port === '' ? '' : `:${port}`
  return `${protocol}//${publicHostname}${portSuffix}`
}

export function buildPublicSiteUrl(pathname: string): string {
  return new URL(pathname, getPublicSiteOrigin()).toString()
}
