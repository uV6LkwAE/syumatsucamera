import { apiRequest } from '../../api/publicClient'
import type {
  PublicArticleDetailResponse,
  PublicArticleListParams,
  PublicArticleListResponse,
  PublicContactRequest,
  PublicContactResponse,
  PublicSidebarResponse,
  PublicSiteConfigResponse,
} from './types'

function buildPublicArticleQuery(params: PublicArticleListParams): string {
  const searchParams = new URLSearchParams()

  if (params.page !== undefined) {
    searchParams.set('page', String(params.page))
  }
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit))
  }
  if (params.q !== undefined && params.q.trim() !== '') {
    searchParams.set('q', params.q.trim())
  }
  if (params.ordering !== undefined) {
    searchParams.set('ordering', params.ordering)
  }
  if (params.category_slug !== undefined && params.category_slug.trim() !== '') {
    searchParams.set('category_slug', params.category_slug.trim())
  }
  if (params.tag_slug !== undefined && params.tag_slug.trim() !== '') {
    searchParams.set('tag_slug', params.tag_slug.trim())
  }
  if (params.author_id !== undefined && params.author_id.trim() !== '') {
    searchParams.set('author_id', params.author_id.trim())
  }

  const queryText = searchParams.toString()
  return queryText === '' ? '' : `?${queryText}`
}

export function listPublicArticles(
  params: PublicArticleListParams,
): Promise<PublicArticleListResponse> {
  return apiRequest<PublicArticleListResponse>(
    `/public/articles${buildPublicArticleQuery(params)}`,
    {
      withAuth: false,
    },
  )
}

export function fetchPublicArticleDetail(
  categorySlug: string,
  articleSlug: string,
): Promise<PublicArticleDetailResponse> {
  return apiRequest<PublicArticleDetailResponse>(
    `/public/articles/${categorySlug}/${articleSlug}`,
    {
      withAuth: false,
    },
  )
}

export function fetchPublicSidebar(): Promise<PublicSidebarResponse> {
  return apiRequest<PublicSidebarResponse>('/public/sidebar', {
    withAuth: false,
  })
}

export function fetchPublicSiteConfig(): Promise<PublicSiteConfigResponse> {
  return apiRequest<PublicSiteConfigResponse>('/public/site-config', {
    withAuth: false,
  })
}

export function submitPublicContact(
  payload: PublicContactRequest,
): Promise<PublicContactResponse> {
  return apiRequest<PublicContactResponse>('/contacts', {
    method: 'POST',
    body: payload,
    withAuth: false,
  })
}
