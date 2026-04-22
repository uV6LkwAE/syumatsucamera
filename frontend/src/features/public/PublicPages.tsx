import {
  CSSProperties,
  Fragment,
  FormEvent,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { ApiError } from '../../api/apiError'
import ApiErrorPopup from '../../components/ApiErrorPopup'
import publicHeroPhoto from '../../assets/public/public-hero-photo.jpg'
import {
  fetchPublicArticleDetail,
  fetchPublicSidebar,
  fetchPublicSiteConfig,
  listPublicArticles,
  submitPublicContact,
} from './api'
import { PublicArticleBodyRenderer } from './articleBody'
import { buildPublicSiteUrl } from '../../lib/siteUrls'
import type {
  ContactSubjectType,
  PublicArticleBody,
  PublicArticleDetailResponse,
  PublicArticleListParams,
  PublicArticleListResponse,
  PublicArticleSummary,
  PublicAuthorSummary,
  PublicCategoryTreeItem,
  PublicSidebarResponse,
} from './types'

const PUBLIC_PAGE_SIZE = 9
const HOME_SECTION_SIZE = 6
const HOME_SEARCH_PAGE_SIZE = 9
const HOME_MOBILE_SEARCH_PAGE_SIZE = 6
const HOME_SEARCH_DEBOUNCE_MS = 320
const PUBLIC_SITE_NAME = '週末カメラ'
const PUBLIC_SITE_DESCRIPTION = '気ままに、機材と写真を楽しむブログ'
const PUBLIC_PRIVACY_POLICY_PATH = '/articles/miscellaneous-notes/privacy-policy/'
const PUBLIC_ADMINISTRATOR_SELF_INTRODUCTION_PATH =
  '/articles/miscellaneous-notes/administrator-self-introduction/'
const MINI_CAROUSEL_INTERVAL_MS = 3600
const SLIDE_DRAG_THRESHOLD_PX = 48
const PUBLIC_MOBILE_VIEWPORT_QUERY = '(max-width: 991.98px)'
const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script'
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const PUBLIC_HERO_MESSAGES = [
  [
    '沼ってますか？',
    'カメラやレンズのこと、写真を撮る楽しさを気ままにつづっていくブログです。',
  ],
  [
    'その一本、本当に最後ですか？',
    '読みに来たつもりが、欲しくなっちゃうかもしれません。',
  ],
  [
    '見に来ただけのはずが、欲しくなっちゃうかも。',
    '機材のことも、写真を撮る楽しさも、気ままにつづっていくブログです。',
  ],
  [
    '予算ってなんですか？',
    '欲しいものが、いつのまにか予算になっていくんです。',
  ],
  [
    '防湿庫のスペース、まだ余ってますか？',
    '欲しい理由を、一緒に増やしていきませんか。',
  ],
]

type PublicTurnstileWidgetId = string

type PublicTurnstileRenderOptions = {
  sitekey: string
  size?: 'normal' | 'compact' | 'flexible'
  theme?: 'light' | 'dark' | 'auto'
  callback?: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: PublicTurnstileRenderOptions,
      ) => PublicTurnstileWidgetId
      reset: (widgetId?: PublicTurnstileWidgetId) => void
      remove: (widgetId?: PublicTurnstileWidgetId) => void
    }
  }
}

let turnstileScriptLoadPromise: Promise<void> | null = null

function loadPublicTurnstileScript(): Promise<void> {
  if (window.turnstile !== undefined) {
    return Promise.resolve()
  }
  if (turnstileScriptLoadPromise !== null) {
    return turnstileScriptLoadPromise
  }

  turnstileScriptLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript !== null) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener(
        'error',
        () => {
          turnstileScriptLoadPromise = null
          reject(new Error('Turnstile script loading failed.'))
        },
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => {
        turnstileScriptLoadPromise = null
        reject(new Error('Turnstile script loading failed.'))
      },
      { once: true },
    )
    document.head.appendChild(script)
  })

  return turnstileScriptLoadPromise
}

function usePublicMobileViewport(): boolean {
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.matchMedia(PUBLIC_MOBILE_VIEWPORT_QUERY).matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(PUBLIC_MOBILE_VIEWPORT_QUERY)

    function handleChange(event: MediaQueryListEvent): void {
      setIsMobileViewport(event.matches)
    }

    setIsMobileViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return isMobileViewport
}

function formatPublicDate(value: string | null): string {
  if (value === null) {
    return ''
  }
  return new Date(value).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatPublicDateParts(value: string | null): { year: string; monthDay: string } | null {
  if (value === null) {
    return null
  }

  const date = new Date(value)
  return {
    year: String(date.getFullYear()),
    monthDay: [
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('/'),
  }
}

function buildProfileTextParagraphs(value: string): string[] {
  const normalizedValue = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalizedValue
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, '').trim())
    .filter((paragraph) => paragraph !== '')
}

type PublicProfileSocialSource = Pick<
  PublicAuthorSummary,
  'x_url' | 'instagram_url' | 'website_url'
>

function PublicProfileSocialLinks({
  profile,
  className = '',
}: {
  profile: PublicProfileSocialSource
  className?: string
}) {
  const links = [
    {
      href: profile.instagram_url,
      iconClassName: 'bi bi-instagram',
      label: 'Instagram',
    },
    {
      href: profile.x_url,
      iconClassName: 'bi bi-twitter-x',
      label: 'X',
    },
    {
      href: profile.website_url,
      iconClassName: 'bi bi-globe2',
      label: 'Webサイト',
    },
  ].filter((link): link is { href: string; iconClassName: string; label: string } =>
    link.href !== null && link.href.trim() !== '',
  )

  if (links.length === 0) {
    return null
  }

  return (
    <div
      className={`public-profile-social-links${className === '' ? '' : ` ${className}`}`}
      aria-label="SNSリンク"
    >
      {links.map((link) => (
        <a
          key={link.label}
          className="public-profile-social-link"
          href={link.href}
          target="_blank"
          rel="noreferrer"
        >
          <i className={link.iconClassName} aria-hidden="true" />
          <span className="visually-hidden">{link.label}</span>
        </a>
      ))}
    </div>
  )
}

