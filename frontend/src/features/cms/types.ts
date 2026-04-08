export type CmsArticleStatus = 'draft' | 'publish' | 'private'

export type CmsImageJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type CmsPublishRequestStatus = 'pending' | 'approved' | 'rejected'

export type CmsTwitterCard = 'summary' | 'summary_large_image'

export type CmsCategoryNode = {
  id: string
  name: string
  slug: string
  parent_id: string | null
  sort_order: number
  children: CmsCategoryNode[]
}

export type CmsCategoryTreeResponse = {
  items: CmsCategoryNode[]
}

export type CmsAuthorSummary = {
  id: string
  display_name: string | null
  icon: string | null
  header_image: string | null
}

export type CmsArticleAuthorOption = {
  id: string
  display_name: string
}

export type CmsArticleAuthorOptionListResponse = {
  items: CmsArticleAuthorOption[]
}

export type CmsArticleOption = {
  is_pr: boolean
  is_ad: boolean
  items: CmsArticleOptionItem[]
}

export type CmsArticleOptionItem = {
  id: string
  code: string
  label: string
  description: string
  is_system: boolean
}

export type CmsArticleOptionListResponse = {
  items: CmsArticleOptionItem[]
}

export type CmsTagSummary = {
  id: string
  name: string
  slug: string
}

export type CmsTagSuggestion = CmsTagSummary & {
  article_count: number
}

export type CmsTagSuggestionListResponse = {
  items: CmsTagSuggestion[]
}

export type CmsArticleSummary = {
  id: string
  title: string
  path: string
  status: CmsArticleStatus
  author: CmsAuthorSummary
  category: {
    id: string
    name: string
    slug: string
    path: string
  }
  article_option: CmsArticleOption
  views_total: number
  image_job_status: CmsImageJobStatus
  updated_at: string
}

export type CmsArticleListResponse = {
  items: CmsArticleSummary[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
  }
}

export type CmsArticleMediaAsset = {
  id: string
  file_name: string
  public_path: string
  is_thumbnail: boolean
}

export type CmsArticleDetail = {
  id: string
  category_id: string
  author_id: string
  author: CmsAuthorSummary
  title: string
  path: string
  slug: string
  summary: string
  body_html: string
  status: CmsArticleStatus
  published_at: string | null
  views_total: number
  thumbnail_asset_id: string | null
  twitter_card: CmsTwitterCard
  article_option: CmsArticleOption
  tags: CmsTagSummary[]
  media_assets: CmsArticleMediaAsset[]
  toc: Array<Record<string, unknown>>
  image_job_status: CmsImageJobStatus
  lock: {
    article_id: string | null
    lock_token: string
    locked_by_id: string
    locked_by: CmsAuthorSummary
    lock_expires_at: string
  } | null
  created_at: string
  updated_at: string
}

export type CmsArticleMutationResponse = {
  article: CmsArticleDetail
  postprocess_job: {
    job_name: string
    status: 'accepted'
  }
}

export type CmsArticleSessionResponse = {
  article_id: string | null
  lock_token: string
  locked_by_id: string
  locked_by: CmsAuthorSummary
  lock_expires_at: string
}

export type CmsImageUploadResponse = {
  file_name: string
  path: string
}

export type CmsSaveLogItem = {
  occurred_at: string
  article_id: string | null
  request_user_id: string
  request_user: CmsAuthorSummary
  lock_token: string
  target: string | null
  status: 'failed' | 'started' | 'completed'
  message: string | null
}

export type CmsSaveLogListResponse = {
  items: CmsSaveLogItem[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
  }
}

export type CmsPublishRequestItem = {
  id: string
  article_id: string
  article: CmsArticleSummary
  requested_by_id: string
  requested_by: CmsAuthorSummary
  requested_at: string
  status: CmsPublishRequestStatus
  handled_by_id: string | null
  handled_by: CmsAuthorSummary | null
  handled_at: string | null
  note: string | null
}

export type CmsPublishRequestListResponse = {
  items: CmsPublishRequestItem[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
  }
}

export type CmsOgpRecord = {
  id: string
  article_id: string
  url: string
  title: string | null
  summary: string | null
  thumbnail: string | null
  site_name: string | null
  updated_at: string
}

export type CmsOgpRecordListResponse = {
  items: CmsOgpRecord[]
  pagination: {
    page: number
    page_size: number
    total_count: number
    total_pages: number
  }
}

export type CmsAcceptedJob = {
  job_name: string
  status: 'accepted'
}
