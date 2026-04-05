import { FormEvent, startTransition, useEffect, useRef, useState } from 'react'
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchPublicArticleDetail, listPublicArticles, submitPublicContact } from './api'
import { PublicArticleBodyRenderer } from './articleBody'
import type {
  ContactSubjectType,
  PublicArticleDetailResponse,
  PublicArticleListParams,
  PublicArticleListResponse,
  PublicArticleSummary,
} from './types'

const PUBLIC_PAGE_SIZE = 9
const HOME_SECTION_SIZE = 6
const PUBLIC_SITE_NAME = '週末カメラ'
const PUBLIC_SITE_DESCRIPTION = '気ままに、機材と写真を楽しむブログ'
const POPULAR_SLIDE_INTERVAL_MS = 6200
const MINI_CAROUSEL_INTERVAL_MS = 3600
const SLIDE_DRAG_THRESHOLD_PX = 48
const PUBLIC_HERO_MESSAGES = [
  '沼ってますか？\nカメラやレンズのこと、写真を撮る楽しさを気ままにつづっていくブログです。',
  'その一本、本当に最後ですか？\n読みに来たつもりが、欲しくなっちゃうかもしれません。',
  '見に来ただけのはずが、欲しくなっちゃうかも。\n機材のことも、写真を撮る楽しさも、気ままにつづっていくブログです。',
  '予算ってなんですか？\n欲しいものが、いつのまにか予算になっていくんです。',
  '防湿庫のスペース、まだ余ってますか？\n欲しい理由を、一緒に増やしていきませんか。',
]

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
  const absoluteUrl = `${window.location.origin}${path}`
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
  if (imageUrl !== undefined) {
    upsertMetaTag('meta[property="og:image"]', {
      property: 'og:image',
      content: imageUrl,
    })
    upsertMetaTag('meta[name="twitter:image"]', {
      name: 'twitter:image',
      content: imageUrl,
    })
  }
}