function PublicProfileTextBlock({
  paragraphs,
  className,
}: {
  paragraphs: string[]
  className: string
}) {
  const textRef = useRef<HTMLDivElement | null>(null)
  const isMobileViewport = usePublicMobileViewport()
  const [shouldFade, setShouldFade] = useState(false)
  const [fadeHeight, setFadeHeight] = useState<number | null>(null)
  const paragraphKey = paragraphs.join('\n')

  useLayoutEffect(() => {
    const textElement = textRef.current
    if (!isMobileViewport || textElement === null) {
      setShouldFade(false)
      setFadeHeight(null)
      return
    }

    function updateFadeState(): void {
      if (textElement === null) {
        return
      }
      const computedStyle = window.getComputedStyle(textElement)
      const lineHeight = Number.parseFloat(computedStyle.lineHeight)
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        setShouldFade(false)
        setFadeHeight(null)
        return
      }

      const textRects: Array<{ bottom: number; top: number }> = []
      const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.textContent?.trim() === '') {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        },
      })

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0 && rect.height > 0) {
            textRects.push({ bottom: rect.bottom, top: rect.top })
          }
        }
        range.detach()
      }

      const groupingTolerance = Math.max(1, lineHeight * 0.2)
      const lineRects: Array<{ bottom: number; top: number }> = []
      for (const rect of textRects.sort((a, b) => a.top - b.top || a.bottom - b.bottom)) {
        const lastLine = lineRects[lineRects.length - 1]
        if (lastLine !== undefined && Math.abs(lastLine.top - rect.top) <= groupingTolerance) {
          lastLine.bottom = Math.max(lastLine.bottom, rect.bottom)
          continue
        }
        lineRects.push({ ...rect })
      }

      const nextShouldFade = lineRects.length >= 5
      setShouldFade(nextShouldFade)
      setFadeHeight(
        nextShouldFade
          ? Math.max(0, lineRects[4].bottom - textElement.getBoundingClientRect().top)
          : null,
      )
    }

    updateFadeState()
    const resizeObserver = new ResizeObserver(updateFadeState)
    resizeObserver.observe(textElement)
    return () => {
      resizeObserver.disconnect()
    }
  }, [isMobileViewport, paragraphKey])

  const fadeStyle =
    fadeHeight === null
      ? undefined
      : ({ '--public-profile-fade-height': `${fadeHeight}px` } as CSSProperties)

  return (
    <div
      ref={textRef}
      className={`${className}${shouldFade ? ' is-mobile-faded' : ''}`}
      style={fadeStyle}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={`${paragraph}-${index}`}>{paragraph}</p>
      ))}
    </div>
  )
}

function resolvePublicErrorPath(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return '/error/404'
  }
  return '/error/500'
}

function upsertMetaTag(selector: string, attrs: Record<string, string>): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (element === null) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }

  Object.entries(attrs).forEach(([key, value]) => {
    element?.setAttribute(key, value)
  })
}

function applyPublicPageMeta({
  title,
  description,
  path,
  imageUrl,
  type = 'website',
  twitterCard = 'summary_large_image',
}: {
  title: string
  description: string
  path: string
  imageUrl?: string
  type?: 'website' | 'article'
  twitterCard?: 'summary' | 'summary_large_image'
}): void {
  const absoluteUrl = buildPublicSiteUrl(path)
  document.title = `${title} | ${PUBLIC_SITE_NAME}`

  const canonicalSelector = 'link[rel="canonical"]'
  let canonicalLink = document.head.querySelector<HTMLLinkElement>(canonicalSelector)
  if (canonicalLink === null) {
    canonicalLink = document.createElement('link')
    canonicalLink.rel = 'canonical'
    document.head.appendChild(canonicalLink)
  }
  canonicalLink.href = absoluteUrl

  upsertMetaTag('meta[name="description"]', {
    name: 'description',
    content: description,
  })
  upsertMetaTag('meta[property="og:site_name"]', {
    property: 'og:site_name',
    content: PUBLIC_SITE_NAME,
  })
  upsertMetaTag('meta[property="og:locale"]', {
    property: 'og:locale',
    content: 'ja_JP',
  })
  upsertMetaTag('meta[property="og:type"]', {
    property: 'og:type',
    content: type,
  })
  upsertMetaTag('meta[property="og:title"]', {
    property: 'og:title',
    content: title,
  })
  upsertMetaTag('meta[property="og:description"]', {
    property: 'og:description',
    content: description,
  })
  upsertMetaTag('meta[property="og:url"]', {
    property: 'og:url',
    content: absoluteUrl,
  })
  upsertMetaTag('meta[name="twitter:card"]', {
    name: 'twitter:card',
    content: twitterCard,
  })
  upsertMetaTag('meta[name="twitter:title"]', {
    name: 'twitter:title',
    content: title,
  })
  upsertMetaTag('meta[name="twitter:description"]', {
    name: 'twitter:description',
    content: description,
  })
  upsertMetaTag('meta[name="twitter:site"]', {
    name: 'twitter:site',
    content: '@syumatsucamera',
  })
  upsertMetaTag('meta[property="og:image"]', {
    property: 'og:image',
    content: imageUrl ?? '',
  })
  upsertMetaTag('meta[name="twitter:image"]', {
    name: 'twitter:image',
    content: imageUrl ?? '',
  })
}

function PublicTurnstileWidget({
  siteKey,
  resetSignal,
  onTokenChange,
}: {
  siteKey: string
  resetSignal: number
  onTokenChange: (token: string) => void
}) {
  const widgetElementRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<PublicTurnstileWidgetId | null>(null)
  const [statusMessage, setStatusMessage] = useState('Turnstile を読み込んでいます。')

  useEffect(() => {
    let shouldIgnore = false
    const normalizedSiteKey = siteKey.trim()
    onTokenChange('')

    async function renderTurnstile(): Promise<void> {
      if (normalizedSiteKey === '') {
        setStatusMessage('Turnstile の公開キーが設定されていません。')
        return
      }

      try {
        await loadPublicTurnstileScript()
        if (shouldIgnore || widgetElementRef.current === null) {
          return
        }
        if (window.turnstile === undefined) {
          throw new Error('Turnstile global object is missing.')
        }

        widgetIdRef.current = window.turnstile.render(widgetElementRef.current, {
          sitekey: normalizedSiteKey,
          size: 'flexible',
          theme: 'light',
          callback: (token) => {
            onTokenChange(token)
            setStatusMessage('')
          },
          'error-callback': () => {
            onTokenChange('')
            setStatusMessage('Turnstile の検証中にエラーが発生しました。')
          },
          'expired-callback': () => {
            onTokenChange('')
            setStatusMessage('Turnstile の認証期限が切れました。再度確認してください。')
          },
          'timeout-callback': () => {
            onTokenChange('')
            setStatusMessage('Turnstile の認証がタイムアウトしました。再度確認してください。')
          },
        })
      } catch {
        if (!shouldIgnore) {
          onTokenChange('')
          setStatusMessage('Turnstile の読み込みに失敗しました。時間をおいて再読み込みしてください。')
        }
      }
    }

    void renderTurnstile()

    return () => {
      shouldIgnore = true
      if (widgetIdRef.current !== null && window.turnstile !== undefined) {
        window.turnstile.remove(widgetIdRef.current)
      }
      widgetIdRef.current = null
    }
  }, [onTokenChange, siteKey])

  useEffect(() => {
    if (resetSignal === 0) {
      return
    }
    onTokenChange('')
    if (widgetIdRef.current === null || window.turnstile === undefined) {
      return
    }
    window.turnstile.reset(widgetIdRef.current)
    setStatusMessage('Turnstile を確認しています。')
  }, [onTokenChange, resetSignal])

  return (
    <div className="public-contact-turnstile-field">
      <div ref={widgetElementRef} className="public-contact-turnstile-widget" />
      {statusMessage !== '' ? (
        <p className="public-contact-turnstile-message">{statusMessage}</p>
      ) : null}
    </div>
  )
}

