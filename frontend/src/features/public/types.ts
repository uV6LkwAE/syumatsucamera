export type PublicPagination = {
  page: number
  page_size: number
  total_count: number
  total_pages: number
}

export type PublicCategorySummary = {
  id: string
  name: string
  path: string
}

export type PublicTagSummary = {
  id: string
  name: string
  slug: string
}

export type PublicSidebarTag = PublicTagSummary & {
  path: string
}

export type PublicAuthorSummary = {
  id: string
  display_name: string
  profile: string
  icon: string | null
  header_image: string | null
  x_url: string | null
  instagram_url: string | null
  website_url: string | null
}

export type PublicProfile = PublicAuthorSummary & {
  profile: string
  meta: Record<string, string>
}

export type PublicCategoryTreeItem = PublicCategorySummary & {
  slug: string
  article_count: number
  children: PublicCategoryTreeItem[]
}

export type PublicArticleOptionItem = {
  id: string
  code: string
  label: string
  description: string
  is_system: boolean
}

export type PublicArticleOption = {
  is_pr: boolean
  is_ad: boolean
  items: PublicArticleOptionItem[]
}

export type PublicArticleSummary = {
  id: string
  title: string
  summary: string
  published_at: string | null
  views_total: number
  is_profit: boolean
  thumbnail_url: string
  path: string
  category: PublicCategorySummary
  author: PublicAuthorSummary
  article_option: PublicArticleOption
}

export type PublicOgpRecord = {
  id: string
  article_id: string
  url: string
  title: string | null
  summary: string | null
  thumbnail: string | null
  price: string | null
  is_associates: boolean | null
  site_name: string | null
  updated_at: string
}

export type PublicArticleBody = PublicArticleSummary & {
  body_html: string
  status: 'draft' | 'private' | 'publish'
  twitter_card: 'summary' | 'summary_large_image'
  category_breadcrumb: PublicCategorySummary[]
  tags: PublicTagSummary[]
  toc: PublicTocNode[]
  ogp_by_url: Record<string, PublicOgpRecord>
}

export type PublicArticleMetaResponse = {
  title: string
  description: string
  canonical_url: string
  og_image_url: string
  is_profit: boolean
  twitter_card: 'summary' | 'summary_large_image'
}

export type PublicTocNode = {
  level: number
  id: string
  text: string
  children: PublicTocNode[]
}

export type PublicArticleListResponse = {
  items: PublicArticleSummary[]
  pagination: PublicPagination
}

export type PublicArticleDetailResponse = {
  article: PublicArticleBody
  related_articles: PublicArticleSummary[]
  cdn_base_url: string
}

export type PublicSidebarResponse = {
  profile: PublicProfile
  category_tree: PublicCategoryTreeItem[]
  tags: PublicSidebarTag[]
}

export type PublicSiteConfigResponse = {
  turnstile_site_key: string
}

export type PublicArticleListParams = {
  page?: number
  limit?: number
  q?: string
  ordering?: 'newest' | 'popular'
  category_slug?: string
  tag_slug?: string
  author_id?: string
}

export type ContactSubjectType = 'review' | 'blog'

export type PublicContactRequest = {
  subject_type: ContactSubjectType
  company_name: string
  person_name: string
  email: string
  body: string
  turnstile_token: string
}

export type PublicContactResponse = {
  id: string
  message: string
}
