import { ApiError } from '../../api/apiError'
import { buildPublicSiteUrl } from '../../lib/siteUrls'
import type { CmsArticleMediaAsset, CmsCategoryNode } from './types'

export type FlatCmsCategory = {
  id: string
  name: string
  depth: number
  slug: string
  parent_id: string | null
  sort_order: number
}

export function toApiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.status}] ${error.code}: ${error.detail}`
  }
  return '通信中に予期しないエラーが発生しました。'
}

export function formatCmsDate(value: string | null): string {
  if (value === null || value.trim() === '') {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('ja-JP')
}

export function flattenCmsCategoryTree(
  items: CmsCategoryNode[],
  depth = 0,
): FlatCmsCategory[] {
  const flattened: FlatCmsCategory[] = []

  for (const item of items) {
    flattened.push({
      id: item.id,
      name: item.name,
      depth,
      slug: item.slug,
      parent_id: item.parent_id,
      sort_order: item.sort_order,
    })
    flattened.push(...flattenCmsCategoryTree(item.children, depth + 1))
  }

  return flattened
}

export function normalizeMediaSourcePath(source: string): string {
  const trimmed = source.trim()
  if (trimmed === '') {
    return ''
  }
  if (/^(data:|blob:)/i.test(trimmed)) {
    return trimmed
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname
    } catch {
      return trimmed.split('?')[0]?.split('#')[0] ?? trimmed
    }
  }
  return trimmed.split('?')[0]?.split('#')[0] ?? trimmed
}

export function replaceImageSourceInHtml(
  bodyHtml: string,
  fromSource: string,
  toSource: string,
): string {
  if (typeof window === 'undefined') {
    return bodyHtml
  }

  const parser = new DOMParser()
  const documentFragment = parser.parseFromString(bodyHtml, 'text/html')
  for (const image of Array.from(documentFragment.querySelectorAll('img'))) {
    const source = image.getAttribute('src')?.trim() ?? ''
    if (source !== fromSource) {
      continue
    }
    image.setAttribute('src', toSource)
  }

  return documentFragment.body.innerHTML
}

export function collectImageFileNamesFromHtml(bodyHtml: string): Set<string> {
  if (typeof window === 'undefined') {
    return new Set()
  }

  const parser = new DOMParser()
  const documentFragment = parser.parseFromString(bodyHtml, 'text/html')
  const fileNames = new Set<string>()
  for (const image of Array.from(documentFragment.querySelectorAll('img'))) {
    const source = image.getAttribute('src')?.trim() ?? ''
    const fileName = extractMediaFileName(source)
    if (fileName !== '') {
      fileNames.add(fileName)
    }
  }
  return fileNames
}

export function collectTempImageFileNames(bodyHtml: string, lockToken: string): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  const parser = new DOMParser()
  const documentFragment = parser.parseFromString(bodyHtml, 'text/html')
  const fileNames = new Set<string>()
  const prefix = `/media/tmp/${lockToken}/`

  for (const image of Array.from(documentFragment.querySelectorAll('img'))) {
    const source = normalizeMediaSourcePath(image.getAttribute('src')?.trim() ?? '')
    if (!source.startsWith(prefix)) {
      continue
    }
    const fileName = source.slice(prefix.length)
    if (fileName !== '') {
      fileNames.add(fileName)
    }
  }

  return Array.from(fileNames)
}

export function resolveDeleteImageIds(
  initialAssets: CmsArticleMediaAsset[],
  currentBodyHtml: string,
): string[] {
  const currentFileNames = collectImageFileNamesFromHtml(currentBodyHtml)
  return initialAssets
    .filter((asset) => !asset.is_thumbnail)
    .filter((asset) => !currentFileNames.has(asset.file_name))
    .map((asset) => asset.id)
}

export function extractMediaFileName(path: string): string {
  const trimmedPath = path.trim()
  if (trimmedPath === '') {
    return ''
  }

  const normalizedPath = trimmedPath.split('?')[0]?.split('#')[0] ?? ''
  if (normalizedPath === '') {
    return ''
  }

  const segments = normalizedPath.split('/')
  const candidate = segments[segments.length - 1] ?? ''
  if (!/^[0-9a-fA-F-]{36}\.[A-Za-z0-9]+$/.test(candidate)) {
    return ''
  }
  return candidate
}

export function buildCmsPublicArticleUrl(articlePath: string): string {
  return buildPublicSiteUrl(articlePath)
}
