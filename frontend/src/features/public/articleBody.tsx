import {
  createElement,
  Fragment,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import type { PublicArticleOptionItem, PublicOgpRecord, PublicTocNode } from './types'

type RenderedPublicArticleBody = {
  content: ReactNode[]
  toc: PublicTocNode[]
  hasXEmbeds: boolean
}

type TocBuildState = {
  roots: PublicTocNode[]
  stack: PublicTocNode[]
  headingTrail: Record<2 | 3 | 4, string>
  idCounts: Map<string, number>
}

type TwitterWidgetsWindow = Window & {
  twttr?: {
    widgets?: {
      load: () => void
    }
  }
}

const URL_ONLY_TEXT_PATTERN = /^https?:\/\/[^\s<>"']+$/i
const MEDIA_SOURCE_PATTERN = /^\/?media\/(.+)$/i
const DATA_OR_BLOB_PATTERN = /^(data:|blob:)/i
const ABSOLUTE_HTTP_PATTERN = /^https?:\/\//i
const X_STATUS_URL_PATTERN = /^https?:\/\/(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i

function normalizeCdnBaseUrl(cdnBaseUrl: string): string {
  return cdnBaseUrl.replace(/\/+$/, '')
}

function generateHeadingBaseId(seedText: string): string {
  let hash = 2166136261
  for (let i = 0; i < seedText.length; i += 1) {
    hash ^= seedText.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `h-${(hash >>> 0).toString(16)}`
}

function buildHeadingId(
  headingText: string,
  level: 2 | 3 | 4,
  tocState: TocBuildState,
): string {
  tocState.headingTrail[level] = headingText
  if (level === 2) {
    tocState.headingTrail[3] = ''
    tocState.headingTrail[4] = ''
  }
  if (level === 3) {
    tocState.headingTrail[4] = ''
  }

  const breadcrumb = ([2, 3, 4] as const)
    .map((trailLevel) => tocState.headingTrail[trailLevel].trim())
    .filter((text) => text !== '')
    .join('>')
  const baseId = generateHeadingBaseId(breadcrumb)
  const usedCount = tocState.idCounts.get(baseId) ?? 0
  tocState.idCounts.set(baseId, usedCount + 1)
  if (usedCount === 0) {
    return baseId
  }
  return `${baseId}-${usedCount + 1}`
}

function appendTocNode(node: PublicTocNode, tocState: TocBuildState): void {
  while (
    tocState.stack.length > 0
    && tocState.stack[tocState.stack.length - 1].level >= node.level
  ) {
    tocState.stack.pop()
  }

  if (tocState.stack.length === 0) {
    tocState.roots.push(node)
    tocState.stack.push(node)
    return
  }

  tocState.stack[tocState.stack.length - 1].children.push(node)
  tocState.stack.push(node)
}

function parseStyleAttribute(styleText: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const declaration of styleText.split(';')) {
    const [rawName, rawValue] = declaration.split(':')
    if (rawName === undefined || rawValue === undefined) {
      continue
    }
    const name = rawName.trim()
    const value = rawValue.trim()
    if (name === '' || value === '') {
      continue
    }
    const camelName = name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
    result[camelName] = value
  }
  return result
}

function extractUrlOnlyLinkHref(element: Element): string | null {
  if (element.tagName.toLowerCase() !== 'p') {
    return null
  }

  const meaningfulNodes = Array.from(element.childNodes).filter((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').trim() !== ''
    }
    return true
  })
  if (meaningfulNodes.length !== 1) {
    return null
  }

  const onlyNode = meaningfulNodes[0]
  if (onlyNode.nodeType !== Node.ELEMENT_NODE) {
    return null
  }

  const anchor = onlyNode as Element
  if (anchor.tagName.toLowerCase() !== 'a') {
    return null
  }
  if (anchor.querySelector('img, picture, video, iframe') !== null) {
    return null
  }

  const href = (anchor.getAttribute('href') ?? '').trim()
  const linkText = (anchor.textContent ?? '').trim()
  if (!URL_ONLY_TEXT_PATTERN.test(linkText)) {
    return null
  }
  if (href !== linkText) {
    return null
  }
  return href
}

function buildCdnImageSrc(src: string, cdnBaseUrl: string): string {
  if (DATA_OR_BLOB_PATTERN.test(src) || ABSOLUTE_HTTP_PATTERN.test(src)) {
    return src
  }

  const mediaMatch = src.match(MEDIA_SOURCE_PATTERN)
  if (mediaMatch === null) {
    return src
  }
  return `${normalizeCdnBaseUrl(cdnBaseUrl)}/media/${mediaMatch[1]}`
}

function renderOgpCard(record: PublicOgpRecord, key: string): ReactNode {
  return (
    <a
      key={key}
      className="public-ogp-card"
      href={record.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="public-ogp-thumb-wrap">
        {record.thumbnail ? (
          <img
            className="public-ogp-thumb"
            src={record.thumbnail}
            alt={record.title ?? record.site_name ?? 'リンクカード'}
            width={320}
            height={180}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="public-ogp-thumb public-ogp-thumb-fallback">
            <i className="bi bi-link-45deg" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="public-ogp-copy">
        <p className="public-ogp-site">{record.site_name ?? '外部リンク'}</p>
        <p className="public-ogp-title">{record.title ?? record.url}</p>
        {record.summary ? (
          <p className="public-ogp-summary">{record.summary}</p>
        ) : null}
      </div>
    </a>
  )
}

function renderXEmbed(url: string, key: string): ReactNode {
  return (
    <figure key={key} className="public-x-embed">
      <blockquote className="twitter-tweet">
        <a href={url}>{url}</a>
      </blockquote>
    </figure>
  )
}

function createElementProps(element: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith('on')) {
      continue
    }
    if (attribute.name === 'class') {
      props.className = attribute.value
      continue
    }
    if (attribute.name === 'style') {
      props.style = parseStyleAttribute(attribute.value)
      continue
    }
    if (attribute.name === 'colspan') {
      props.colSpan = Number(attribute.value)
      continue
    }
    if (attribute.name === 'rowspan') {
      props.rowSpan = Number(attribute.value)
      continue
    }
    props[attribute.name] = attribute.value
  }
  return props
}

async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) {
    throw new Error('Copy failed')
  }
}

function PublicArticlePreBlock({
  preProps,
  codeText,
  children,
}: {
  preProps: ComponentPropsWithoutRef<'pre'>
  codeText: string
  children: ReactNode[]
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return undefined
    }
    const timerId = window.setTimeout(() => {
      setCopied(false)
    }, 1600)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [copied])

  async function handleCopy(): Promise<void> {
    try {
      await copyText(codeText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="public-article-pre-shell">
      <button
        type="button"
        className={`public-article-pre-copy-button${copied ? ' is-copied' : ''}`}
        onClick={() => {
          void handleCopy()
        }}
        aria-label={copied ? 'コードをコピーしました' : 'コードをコピー'}
        title={copied ? 'コピーしました' : 'コピー'}
      >
        <i className={`bi ${copied ? 'bi-check2' : 'bi-copy'}`} aria-hidden="true" />
      </button>
      <pre {...preProps}>{children}</pre>
    </div>
  )
}

function renderNode(
  node: ChildNode,
  key: string,
  cdnBaseUrl: string,
  ogpByUrl: Record<string, PublicOgpRecord>,
  tocState: TocBuildState,
  stateRef: { hasXEmbeds: boolean },
): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()

  if (tagName === 'script' || tagName === 'style') {
    return null
  }

  const ogpHref = extractUrlOnlyLinkHref(element)
  if (ogpHref !== null && ogpByUrl[ogpHref] !== undefined) {
    return renderOgpCard(ogpByUrl[ogpHref], key)
  }

  if (tagName === 'div' && element.getAttribute('data-embed') === 'x') {
    const embedUrl = (element.getAttribute('data-url') ?? '').trim()
    if (X_STATUS_URL_PATTERN.test(embedUrl)) {
      stateRef.hasXEmbeds = true
      return renderXEmbed(embedUrl, key)
    }
    return null
  }

  if (tagName === 'img') {
    const src = buildCdnImageSrc((element.getAttribute('src') ?? '').trim(), cdnBaseUrl)
    const alt = element.getAttribute('alt') ?? ''
    const width = Number(element.getAttribute('width') ?? 0)
    const height = Number(element.getAttribute('height') ?? 0)
    return (
      <img
        key={key}
        className="public-article-body-image"
        src={src}
        alt={alt}
        width={Number.isFinite(width) && width > 0 ? width : 1200}
        height={Number.isFinite(height) && height > 0 ? height : 800}
        loading="lazy"
        decoding="async"
      />
    )
  }

  const children = Array.from(element.childNodes).map((childNode, index) =>
    renderNode(childNode, `${key}-${index}`, cdnBaseUrl, ogpByUrl, tocState, stateRef),
  )

  if (tagName === 'pre') {
    const preProps = {
      ...createElementProps(element),
      key: `${key}-pre`,
    } as ComponentPropsWithoutRef<'pre'>
    return (
      <PublicArticlePreBlock
        key={key}
        preProps={preProps}
        codeText={element.textContent ?? ''}
      >
        {children}
      </PublicArticlePreBlock>
    )
  }

  if (tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
    const level = Number(tagName.slice(1)) as 2 | 3 | 4
    const headingText = (element.textContent ?? '').trim()
    const id = buildHeadingId(headingText, level, tocState)
    appendTocNode(
      {
        id,
        level,
        text: headingText,
        children: [],
      },
      tocState,
    )
    return createElement(
      tagName,
      {
        ...createElementProps(element),
        id,
        key,
        className: `public-article-heading ${element.getAttribute('class') ?? ''}`.trim(),
      },
      ...children,
    )
  }

  if (tagName === 'h1') {
    return createElement(
      tagName,
      {
        ...createElementProps(element),
        key,
        className: `public-article-heading ${element.getAttribute('class') ?? ''}`.trim(),
      },
      ...children,
    )
  }

  if (tagName === 'blockquote' || tagName === 'backquote') {
    return createElement(
      tagName,
      {
        ...createElementProps(element),
        key,
      },
      createElement('i', {
        key: `${key}-quote-icon`,
        className: 'bi bi-quote public-article-quote-icon',
        'aria-hidden': 'true',
      }),
      createElement(
        'div',
        {
          key: `${key}-quote-body`,
          className: 'public-article-quote-body',
        },
        ...children,
      ),
    )
  }

  if (tagName === 'a') {
    const href = element.getAttribute('href') ?? '#'
    const isExternal = ABSOLUTE_HTTP_PATTERN.test(href)
    return createElement(
      'a',
      {
        ...createElementProps(element),
        key,
        href,
        target: isExternal ? '_blank' : undefined,
        rel: isExternal ? 'noopener noreferrer' : undefined,
      },
      ...children,
    )
  }

  return createElement(
    tagName,
    {
      ...createElementProps(element),
      key,
    },
    ...children,
  )
}

export function renderPublicArticleBody(
  bodyHtml: string,
  cdnBaseUrl: string,
  ogpByUrl: Record<string, PublicOgpRecord>,
): RenderedPublicArticleBody {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<article>${bodyHtml}</article>`, 'text/html')
  const articleElement = doc.body.firstElementChild
  if (articleElement === null) {
    return {
      content: [],
      toc: [],
      hasXEmbeds: false,
    }
  }

  const tocState: TocBuildState = {
    roots: [],
    stack: [],
    headingTrail: {
      2: '',
      3: '',
      4: '',
    },
    idCounts: new Map(),
  }
  const stateRef = { hasXEmbeds: false }
  const content = Array.from(articleElement.childNodes).map((node, index) =>
    renderNode(node, `body-${index}`, cdnBaseUrl, ogpByUrl, tocState, stateRef),
  )
  return {
    content,
    toc: tocState.roots,
    hasXEmbeds: stateRef.hasXEmbeds,
  }
}

export function usePublicXEmbedRenderer(hasXEmbeds: boolean): void {
  useEffect(() => {
    if (!hasXEmbeds) {
      return
    }

    const twitterWindow = window as TwitterWidgetsWindow
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-public-x-embed="true"]',
    )

    if (existingScript !== null) {
      twitterWindow.twttr?.widgets?.load()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    script.charset = 'utf-8'
    script.dataset.publicXEmbed = 'true'
    script.onload = () => {
      twitterWindow.twttr?.widgets?.load()
    }
    document.body.appendChild(script)
  }, [hasXEmbeds])
}

export function renderPublicTocNodes(nodes: PublicTocNode[]): ReactNode {
  if (nodes.length === 0) {
    return null
  }

  return (
    <ol className="public-toc-list">
      {nodes.map((node, index) => (
        <li key={node.id} className={`public-toc-item public-toc-level-${node.level}`}>
          <a className="public-toc-link" href={`#${node.id}`}>
            {node.level === 2 ? (
              <span className="public-toc-index" aria-hidden="true">
                {index + 1}.
              </span>
            ) : (
              <i
                className={`bi bi-caret-right-fill public-toc-caret public-toc-caret-level-${node.level}`}
                aria-hidden="true"
              />
            )}
            <span className="public-toc-link-text">{node.text}</span>
          </a>
          {renderPublicTocNodes(node.children)}
        </li>
      ))}
    </ol>
  )
}