function PublicArticleCard({
  article,
  variant = 'standard',
  eager = false,
}: {
  article: PublicArticleSummary
  variant?: 'hero' | 'standard' | 'compact'
  eager?: boolean
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
            fetchPriority={eager ? 'high' : 'auto'}
          />
          <span className="public-category-label">{article.category.name}</span>
        </div>
        <div className="public-article-card-body">
          <h2 className="public-article-card-title">{article.title}</h2>
          <p className="public-article-card-summary">{article.summary}</p>
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

function getRelativeSlideOffset(index: number, activeIndex: number, length: number): number {
  if (length <= 1) {
    return 0
  }

  let offset = index - activeIndex
  const half = length / 2
  if (offset > half) {
    offset -= length
  }
  if (offset < -half) {
    offset += length
  }
  return offset
}

function PublicPopularShowcase({ articles }: { articles: PublicArticleSummary[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const dragStartXRef = useRef<number | null>(null)
  const dragDeltaXRef = useRef(0)
  const pauseUntilRef = useRef(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [articles])

  useEffect(() => {
    if (articles.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current) {
        return
      }
      setActiveIndex((current) => getLoopedSlideIndex(current + 1, articles.length))
    }, POPULAR_SLIDE_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [articles.length])

  if (articles.length === 0) {
    return null
  }

  function pauseAutoSlide(): void {
    pauseUntilRef.current = Date.now() + POPULAR_SLIDE_INTERVAL_MS
  }

  function moveSlide(step: number): void {
    pauseAutoSlide()
    setActiveIndex((current) => getLoopedSlideIndex(current + step, articles.length))
  }

  function handleDragStart(clientX: number): void {
    dragStartXRef.current = clientX
    dragDeltaXRef.current = 0
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
    if (dragDeltaXRef.current <= -SLIDE_DRAG_THRESHOLD_PX) {
      moveSlide(1)
    } else if (dragDeltaXRef.current >= SLIDE_DRAG_THRESHOLD_PX) {
      moveSlide(-1)
    }
    dragStartXRef.current = null
    dragDeltaXRef.current = 0
  }

  return (
    <section className="public-popular-showcase">
      <div className="public-section-head">
        <div>
          <p className="public-section-kicker">Popular</p>
          <h2 className="public-section-title">人気記事</h2>
        </div>
        <Link className="public-more-link" to="/articles/popular/">
          一覧へ
          <i className="bi bi-arrow-right-short" aria-hidden="true" />
        </Link>
      </div>

      <div
        className="public-popular-slider"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          handleDragStart(event.clientX)
        }}
        onPointerMove={(event) => handleDragMove(event.clientX)}
        onPointerUp={() => handleDragEnd()}
        onPointerCancel={() => handleDragEnd()}
      >
        <div className="public-popular-stage">
          {articles.map((article, index) => {
            const offset = getRelativeSlideOffset(index, activeIndex, articles.length)
            const isVisible = Math.abs(offset) <= 1
            const depth = Math.abs(offset)
            const slideClassName = [
              'public-popular-slide',
              offset === 0 ? 'is-active' : '',
              Math.abs(offset) === 1 ? 'is-side' : '',
            ]
              .filter((className) => className !== '')
              .join(' ')

            return (
              <article
                key={article.id}
                className={slideClassName}
                aria-hidden={!isVisible}
                style={{
                  transform: `translateX(${offset * 30}%) translateY(${depth * 1.35}rem) scale(${1 - depth * 0.08}) rotateZ(${offset * -7}deg)`,
                  opacity: depth > 1 ? 0 : offset === 0 ? 1 : 0.42,
                  pointerEvents: offset === 0 ? 'auto' : 'none',
                  zIndex: 10 - depth,
                }}
              >
                <Link className="public-popular-card-link" to={article.path}>
                  <div className="public-popular-thumb-wrap">
                    <img
                      className="public-popular-thumb"
                      src={article.thumbnail_url}
                      alt={article.title}
                      width={1200}
                      height={630}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      fetchPriority={index === 0 ? 'high' : 'auto'}
                    />
                    <span className="public-category-label">{article.category.name}</span>
                  </div>
                  <div className="public-popular-copy">
                    <h3 className="public-popular-title">{article.title}</h3>
                    <p className="public-popular-summary">{article.summary}</p>
                  </div>
                </Link>
              </article>
            )
          })}
        </div>
      </div>

      <div className="public-popular-dots" aria-label="人気記事スライド">
        {articles.map((article, index) => (
          <button
            key={article.id}
            type="button"
            className={`public-popular-dot ${index === activeIndex ? 'is-active' : ''}`}
            onClick={() => {
              pauseAutoSlide()
              setActiveIndex(index)
            }}
            aria-label={`${index + 1}件目の記事へ移動`}
          />
        ))}
      </div>
    </section>
  )
}

function PublicMiniArticleCarousel({ articles }: { articles: PublicArticleSummary[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const dragStartXRef = useRef<number | null>(null)
  const dragDeltaXRef = useRef(0)
  const pauseUntilRef = useRef(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [articles])

  useEffect(() => {
    if (articles.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      if (Date.now() < pauseUntilRef.current) {
        return
      }
      setActiveIndex((current) => getLoopedSlideIndex(current + 1, articles.length))
    }, MINI_CAROUSEL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [articles.length])

  if (articles.length === 0) {
    return null
  }

  function pauseAutoSlide(): void {
    pauseUntilRef.current = Date.now() + MINI_CAROUSEL_INTERVAL_MS
  }

  function moveSlide(step: number): void {
    pauseAutoSlide()
    setActiveIndex((current) => getLoopedSlideIndex(current + step, articles.length))
  }

  function handleDragStart(clientX: number): void {
    dragStartXRef.current = clientX
    dragDeltaXRef.current = 0
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
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          handleDragStart(event.clientX)
        }}
        onPointerMove={(event) => handleDragMove(event.clientX)}
        onPointerUp={() => handleDragEnd()}
        onPointerCancel={() => handleDragEnd()}
      >
        <div
          className="public-mini-carousel-track"
          style={{
            transform: `translateX(calc(-1 * ${activeIndex} * var(--public-mini-card-step)))`,
          }}
        >
          {articles.map((article, index) => (
            <Link key={article.id} className="public-mini-carousel-card" to={article.path}>
              <div className="public-mini-carousel-thumb-wrap">
                <img
                  className="public-mini-carousel-thumb"
                  src={article.thumbnail_url}
                  alt={article.title}
                  width={1200}
                  height={630}
                  loading={index < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                />
                <span className="public-mini-carousel-label">{article.category.name}</span>
              </div>
              <p className="public-mini-carousel-title">{article.title}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="public-popular-dots" aria-label="人気記事カルーセル">
        {articles.map((article, index) => (
          <button
            key={article.id}
            type="button"
            className={`public-popular-dot ${index === activeIndex ? 'is-active' : ''}`}
            onClick={() => {
              pauseAutoSlide()
              setActiveIndex(index)
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
  description,
  articles,
  to,
  heroFirst = false,
}: {
  title: string
  description: string
  articles: PublicArticleSummary[]
  to: string
  heroFirst?: boolean
}) {
  return (
    <section className="public-section">
      <div className="public-section-head">
        <div>
          <p className="public-section-kicker">Stories</p>
          <h2 className="public-section-title">{title}</h2>
          <p className="public-section-lead">{description}</p>
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

  return (
    <div className="public-pagination-wrap">
      <button
        type="button"
        className="public-page-button"
        onClick={() => onMove(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        <i className="bi bi-chevron-left" aria-hidden="true" />
        前へ
      </button>
      <p className="public-page-status">
        {page} / {totalPages}
      </p>
      <button
        type="button"
        className="public-page-button"
        onClick={() => onMove(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        次へ
        <i className="bi bi-chevron-right" aria-hidden="true" />
      </button>
    </div>
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

function PublicHeroVisual() {
  const [heroMessage] = useState(
    () => PUBLIC_HERO_MESSAGES[Math.floor(Math.random() * PUBLIC_HERO_MESSAGES.length)],
  )

  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <p className="public-hero-kicker">Weekend Camera</p>
        <h1 className="public-hero-title">気ままに、機材と写真を楽しむブログ。</h1>
        <p className="public-hero-text">{heroMessage}</p>
      </div>
    </section>
  )
}

export function PublicHomePage() {
  const popularState = usePublicArticleList({
    ordering: 'popular',
    page: 1,
    limit: HOME_SECTION_SIZE,
  })
  const newestState = usePublicArticleList({
    ordering: 'newest',
    page: 1,
    limit: HOME_SECTION_SIZE,
  })

  if (popularState.errorPath !== '') {
    return <Navigate to={popularState.errorPath} replace />
  }
  if (newestState.errorPath !== '') {
    return <Navigate to={newestState.errorPath} replace />
  }

  const popularArticles = popularState.payload?.items ?? []

  return (
    <main className="public-main">
      <PublicHeroVisual />
      <PublicPopularShowcase articles={popularArticles} />
      <PublicMiniArticleCarousel articles={popularArticles} />
      {newestState.payload ? (
        <PublicArticleSection
          title="新着記事"
          description="撮ったばかりの写真と、使った機材の感触を新しい順にまとめています。"
          articles={newestState.payload.items}
          to="/articles/new/"
          heroFirst
        />
      ) : null}
      {popularState.payload ? (
        <PublicArticleSection
          title="人気記事"
          description="よく読まれている記事から、週末の一台を選ぶヒントを探せます。"
          articles={popularState.payload.items}
          to="/articles/popular/"
        />
      ) : null}
    </main>
  )
}

function PublicListPage({
  title,
  description,
  params,
}: {
  title: string
  description: string
  params: PublicArticleListParams
}) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Number(searchParams.get('page') ?? '1')
  const { payload, errorPath } = usePublicArticleList({
    ...params,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: PUBLIC_PAGE_SIZE,
  })

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

  return (
    <main className="public-main">
      <section className="public-collection-hero">
        <p className="public-section-kicker">Archive</p>
        <h1 className="public-collection-title">{title}</h1>
        <p className="public-section-lead">{description}</p>
      </section>

      {payload ? (
        <>
          <div className="public-card-grid">
            {payload.items.map((article, index) => (
              <PublicArticleCard key={article.id} article={article} eager={index === 0} />
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
    />
  )
}

export function PublicPopularArticlesPage() {
  return (
    <PublicListPage
      title="人気記事"
      description="PV順でよく読まれている記事をまとめています。"
      params={{ ordering: 'popular' }}
    />
  )
}

export function PublicCategoryArticlesPage() {
  const { categorySlug = '' } = useParams()
  return (
    <PublicListPage
      title={`# ${categorySlug}`}
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
  return (
    <PublicListPage
      title={`# ${tagSlug}`}
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

  return (
    <PublicListPage
      title="検索結果"
      description={
        keyword.trim() === ''
          ? '検索条件に一致する記事を表示します。'
          : `「${keyword.trim()}」に一致する記事を表示しています。`
      }
      params={{
        q: keyword,
        author_id: authorId === '' ? undefined : authorId,
        ordering: 'newest',
      }}
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

  return (
    <main className="public-main public-article-detail-page">
      <article className="public-article-detail-shell">
        <nav className="public-breadcrumb" aria-label="パンくず">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to={article.category.path}>{article.category.name}</Link>
        </nav>

        <header className="public-article-header">
          <div className="public-detail-thumb-wrap">
            <img
              className="public-detail-thumb"
              src={article.thumbnail_url}
              alt={article.title}
              width={1200}
              height={630}
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <p className="public-detail-category">{article.category.name}</p>
          <h1 className="public-detail-title">{article.title}</h1>
          <p className="public-detail-summary">{article.summary}</p>
          <div className="public-detail-meta">
            <Link
              className="public-author-link"
              to={`/search?author_id=${article.author.id}`}
            >
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
              <span>{article.author.display_name}</span>
            </Link>
            {article.published_at ? (
              <time className="public-published-at" dateTime={article.published_at}>
                {formatPublicDate(article.published_at)}
              </time>
            ) : null}
          </div>
          <div className="public-tag-row">
            {article.tags.map((tag) => (
              <Link key={tag.id} className="public-tag-pill" to={`/tag/${tag.slug}/`}>
                #{tag.name}
              </Link>
            ))}
            {article.article_option.items.map((option) => (
              <span key={option.id} className="public-tag-pill is-option">
                {option.label}
              </span>
            ))}
          </div>
        </header>

        <div className="public-article-layout">
          <PublicArticleBodyRenderer
            bodyHtml={article.body_html}
            cdnBaseUrl={cdnBaseUrl}
            ogpByUrl={article.ogp_by_url}
          />
        </div>
      </article>

      {relatedArticles.length > 0 ? (
        <PublicArticleSection
          title="関連記事"
          description="同じカテゴリーを中心に、続けて読みやすい記事を並べています。"
          articles={relatedArticles}
          to={article.category.path}
        />
      ) : null}
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
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage('')
    setErrorMessage('')

    try {
      const response = await submitPublicContact({
        ...form,
        turnstile_token: '',
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
      if (error instanceof ApiError) {
        setErrorMessage(error.detail)
        return
      }
      setErrorMessage('送信に失敗しました。')
    }
  }

  return (
    <main className="public-main">
      <section className="public-contact-shell">
        <p className="public-section-kicker">Contact</p>
        <h1 className="public-collection-title">お問い合わせ</h1>
        <p className="public-section-lead">
          レビューのご依頼やブログへのご連絡はこちらからお送りください。
        </p>

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
          <p className="public-contact-note">
            Cloudflare Turnstile は公開フロント側の追加要件として別途接続します。
          </p>
          {message !== '' ? <p className="public-contact-success">{message}</p> : null}
          {errorMessage !== '' ? <p className="public-contact-error">{errorMessage}</p> : null}
          <button type="submit" className="public-contact-submit">
            送信する
          </button>
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
  const navigate = useNavigate()
  const location = useLocation()
  const [searchKeyword, setSearchKeyword] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    setMobileNavOpen(false)
    setSearchOpen(false)
    setSearchKeyword(new URLSearchParams(location.search).get('q') ?? '')
  }, [location.pathname, location.search])

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const normalized = searchKeyword.trim()
    if (normalized === '') {
      return
    }
    startTransition(() => {
      navigate(`/search?q=${encodeURIComponent(normalized)}`)
    })
  }

  return (
    <div className="public-site-shell">
      <header className="public-header">
        <div className="public-header-inner">
          <button
            type="button"
            className="public-mobile-menu-button"
            onClick={() => {
              setMobileNavOpen((current) => !current)
              setSearchOpen(false)
            }}
            aria-label="メニューを開閉"
            aria-expanded={mobileNavOpen}
          >
            <i className={`bi ${mobileNavOpen ? 'bi-x-lg' : 'bi-list'}`} aria-hidden="true" />
          </button>
          <Link className="public-site-logo" to="/">
            <i className="bi bi-camera" aria-hidden="true" />
            <span>週末カメラ</span>
          </Link>
          <button
            type="button"
            className="public-search-toggle-button"
            onClick={() => {
              setSearchOpen((current) => !current)
              setMobileNavOpen(false)
            }}
            aria-label="検索を開閉"
            aria-expanded={searchOpen}
          >
            <i className={`bi ${searchOpen ? 'bi-x-lg' : 'bi-search'}`} aria-hidden="true" />
          </button>
        </div>
        <form
          className={`public-search-bar ${searchOpen ? 'is-open' : ''}`}
          onSubmit={handleSearchSubmit}
        >
          <i className="bi bi-search" aria-hidden="true" />
          <input
            className="public-search-input"
            type="search"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="タイトル検索"
            aria-label="記事検索"
          />
        </form>
      </header>
      <div
        className={`public-nav-backdrop ${mobileNavOpen ? 'is-open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />
      <aside className={`public-mobile-nav ${mobileNavOpen ? 'is-open' : ''}`}>
        <div className="public-mobile-nav-head">
          <p className="public-mobile-nav-title">MENU</p>
        </div>
        <Link className="public-mobile-nav-link" to="/articles/new/">
          新着記事
        </Link>
        <Link className="public-mobile-nav-link" to="/articles/popular/">
          人気記事
        </Link>
        <Link className="public-mobile-nav-link" to="/contact">
          お問い合わせ
        </Link>
      </aside>

      <Outlet />

      <footer className="public-footer">
        <Link className="public-footer-logo" to="/">
          週末カメラ
        </Link>
        <p className="public-footer-copy">
          気ままに、機材と写真を楽しむブログ
        </p>
      </footer>
    </div>
  )
}