function PublicArticleCard({
  article,
  variant = 'standard',
  eager = false,
  showSupplement = true,
}: {
  article: PublicArticleSummary
  variant?: 'hero' | 'standard' | 'compact'
  eager?: boolean
  showSupplement?: boolean
}) {
  return (
    <article className={`public-article-card is-${variant}`}>
      <Link className="public-article-card-link" to={article.path}>
        <div className="public-article-thumb-frame">
          <img
            className="public-article-thumb"
            src={article.thumbnail_url}
            alt={article.title}
            width={1200}
            height={630}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
          <span className="public-category-label">{article.category.name}</span>
        </div>
        <div className="public-article-card-body">
          <h2 className="public-article-card-title">{article.title}</h2>
          {showSupplement ? (
            <>
              <div className="public-article-card-meta">
                <div className="public-author-chip">
                  {article.author.icon ? (
                    <img
                      className="public-author-icon"
                      src={article.author.icon}
                      alt={article.author.display_name}
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="public-author-icon-fallback">
                      {article.author.display_name.charAt(0)}
                    </span>
                  )}
                  <span className="public-author-name">{article.author.display_name}</span>
                </div>
                {article.published_at ? (
                  <time className="public-published-at" dateTime={article.published_at}>
                    {formatPublicDate(article.published_at)}
                  </time>
                ) : null}
              </div>
              <div className="public-article-flags">
                {article.article_option.items.map((option) => (
                  <span key={option.id} className="public-article-flag">
                    {option.label}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Link>
    </article>
  )
}

function getLoopedSlideIndex(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return ((index % length) + length) % length
}

function PublicMiniArticleCarousel({
  articles,
  eagerCount = 2,
  moreTo,
}: {
  articles: PublicArticleSummary[]
  eagerCount?: number
  moreTo?: string
}) {
  const [activeIndex, setActiveIndex] = useState(articles.length)
  const [isTrackTransitionEnabled, setIsTrackTransitionEnabled] = useState(true)
  const dragStartXRef = useRef<number | null>(null)
  const dragDeltaXRef = useRef(0)
  const pauseUntilRef = useRef(0)
  const suppressClickRef = useRef(false)
  const repeatedArticles = [...articles, ...articles, ...articles]
  const currentDotIndex = getLoopedSlideIndex(activeIndex - articles.length, articles.length)

  useEffect(() => {
    setActiveIndex(articles.length)
    setIsTrackTransitionEnabled(true)
  }, [articles])

  useEffect(() => {
    if (articles.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current) {
        return
      }
      setActiveIndex((current) => current + 1)
    }, MINI_CAROUSEL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [articles.length])

  useEffect(() => {
    if (articles.length <= 1) {
      return
    }
    if (isTrackTransitionEnabled) {
      return
    }

    let firstFrameId = 0
    let secondFrameId = 0

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        setIsTrackTransitionEnabled(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrameId)
      window.cancelAnimationFrame(secondFrameId)
    }
  }, [articles.length, isTrackTransitionEnabled])

  if (articles.length === 0) {
    return null
  }

  function pauseAutoSlide(): void {
    pauseUntilRef.current = Date.now() + MINI_CAROUSEL_INTERVAL_MS
  }

  function moveSlide(step: number): void {
    pauseAutoSlide()
    setActiveIndex((current) => current + step)
  }

  function handleDragStart(clientX: number): void {
    dragStartXRef.current = clientX
    dragDeltaXRef.current = 0
    suppressClickRef.current = false
    pauseAutoSlide()
  }

  function handleDragMove(clientX: number): void {
    if (dragStartXRef.current === null) {
      return
    }
    dragDeltaXRef.current = clientX - dragStartXRef.current
  }

  function handleDragEnd(): void {
    if (dragStartXRef.current === null) {
      return
    }
    suppressClickRef.current = Math.abs(dragDeltaXRef.current) >= SLIDE_DRAG_THRESHOLD_PX
    if (dragDeltaXRef.current <= -SLIDE_DRAG_THRESHOLD_PX) {
      moveSlide(1)
    } else if (dragDeltaXRef.current >= SLIDE_DRAG_THRESHOLD_PX) {
      moveSlide(-1)
    }
    dragStartXRef.current = null
    dragDeltaXRef.current = 0
  }

  return (
    <section className="public-mini-carousel-shell">
      <div
        className="public-mini-carousel-viewport"
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          handleDragStart(event.clientX)
        }}
        onPointerMove={(event) => handleDragMove(event.clientX)}
        onPointerUp={() => handleDragEnd()}
        onPointerCancel={() => handleDragEnd()}
      >
        <div
          className="public-mini-carousel-track"
          onTransitionEnd={() => {
            if (articles.length <= 1) {
              return
            }
            if (activeIndex >= articles.length && activeIndex < articles.length * 2) {
              return
            }
            setIsTrackTransitionEnabled(false)
            setActiveIndex(getLoopedSlideIndex(activeIndex, articles.length) + articles.length)
          }}
          style={{
            transform: `translateX(calc(var(--public-mini-card-center-offset, 0px) - 1 * ${activeIndex} * var(--public-mini-card-step)))`,
            transition: isTrackTransitionEnabled ? undefined : 'none',
          }}
        >
          {repeatedArticles.map((article, index) => {
            const isInitialVisible = index >= articles.length && index < articles.length + eagerCount
            return (
              <Link
                key={`${article.id}-${index}`}
                className="public-mini-carousel-card"
                to={article.path}
                onClickCapture={(event) => {
                  if (suppressClickRef.current) {
                    event.preventDefault()
                    event.stopPropagation()
                    suppressClickRef.current = false
                  }
                }}
              >
                <div className="public-mini-carousel-thumb-wrap">
                  <img
                    className="public-mini-carousel-thumb"
                    src={article.thumbnail_url}
                    alt={article.title}
                    width={1200}
                    height={630}
                    draggable={false}
                    loading={isInitialVisible ? 'eager' : 'lazy'}
                    decoding="async"
                  />
                  <span className="public-mini-carousel-label">{article.category.name}</span>
                </div>
                <p className="public-mini-carousel-title">{article.title}</p>
              </Link>
            )
          })}
        </div>
      </div>

      {moreTo ? (
        <div className="public-home-more-wrap public-carousel-more-wrap">
          <Link className="public-home-more-link" to={moreTo}>
            もっと見る
            <i className="bi bi-arrow-right-short" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      <div className="public-popular-dots" aria-label="人気記事カルーセル">
        {articles.map((article, index) => (
          <button
            key={article.id}
            type="button"
            className={`public-popular-dot ${index === currentDotIndex ? 'is-active' : ''}`}
            onClick={() => {
              pauseAutoSlide()
              setActiveIndex(index + articles.length)
            }}
            aria-label={`${index + 1}件目の記事へ移動`}
          />
        ))}
      </div>
    </section>
  )
}

function PublicArticleSection({
  title,
  articles,
  to,
  heroFirst = false,
}: {
  title: string
  articles: PublicArticleSummary[]
  to: string
  heroFirst?: boolean
}) {
  return (
    <section className="public-section">
      <div className="public-article-section-head">
        <div>
          <p className="public-section-kicker">Stories</p>
          <h2 className="public-section-title">{title}</h2>
        </div>
        <Link className="public-more-link" to={to}>
          一覧へ
          <i className="bi bi-arrow-right-short" aria-hidden="true" />
        </Link>
      </div>
      <div className={`public-card-grid ${heroFirst ? 'has-hero' : ''}`}>
        {articles.map((article, index) => (
          <PublicArticleCard
            key={article.id}
            article={article}
            variant={heroFirst && index === 0 ? 'hero' : 'standard'}
            eager={heroFirst && index === 0}
          />
        ))}
      </div>
    </section>
  )
}

function PublicAuthorArchiveProfile({
  author,
}: {
  author: PublicAuthorSummary
}) {
  const authorProfile = author.profile?.trim() ?? ''
  const authorProfileParagraphs = buildProfileTextParagraphs(authorProfile)
  const hasAuthorHeaderImage = author.header_image !== null

  return (
    <section className="public-author-archive-profile">
      <div
        className={`public-author-archive-card${hasAuthorHeaderImage ? ' has-header-image' : ''}`}
      >
        {hasAuthorHeaderImage ? (
          <div className="public-author-archive-header-frame">
            <img
              className="public-author-archive-header"
              src={author.header_image}
              alt=""
              width={1260}
              height={540}
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : null}
        <div className="public-author-archive-main">
          {author.icon ? (
            <img
              className="public-author-archive-icon"
              src={author.icon}
              alt={author.display_name}
              width={72}
              height={72}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="public-author-archive-icon public-author-archive-icon-fallback">
              {author.display_name.charAt(0)}
            </span>
          )}
          <div className="public-author-archive-copy">
            <h2 className="public-author-archive-name">{author.display_name}</h2>
            {authorProfileParagraphs.length > 0 ? (
              <PublicProfileTextBlock
                paragraphs={authorProfileParagraphs}
                className="public-author-archive-text"
              />
            ) : null}
            <PublicProfileSocialLinks
              profile={author}
              className="public-author-archive-social-links"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function PublicDetailAuthorPanel({ article }: { article: PublicArticleBody }) {
  const authorProfile = article.author.profile?.trim() ?? ''
  const authorProfileParagraphs = buildProfileTextParagraphs(authorProfile)
  const hasAuthorHeaderImage = article.author.header_image !== null

  return (
    <section className="public-detail-side-block public-detail-author-panel">
      <p className="public-detail-side-kicker">Author</p>
      <h2>この記事を書いたひと</h2>
      <div
        className={`public-detail-author-card${hasAuthorHeaderImage ? ' has-header-image' : ''}`}
      >
        {hasAuthorHeaderImage ? (
          <div className="public-detail-author-header-frame">
            <img
              className="public-detail-author-header"
              src={article.author.header_image}
              alt=""
              width={1260}
              height={540}
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : null}
        <div className="public-detail-author-main">
          {article.author.icon ? (
            <img
              className="public-detail-author-icon"
              src={article.author.icon}
              alt={article.author.display_name}
              width={72}
              height={72}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span className="public-detail-author-icon public-detail-author-icon-fallback">
              {article.author.display_name.charAt(0)}
            </span>
          )}
          <div className="public-detail-author-copy">
            <h2>{article.author.display_name}</h2>
            {authorProfileParagraphs.length > 0 ? (
              <PublicProfileTextBlock
                paragraphs={authorProfileParagraphs}
                className="public-detail-author-text"
              />
            ) : null}
          </div>
        </div>
        <div className="public-detail-author-footer">
          <PublicProfileSocialLinks
            profile={article.author}
            className="public-detail-author-social-links"
          />
          <Link className="public-detail-author-link" to={`/search?author_id=${article.author.id}`}>
            この著者の記事
            <i className="bi bi-arrow-right-short" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}

function PublicDetailRelatedList({
  articles,
}: {
  articles: PublicArticleSummary[]
}) {
  if (articles.length === 0) {
    return null
  }

  return (
    <section className="public-detail-side-block public-detail-related-panel">
      <p className="public-detail-side-kicker">Related</p>
      <h2>関連記事</h2>
      <div className="public-detail-related-list">
        {articles.map((article) => (
          <Link key={article.id} className="public-detail-related-item" to={article.path}>
            <div className="public-detail-related-thumb-frame">
              <img
                className="public-detail-related-thumb"
                src={article.thumbnail_url}
                alt={article.title}
                width={160}
                height={120}
                loading="lazy"
                decoding="async"
              />
            </div>
            <span>{article.title}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function PublicCategoryTreeNode({
  category,
  depth,
}: {
  category: PublicCategoryTreeItem
  depth: number
}) {
  const iconClassName = depth === 0 ? 'bi-folder-fill' : 'bi-chevron-right'

  return (
    <li className={`public-sidebar-category-item is-open is-depth-${Math.min(depth, 2)}`}>
      <div className="public-sidebar-category-row">
        <span className="public-sidebar-category-icon" aria-hidden="true">
          <i className={`bi ${iconClassName}`} aria-hidden="true" />
        </span>
        <Link className="public-sidebar-category-link" to={category.path}>
          <span className="public-sidebar-category-name">
            {category.name}
            <span className="public-sidebar-category-count">
              ({category.article_count})
            </span>
          </span>
        </Link>
      </div>
      {category.children.length > 0 ? (
        <div className="public-sidebar-category-collapse">
          <div className="public-sidebar-category-collapse-inner">
            <ul className="public-sidebar-category-tree">
              {category.children.map((childCategory) => (
                <PublicCategoryTreeNode
                  key={childCategory.id}
                  category={childCategory}
                  depth={depth + 1}
                />
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function PublicCategoryTree({ categories }: { categories: PublicCategoryTreeItem[] }) {
  if (categories.length === 0) {
    return null
  }

  return (
    <ul className="public-sidebar-category-tree is-root">
      {categories.map((category) => (
        <PublicCategoryTreeNode
          key={category.id}
          category={category}
          depth={0}
        />
      ))}
    </ul>
  )
}

function PublicHomeDesktopLower({
  searchText,
  onSearchTextChange,
  latestPayload,
  latestMoreTo,
  sidebar,
  eagerCount,
  showSearch,
}: {
  searchText: string
  onSearchTextChange: (value: string) => void
  latestPayload: PublicArticleListResponse | null
  latestMoreTo: string
  sidebar: PublicSidebarResponse | null
  eagerCount: number
  showSearch: boolean
}) {
  const articles = latestPayload?.items ?? []
  const profileMetaEntries = sidebar === null ? [] : Object.entries(sidebar.profile.meta)
  const profileTextParagraphs = sidebar === null
    ? []
    : buildProfileTextParagraphs(sidebar.profile.profile)

  return (
    <section className="public-home-lower row g-4">
      <div className="col-lg-8">
        <section className="public-home-latest-panel">
          <div className="public-home-latest-head">
            <div>
              <p className="public-section-kicker">New Articles</p>
              <h2 className="public-home-latest-title">新着記事</h2>
            </div>
            {showSearch ? (
              <label className="public-home-search-field">
                <i className="bi bi-search" aria-hidden="true" />
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => onSearchTextChange(event.target.value)}
                  placeholder="記事タイトルから検索"
                  aria-label="新着記事を検索"
                />
              </label>
            ) : null}
          </div>
          <div className="public-home-latest-grid">
            {articles.map((article, index) => (
              <PublicArticleCard
                key={article.id}
                article={article}
                variant="compact"
                eager={index < eagerCount}
              />
            ))}
          </div>
          {latestPayload !== null ? (
            <div className="public-home-more-wrap public-home-latest-more-wrap">
              <Link className="public-home-more-link" to={latestMoreTo}>
                もっと見る
                <i className="bi bi-arrow-right-short" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="col-lg-4">
        {sidebar !== null ? (
          <div className="public-home-sidebar">
            <div className="public-profile-home-panel">
              <div className="public-home-latest-head public-home-carousel-head public-profile-mobile-head">
                <p className="public-section-kicker">PROFILE</p>
                <h2 className="public-home-latest-title">プロフィール</h2>
              </div>
              <section className="public-sidebar-block public-profile-block">
                <div className="public-profile-header">
                  <img
                    className="public-profile-header-image"
                    src={sidebar.profile.header_image ?? ''}
                    alt=""
                    width={1260}
                    height={540}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="public-profile-body">
                  {sidebar.profile.icon !== null ? (
                    <img
                      className="public-profile-icon"
                      src={sidebar.profile.icon}
                      alt={sidebar.profile.display_name}
                      width={72}
                      height={72}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                  <div className="public-profile-copy">
                    <p className="public-sidebar-kicker">Profile</p>
                    <h2 className="public-sidebar-title">{sidebar.profile.display_name}</h2>
                    <PublicProfileTextBlock
                      paragraphs={profileTextParagraphs}
                      className="public-profile-text"
                    />
                    {profileMetaEntries.length > 0 ? (
                      <dl className="public-profile-meta-list">
                        {profileMetaEntries.map(([key, value]) => (
                          <div key={key} className="public-profile-meta-item">
                            <dt>{key}:</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>
                </div>
                <div className="public-home-more-wrap public-profile-more-wrap">
                  <PublicProfileSocialLinks profile={sidebar.profile} />
                  <Link
                    className="public-home-more-link"
                    to={PUBLIC_ADMINISTRATOR_SELF_INTRODUCTION_PATH}
                  >
                    もっと見る
                    <i className="bi bi-arrow-right-short" aria-hidden="true" />
                  </Link>
                </div>
              </section>
            </div>

            <section className="public-sidebar-block public-category-block">
              <div className="public-sidebar-section-head">
                <h2 className="public-sidebar-section-title">カテゴリー</h2>
              </div>
              <PublicCategoryTree categories={sidebar.category_tree} />
            </section>

            <section className="public-sidebar-block public-tag-block">
              <div className="public-sidebar-section-head">
                <h2 className="public-sidebar-section-title">タグ</h2>
              </div>
              <div className="public-sidebar-chip-cloud">
                {sidebar.tags.map((tag) => (
                  <Link key={tag.id} className="public-sidebar-chip" to={tag.path}>
                    #{tag.name}
                  </Link>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </section>
  )
}

function PublicPaginationControls({
  page,
  totalPages,
  onMove,
}: {
  page: number
  totalPages: number
  onMove: (page: number) => void
}) {
  if (totalPages <= 1) {
    return null
  }

  const pageItems: Array<number | 'ellipsis'> = []
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const shouldShow =
      pageNumber === 1 ||
      pageNumber === totalPages ||
      Math.abs(pageNumber - page) <= 1

    if (shouldShow) {
      pageItems.push(pageNumber)
      continue
    }

    if (pageItems[pageItems.length - 1] !== 'ellipsis') {
      pageItems.push('ellipsis')
    }
  }

  return (
    <nav className="public-pagination-wrap" aria-label="ページネーション">
      <button
        type="button"
        className="public-page-button public-page-nav-button"
        onClick={() => onMove(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="前のページ"
      >
        <i className="bi bi-chevron-left" aria-hidden="true" />
      </button>
      <div className="public-page-number-list">
        {pageItems.map((pageItem, index) => {
          if (pageItem === 'ellipsis') {
            return (
              <span key={`ellipsis-${index}`} className="public-page-ellipsis" aria-hidden="true">
                …
              </span>
            )
          }

          return (
            <button
              key={pageItem}
              type="button"
              className={`public-page-number ${pageItem === page ? 'is-active' : ''}`}
              onClick={() => onMove(pageItem)}
              aria-current={pageItem === page ? 'page' : undefined}
            >
              {pageItem}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="public-page-button public-page-nav-button"
        onClick={() => onMove(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        aria-label="次のページ"
      >
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </button>
    </nav>
  )
}

function usePublicArticleList(params: PublicArticleListParams) {
  const [payload, setPayload] = useState<PublicArticleListResponse | null>(null)
  const [errorPath, setErrorPath] = useState('')
  const requestKey = JSON.stringify(params)

  useEffect(() => {
    let active = true

    async function load(): Promise<void> {
      try {
        const nextPayload = await listPublicArticles(params)
        if (!active) {
          return
        }
        startTransition(() => {
          setPayload(nextPayload)
          setErrorPath('')
        })
      } catch (error) {
        if (!active) {
          return
        }
        startTransition(() => {
          setErrorPath(resolvePublicErrorPath(error))
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [requestKey])

  return { payload, errorPath }
}

function usePublicSidebarPayload() {
  const [sidebar, setSidebar] = useState<PublicSidebarResponse | null>(null)
  const [errorPath, setErrorPath] = useState('')

  useEffect(() => {
    let active = true

    async function load(): Promise<void> {
      try {
        const nextSidebar = await fetchPublicSidebar()
        if (!active) {
          return
        }
        startTransition(() => {
          setSidebar(nextSidebar)
          setErrorPath('')
        })
      } catch (error) {
        if (!active) {
          return
        }
        startTransition(() => {
          setErrorPath(resolvePublicErrorPath(error))
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [])

  return { sidebar, errorPath }
}

function findPublicCategoryBySlug(
  categories: PublicCategoryTreeItem[],
  slug: string,
): PublicCategoryTreeItem | null {
  for (const category of categories) {
    if (category.slug === slug) {
      return category
    }
    const childCategory = findPublicCategoryBySlug(category.children, slug)
    if (childCategory !== null) {
      return childCategory
    }
  }
  return null
}

function PublicHeroVisual({ animationKey }: { animationKey: string }) {
  const [heroMessage] = useState(
    () => PUBLIC_HERO_MESSAGES[Math.floor(Math.random() * PUBLIC_HERO_MESSAGES.length)],
  )
  const heroTitleCharacters = Array.from('気ままに、機材と写真を楽しむブログ。')
  const heroTextLabel = heroMessage.join('\n')

  return (
    <>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-hero-kicker">Weekend Camera</p>
          <h1 className="public-hero-title" aria-label="気ままに、機材と写真を楽しむブログ。">
            {heroTitleCharacters.map((character, index) => (
              <Fragment key={`${animationKey}-plain-${character}-${index}`}>
                <span
                  className="public-hero-title-char"
                  style={{ ['--hero-char-delay' as string]: `${index * 38}ms` }}
                  aria-hidden="true"
                >
                  {character}
                </span>
                {index === 4 ? <br className="public-hero-mobile-break" aria-hidden="true" /> : null}
              </Fragment>
            ))}
          </h1>
          <p className="public-hero-text">
            {heroMessage.map((line, index) => (
              <span key={line}>
                {index > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
        </div>
      </section>

      <section className="public-photo-hero">
        <img
          className="public-photo-hero-image"
          src={publicHeroPhoto}
          alt="週末カメラのメインビジュアル"
          width={1458}
          height={980}
          decoding="async"
        />
        <div className="public-photo-hero-overlay">
          <h1 className="public-hero-title" aria-label="気ままに、機材と写真を楽しむブログ。">
            {heroTitleCharacters.map((character, index) => (
              <Fragment key={`${animationKey}-photo-${character}-${index}`}>
                <span
                  className="public-hero-title-char"
                  style={{ ['--hero-char-delay' as string]: `${index * 38}ms` }}
                  aria-hidden="true"
                >
                  {character}
                </span>
                {index === 4 ? <br className="public-hero-mobile-break" aria-hidden="true" /> : null}
              </Fragment>
            ))}
          </h1>
          <span className="public-photo-hero-rule" aria-hidden="true" />
          <p className="public-photo-hero-text" aria-label={heroTextLabel}>
            {heroMessage.map((line, lineIndex) => (
              <span key={`desktop-${line}`} aria-hidden="true">
                {lineIndex > 0 ? <br /> : null}
                {Array.from(line).map((character, characterIndex) => (
                  <span
                    key={`${animationKey}-text-${lineIndex}-${character}-${characterIndex}`}
                    className="public-photo-hero-text-char"
                    style={{
                      ['--hero-text-char-delay' as string]: `${lineIndex * 110 + characterIndex * 18}ms`,
                    }}
                  >
                    {character}
                  </span>
                ))}
              </span>
            ))}
          </p>
        </div>
      </section>
    </>
  )
}

export function PublicHomePage() {
  const isMobileViewport = usePublicMobileViewport()
  const { sidebar, errorPath: sidebarErrorPath } = usePublicSidebarPayload()
  const [homeSearchText, setHomeSearchText] = useState('')
  const [homeSearchQuery, setHomeSearchQuery] = useState('')
  const homeSearchPageSize = isMobileViewport ? HOME_MOBILE_SEARCH_PAGE_SIZE : HOME_SEARCH_PAGE_SIZE
  const popularCarouselEagerCount = isMobileViewport ? 1 : 2
  const latestArticleEagerCount = isMobileViewport ? 1 : 3
  const homeEffectiveSearchQuery = isMobileViewport ? '' : homeSearchQuery
  const popularState = usePublicArticleList({
    ordering: 'popular',
    page: 1,
    limit: HOME_SECTION_SIZE,
  })
  const searchState = usePublicArticleList({
    ordering: 'newest',
    page: 1,
    limit: homeSearchPageSize,
    q: homeEffectiveSearchQuery,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setHomeSearchQuery(homeSearchText)
      })
    }, HOME_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [homeSearchText])

  if (popularState.errorPath !== '') {
    return <Navigate to={popularState.errorPath} replace />
  }
  if (searchState.errorPath !== '') {
    return <Navigate to={searchState.errorPath} replace />
  }
  if (sidebarErrorPath !== '') {
    return <Navigate to={sidebarErrorPath} replace />
  }

  const popularArticles = popularState.payload?.items ?? []
  const latestSearchKeyword = isMobileViewport ? '' : homeSearchText.trim()
  const latestMoreTo =
    latestSearchKeyword === ''
      ? '/articles/new/'
      : `/articles/new/?q=${encodeURIComponent(latestSearchKeyword)}`

  return (
    <main className="public-main is-home">
      <div className="public-home-carousel public-home-carousel-primary">
        <div className="public-home-latest-head public-home-carousel-head">
          <div>
            <p className="public-section-kicker">Popular Articles</p>
            <h2 className="public-home-latest-title">人気記事</h2>
          </div>
        </div>
        <PublicMiniArticleCarousel
          articles={popularArticles}
          eagerCount={popularCarouselEagerCount}
        />
      </div>
      <PublicHomeDesktopLower
        searchText={homeSearchText}
        onSearchTextChange={setHomeSearchText}
        latestPayload={searchState.payload}
        latestMoreTo={latestMoreTo}
        sidebar={sidebar}
        eagerCount={latestArticleEagerCount}
        showSearch={!isMobileViewport}
      />
    </main>
  )
}

function PublicListPage({
  title,
  description,
  params,
  mobileTwoColumnCards = false,
  resolveTitle,
}: {
  title: string
  description: string
  params: PublicArticleListParams
  mobileTwoColumnCards?: boolean
  resolveTitle?: (payload: PublicArticleListResponse | null) => string
}) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Number(searchParams.get('page') ?? '1')
  const searchKeyword = searchParams.get('q') ?? ''
  const [archiveSearchText, setArchiveSearchText] = useState(searchKeyword)
  const { payload, errorPath } = usePublicArticleList({
    ...params,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: PUBLIC_PAGE_SIZE,
    q: searchKeyword,
  })

  useEffect(() => {
    setArchiveSearchText(searchKeyword)
  }, [searchKeyword])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = archiveSearchText.trim()
      if (normalized === searchKeyword) {
        return
      }

      const next = new URLSearchParams(location.search)
      if (normalized === '') {
        next.delete('q')
      } else {
        next.set('q', normalized)
      }
      next.delete('page')
      setSearchParams(next, { replace: true })
    }, HOME_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [archiveSearchText, location.search, searchKeyword, setSearchParams])

  useEffect(() => {
    applyPublicPageMeta({
      title,
      description,
      path: `${location.pathname}${location.search}`,
    })
  }, [description, location.pathname, location.search, title])

  if (errorPath !== '') {
    return <Navigate to={errorPath} replace />
  }

  const displayTitle = resolveTitle ? resolveTitle(payload) : title
  const cardGridClassName = `public-card-grid is-archive-four${
    mobileTwoColumnCards ? ' is-mobile-two-column' : ''
  }`

  return (
    <main className="public-main">
      <div className="public-archive-head">
        <div>
          <p className="public-section-kicker">Archive</p>
          <h1 className="public-home-latest-title">{displayTitle}</h1>
        </div>
        <label className="public-home-search-field">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            type="search"
            value={archiveSearchText}
            onChange={(event) => setArchiveSearchText(event.target.value)}
            placeholder="記事タイトルから検索"
            aria-label={`${displayTitle}を検索`}
          />
        </label>
      </div>

      {payload ? (
        <>
          <div className={cardGridClassName}>
            {payload.items.map((article, index) => (
              <PublicArticleCard
                key={article.id}
                article={article}
                eager={index === 0}
                showSupplement={false}
              />
            ))}
          </div>
          <PublicPaginationControls
            page={payload.pagination.page}
            totalPages={payload.pagination.total_pages}
            onMove={(nextPage) => {
              const next = new URLSearchParams(searchParams)
              next.set('page', String(nextPage))
              setSearchParams(next)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        </>
      ) : null}
    </main>
  )
}

export function PublicNewestArticlesPage() {
  return (
    <PublicListPage
      title="新着記事"
      description="公開した順に、最新のカメラレビューと写真記録を並べています。"
      params={{ ordering: 'newest' }}
      mobileTwoColumnCards
    />
  )
}

export function PublicPopularArticlesPage() {
  return (
    <PublicListPage
      title="人気記事"
      description="PV順でよく読まれている記事をまとめています。"
      params={{ ordering: 'popular' }}
      mobileTwoColumnCards
    />
  )
}

export function PublicCategoryArticlesPage() {
  const { categorySlug = '' } = useParams()
  const { sidebar, errorPath } = usePublicSidebarPayload()
  const category =
    sidebar === null ? null : findPublicCategoryBySlug(sidebar.category_tree, categorySlug)

  if (errorPath !== '') {
    return <Navigate to={errorPath} replace />
  }

  return (
    <PublicListPage
      title={category?.name ?? 'カテゴリー'}
      description="このカテゴリーと配下カテゴリーの記事をまとめて表示しています。"
      params={{
        ordering: 'newest',
        category_slug: categorySlug,
      }}
    />
  )
}

export function PublicTagArticlesPage() {
  const { tagSlug = '' } = useParams()
  const { sidebar, errorPath } = usePublicSidebarPayload()
  const tag = sidebar?.tags.find((item) => item.slug === tagSlug) ?? null

  if (errorPath !== '') {
    return <Navigate to={errorPath} replace />
  }

  return (
    <PublicListPage
      title={tag === null ? 'タグ' : `# ${tag.name}`}
      description="このタグが付いた記事を公開順に表示しています。"
      params={{
        ordering: 'newest',
        tag_slug: tagSlug,
      }}
    />
  )
}

export function PublicSearchPage() {
  const [searchParams] = useSearchParams()
  const keyword = searchParams.get('q') ?? ''
  const authorId = searchParams.get('author_id') ?? ''
  const isAuthorFiltered = authorId.trim() !== ''

  return (
    <PublicListPage
      title={isAuthorFiltered ? 'この著者が書いた記事' : '検索結果'}
      description={
        isAuthorFiltered
          ? 'この著者が公開している記事を表示しています。'
          : (
            keyword.trim() === ''
              ? '検索条件に一致する記事を表示します。'
              : `「${keyword.trim()}」に一致する記事を表示しています。`
          )
      }
      params={{
        q: keyword,
        author_id: authorId === '' ? undefined : authorId,
        ordering: 'newest',
      }}
      mobileTwoColumnCards={isAuthorFiltered}
      resolveTitle={
        isAuthorFiltered
          ? (payload) => {
            const authorName = payload?.items[0]?.author.display_name?.trim() ?? ''
            if (authorName === '') {
              return 'この著者が書いた記事'
            }
            return `${authorName}が書いた記事`
          }
          : undefined
      }
    />
  )
}

export function PublicArticleDetailPage() {
  const { categorySlug = '', articleSlug = '' } = useParams()
  const location = useLocation()
  const [payload, setPayload] = useState<PublicArticleDetailResponse | null>(null)
  const [errorPath, setErrorPath] = useState('')

  useEffect(() => {
    let active = true

    async function load(): Promise<void> {
      try {
        const nextPayload = await fetchPublicArticleDetail(categorySlug, articleSlug)
        if (!active) {
          return
        }
        startTransition(() => {
          setPayload(nextPayload)
          setErrorPath('')
        })
        applyPublicPageMeta({
          title: nextPayload.article.title,
          description: nextPayload.article.summary,
          path: location.pathname,
          imageUrl: nextPayload.article.thumbnail_url,
          type: 'article',
          twitterCard: nextPayload.article.twitter_card,
        })
      } catch (error) {
        if (!active) {
          return
        }
        startTransition(() => {
          setErrorPath(resolvePublicErrorPath(error))
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [articleSlug, categorySlug, location.pathname])

  if (errorPath !== '') {
    return <Navigate to={errorPath} replace />
  }

  if (payload === null) {
    return <main className="public-main public-main-empty" />
  }

  const { article, related_articles: relatedArticles, cdn_base_url: cdnBaseUrl } = payload
  const categoryBreadcrumbSource = article.category_breadcrumb ?? []
  const categoryBreadcrumb = categoryBreadcrumbSource.length > 0
    ? categoryBreadcrumbSource
    : [article.category]
  const publishedAt = article.published_at
  const publishedDateParts = formatPublicDateParts(publishedAt)
  const headingPanelClassName = `public-detail-heading-panel${
    publishedDateParts === null ? ' without-date' : ''
  }`
  const detailOptionItems = article.article_option.items

  return (
    <main className="public-main public-article-detail-page">
      <div className="public-detail-grid row g-5">
        <aside className="public-detail-sidebar col-lg-4 order-2 order-lg-2">
          <PublicDetailAuthorPanel article={article} />
          <PublicDetailRelatedList articles={relatedArticles} />
        </aside>

        <div className="col-lg-8 order-1 order-lg-1">
          <article className="public-article-detail-shell">
            <header className="public-article-header">
              <nav className="public-detail-category-line" aria-label="カテゴリー階層">
                {categoryBreadcrumb.map((category, index) => (
                  <Fragment key={category.id}>
                    <Link to={category.path}>{category.name}</Link>
                    {index < categoryBreadcrumb.length - 1 ? <span>/</span> : null}
                  </Fragment>
                ))}
              </nav>

              <div className={headingPanelClassName}>
                {publishedAt !== null && publishedDateParts !== null ? (
                  <time
                    className="public-detail-posted-at"
                    dateTime={publishedAt}
                    aria-label={`投稿日 ${formatPublicDate(publishedAt)}`}
                  >
                    <span className="public-detail-posted-year">{publishedDateParts.year}</span>
                    <span className="public-detail-posted-month-day">
                      {publishedDateParts.monthDay}
                    </span>
                  </time>
                ) : null}

                <div className="public-detail-heading-copy">
                  <h1 className="public-detail-title">{article.title}</h1>
                  {article.tags.length > 0 ? (
                    <div className="public-detail-taxonomy">
                      <nav className="public-detail-tag-row" aria-label="タグ">
                        <i className="bi bi-tags" aria-hidden="true" />
                        {article.tags.map((tag) => (
                          <Link key={tag.id} className="public-detail-tag-link" to={`/tag/${tag.slug}/`}>
                            #{tag.name}
                          </Link>
                        ))}
                      </nav>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="public-detail-thumb-wrap">
                <img
                  className="public-detail-thumb"
                  src={article.thumbnail_url}
                  alt={article.title}
                  width={1200}
                  height={900}
                  loading="eager"
                  decoding="async"
                />
              </div>
            </header>

            <div className="public-article-layout">
              <PublicArticleBodyRenderer
                bodyHtml={article.body_html}
                cdnBaseUrl={cdnBaseUrl}
                ogpByUrl={article.ogp_by_url}
                articleOptions={detailOptionItems}
              />
            </div>
          </article>
        </div>
      </div>
    </main>
  )
}

function PublicContactSubjectDropdown({
  value,
  onChange,
}: {
  value: ContactSubjectType
  onChange: (value: ContactSubjectType) => void
}) {
  return (
    <select
      className="form-select public-contact-select"
      value={value}
      onChange={(event) => onChange(event.target.value as ContactSubjectType)}
      aria-label="問い合わせ種別"
    >
      <option value="review">レビュー依頼</option>
      <option value="blog">ブログ関連</option>
    </select>
  )
}

export function PublicContactPage() {
  const [form, setForm] = useState({
    subject_type: 'review' as ContactSubjectType,
    company_name: '',
    person_name: '',
    email: '',
    body: '',
  })
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState<unknown>('')
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileConfigError, setTurnstileConfigError] = useState('')
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let shouldIgnore = false

    async function loadSiteConfig(): Promise<void> {
      try {
        const siteConfig = await fetchPublicSiteConfig()
        if (shouldIgnore) {
          return
        }
        setTurnstileSiteKey(siteConfig.turnstile_site_key)
        setTurnstileConfigError('')
      } catch {
        if (!shouldIgnore) {
          setTurnstileConfigError('Turnstile の設定取得に失敗しました。')
        }
      }
    }

    void loadSiteConfig()

    return () => {
      shouldIgnore = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage('')
    setErrorMessage('')
    if (turnstileSiteKey === '') {
      setErrorMessage(turnstileConfigError || 'Turnstile の読み込み完了後に送信してください。')
      return
    }
    if (turnstileToken === '') {
      setErrorMessage('Turnstile の認証を完了してください。')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await submitPublicContact({
        ...form,
        turnstile_token: turnstileToken,
      })
      setMessage(response.message)
      setForm({
        subject_type: 'review',
        company_name: '',
        person_name: '',
        email: '',
        body: '',
      })
    } catch (error) {
      setErrorMessage(error)
    } finally {
      setIsSubmitting(false)
      setTurnstileToken('')
      setTurnstileResetSignal((current) => current + 1)
    }
  }

  return (
    <main className="public-main">
      <section className="public-contact-shell">
        <p className="public-section-kicker">Contact</p>
        <h1 className="public-collection-title">お問い合わせ</h1>

        <form className="public-contact-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="public-contact-grid">
            <label className="public-contact-field">
              <span className="public-contact-label">種別</span>
              <PublicContactSubjectDropdown
                value={form.subject_type}
                onChange={(value) => setForm((current) => ({ ...current, subject_type: value }))}
              />
            </label>
            <label className="public-contact-field">
              <span className="public-contact-label">会社名</span>
              <input
                className="form-control public-contact-input"
                type="text"
                value={form.company_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    company_name: event.target.value,
                  }))
                }
              />
            </label>
            <label className="public-contact-field">
              <span className="public-contact-label">お名前</span>
              <input
                className="form-control public-contact-input"
                type="text"
                value={form.person_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    person_name: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="public-contact-field">
              <span className="public-contact-label">メールアドレス</span>
              <input
                className="form-control public-contact-input"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </label>
          </div>
          <label className="public-contact-field">
            <span className="public-contact-label">本文</span>
            <textarea
              className="form-control public-contact-textarea"
              value={form.body}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  body: event.target.value,
                }))
              }
              required
            />
          </label>
          {turnstileSiteKey !== '' ? (
            <PublicTurnstileWidget
              siteKey={turnstileSiteKey}
              resetSignal={turnstileResetSignal}
              onTokenChange={setTurnstileToken}
            />
          ) : (
            <p className="public-contact-turnstile-message">
              {turnstileConfigError || 'Turnstile を読み込んでいます。'}
            </p>
          )}
          {message !== '' ? <p className="public-contact-success">{message}</p> : null}
          <button
            type="submit"
            className="public-contact-submit"
            disabled={isSubmitting || turnstileSiteKey === '' || turnstileToken === ''}
          >
            {isSubmitting ? '送信中' : '送信する'}
          </button>
          <ApiErrorPopup error={errorMessage} onClose={() => setErrorMessage('')} />
        </form>
      </section>
    </main>
  )
}

export function PublicNotFoundPage() {
  useEffect(() => {
    applyPublicPageMeta({
      title: '404',
      description: 'ページが見つかりませんでした。',
      path: '/error/404',
    })
  }, [])

  return (
    <main className="public-main">
      <section className="public-error-shell">
        <p className="public-section-kicker">404</p>
        <h1 className="public-collection-title">ページが見つかりませんでした</h1>
        <Link className="public-hero-button" to="/">
          トップへ戻る
        </Link>
      </section>
    </main>
  )
}

export function PublicServerErrorPage() {
  useEffect(() => {
    applyPublicPageMeta({
      title: '500',
      description: 'ページの表示に失敗しました。',
      path: '/error/500',
    })
  }, [])

  return (
    <main className="public-main">
      <section className="public-error-shell">
        <p className="public-section-kicker">500</p>
        <h1 className="public-collection-title">ページの表示に失敗しました</h1>
        <Link className="public-hero-button" to="/">
          トップへ戻る
        </Link>
      </section>
    </main>
  )
}

export function PublicLayout() {
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const currentYear = new Date().getFullYear()
  const isHomePath = location.pathname === '/'
  const heroAnimationKey = `${location.pathname}${location.search}`

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useLayoutEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'auto',
    })
  }, [location.hash, location.pathname, location.search])

  return (
    <div className="public-site-shell">
      <header className={`public-header ${isHomePath ? 'is-home' : 'is-subpage'}`}>
        <div className="public-header-inner">
          <button
            type="button"
            className="navbar-toggler public-navbar-toggler"
            onClick={() => {
              setMobileNavOpen((current) => !current)
            }}
            data-bs-toggle="offcanvas"
            data-bs-target="#publicOffcanvasNavbar"
            aria-controls="publicOffcanvasNavbar"
            aria-label="メニューを開閉"
            aria-expanded={mobileNavOpen}
          >
            <span className="navbar-toggler-icon" aria-hidden="true" />
          </button>
          <Link className="public-site-logo" to="/">
            <i className="bi bi-camera" aria-hidden="true" />
            <span>週末カメラ</span>
          </Link>
          <span className="public-header-spacer" aria-hidden="true" />
        </div>
        <PublicHeroVisual animationKey={heroAnimationKey} />
      </header>
      <div
        className={`public-nav-backdrop ${mobileNavOpen ? 'is-open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="publicOffcanvasNavbar"
        className={`public-mobile-nav ${mobileNavOpen ? 'is-open' : ''}`}
        tabIndex={-1}
        aria-labelledby="publicOffcanvasNavbarLabel"
      >
        <div className="public-mobile-nav-head">
          <p id="publicOffcanvasNavbarLabel" className="public-mobile-nav-title">MENU</p>
        </div>
        <Link className="public-mobile-nav-link" to="/" onClick={() => setMobileNavOpen(false)}>
          <span>トップ</span>
        </Link>
        <Link
          className="public-mobile-nav-link"
          to="/articles/new/"
          onClick={() => setMobileNavOpen(false)}
        >
          <span>新着記事</span>
        </Link>
        <Link
          className="public-mobile-nav-link"
          to="/articles/popular/"
          onClick={() => setMobileNavOpen(false)}
        >
          <span>人気記事</span>
        </Link>
        <Link
          className="public-mobile-nav-link"
          to="/contact"
          onClick={() => setMobileNavOpen(false)}
        >
          <span>お問い合わせ</span>
        </Link>
        <Link
          className="public-mobile-nav-link"
          to={PUBLIC_PRIVACY_POLICY_PATH}
          onClick={() => setMobileNavOpen(false)}
        >
          <span>プライバシーポリシー</span>
        </Link>
        <Link
          className="public-mobile-nav-link"
          to={PUBLIC_ADMINISTRATOR_SELF_INTRODUCTION_PATH}
          onClick={() => setMobileNavOpen(false)}
        >
          <span>自己紹介</span>
        </Link>
      </aside>

      <Outlet />

      <footer className="public-footer">
        <p className="public-footer-copyright">
          © {currentYear} 週末カメラ
        </p>
        <p className="public-footer-copy">
          気ままに、機材と写真を楽しむブログ
        </p>
        <nav className="public-footer-links" aria-label="フッターリンク">
          <Link to="/">ホーム</Link>
          <span aria-hidden="true">|</span>
          <Link to="/contact">お問い合わせ</Link>
          <span aria-hidden="true">|</span>
          <Link to={PUBLIC_PRIVACY_POLICY_PATH}>プライバシーポリシー</Link>
          <span aria-hidden="true">|</span>
          <Link to={PUBLIC_ADMINISTRATOR_SELF_INTRODUCTION_PATH}>自己紹介</Link>
        </nav>
      </footer>
    </div>
  )
}