function renderPublicArticleOptionNotes(
  options: PublicArticleOptionItem[],
  className = '',
): ReactNode {
  const visibleOptions = options
    .map((option) => ({
      id: option.id,
      label: option.label.trim(),
      description: option.description.trim(),
    }))
    .filter((option) => option.label !== '')

  if (visibleOptions.length === 0) {
    return null
  }

  return (
    <div
      className={`public-article-option-notes${className === '' ? '' : ` ${className}`}`}
      aria-label="記事オプション"
    >
      {visibleOptions.map((option) => (
        <div key={option.id} className="public-article-option-note">
          <i className="bi bi-info-circle" aria-hidden="true" />
          <span className="public-article-option-note-label">{option.label}</span>
          {option.description !== '' ? (
            <span className="public-article-option-note-description">
              {option.description}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function PublicArticleBodyRenderer({
  bodyHtml,
  cdnBaseUrl,
  ogpByUrl,
  articleOptions = [],
}: {
  bodyHtml: string
  cdnBaseUrl: string
  ogpByUrl: Record<string, PublicOgpRecord>
  articleOptions?: PublicArticleOptionItem[]
}) {
  const renderedBody = renderPublicArticleBody(bodyHtml, cdnBaseUrl, ogpByUrl)
  const [tocOpen, setTocOpen] = useState(true)
  const articleOptionNotes = renderPublicArticleOptionNotes(articleOptions)
  usePublicXEmbedRenderer(renderedBody.hasXEmbeds)

  return (
    <Fragment>
      {renderedBody.toc.length > 0 ? (
        <aside
          className={`public-article-toc ${tocOpen ? 'is-open' : 'is-closed'}`}
          aria-label="目次"
        >
          <button
            type="button"
            className="public-article-toc-toggle"
            onClick={() => setTocOpen((current) => !current)}
            aria-expanded={tocOpen}
            aria-controls="publicArticleTocBody"
          >
            <span className="public-article-toc-title">
              <i className="bi bi-list-task public-article-toc-title-icon" aria-hidden="true" />
              <span>Index</span>
            </span>
            <i
              className="bi bi-chevron-down public-article-toc-chevron"
              aria-hidden="true"
            />
          </button>
          <div
            id="publicArticleTocBody"
            className="public-article-toc-body"
            aria-hidden={!tocOpen}
          >
            <div className="public-article-toc-body-inner">
              {renderPublicTocNodes(renderedBody.toc)}
            </div>
          </div>
          {articleOptionNotes}
        </aside>
      ) : (
        renderPublicArticleOptionNotes(articleOptions, 'is-standalone')
      )}
      <div className="public-article-content">{renderedBody.content}</div>
    </Fragment>
  )
}
