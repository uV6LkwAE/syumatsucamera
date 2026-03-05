```mermaid
erDiagram
    USER {
        uuid id PK
        string email UK
        string display_name
        string role
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORY {
        uuid id PK
        string name UK
        string slug UK
        uuid parent_id FK
        int sort_order
        int lft
        int rght
        int tree_id
        int level
        timestamptz created_at
        timestamptz updated_at
    }

    ARTICLE {
        uuid id PK
        uuid category_id FK
        uuid author_id FK
        string title
        string slug
        string thumbnail_mode
        text summary
        text body_html
        string status
        timestamptz published_at
        bigint views_total
        uuid thumbnail_asset_id FK
        jsonb toc_json
        jsonb async_state
        uuid locked_by_id FK
        timestamptz locked_at
        uuid lock_token
        timestamptz lock_expires_at
        timestamptz created_at
        timestamptz updated_at
    }

    OPTION {
        uuid id PK
        string code UK
        string label
        text default_text
        timestamptz created_at
        timestamptz updated_at
    }

    ARTICLE_OPTION {
        uuid id PK
        uuid article_id FK
        uuid option_id FK
        text override_text
        timestamptz created_at
    }

    TAG {
        uuid id PK
        string name UK
        string slug UK
        timestamptz created_at
        timestamptz updated_at
    }

    ARTICLE_TAG {
        uuid id PK
        uuid article_id FK
        uuid tag_id FK
        timestamptz created_at
    }

    ARTICLE_PUBLISH_REQUEST {
        uuid id PK
        uuid article_id FK
        uuid requested_by_id FK
        timestamptz requested_at
        string status
        uuid handled_by_id FK
        timestamptz handled_at
        text note
    }

    OGP_INFO {
        uuid id PK
        uuid article_id FK
        text url
        text title
        text summary
        text thumbnail
        timestamptz created_at
        timestamptz updated_at
    }

    MEDIA_ASSET {
        uuid id PK
        uuid article_id FK
        string kind
        text original_rel_path
        text derived_rel_path
        int width
        int height
        string checksum_sha256
        jsonb exif_json
        jsonb processing_version
        string processing_status
        timestamptz processed_at
        text error_message
        timestamptz created_at
        timestamptz updated_at
    }

    CONTACT {
        uuid id PK
        string subject_type
        string company_name
        string person_name
        string email
        text body
        jsonb turnstile_meta
        timestamptz created_at
        timestamptz updated_at
    }

    CATEGORY ||--o{ ARTICLE : contains
    USER ||--o{ ARTICLE : authors
    USER ||--o{ ARTICLE : locks

    ARTICLE ||--o{ MEDIA_ASSET : owns
    ARTICLE ||--o{ ARTICLE_TAG : tagged_by
    TAG ||--o{ ARTICLE_TAG : tags

    ARTICLE ||--o{ OGP_INFO : links

    ARTICLE ||--o{ ARTICLE_PUBLISH_REQUEST : requests
    USER ||--o{ ARTICLE_PUBLISH_REQUEST : requested_by
    USER ||--o{ ARTICLE_PUBLISH_REQUEST : handled_by

    ARTICLE ||--o{ ARTICLE_OPTION : has_options
    OPTION ||--o{ ARTICLE_OPTION : applied_to
```

## 制約メモ（DB制約）

- `category.slug` は `UNIQUE`
- `tag.slug` は `UNIQUE`
- `article.slug` はカテゴリ配下で一意: `UNIQUE(category_id, slug)`
- `article_tag` は重複禁止: `UNIQUE(article_id, tag_id)`
- `article_option` は重複禁止: `UNIQUE(article_id, option_id)`
- `article_publish_request.status` は列挙制約（例: `pending/approved/rejected`）
- `article.status` は列挙制約（例: `draft/private/published`）

## オプション運用メモ

- `is_pr` / `is_ad` は `ARTICLE` カラムで持たず、`ARTICLE_OPTION` で管理する。
- `OPTION.code` に `pr` / `ad` / `non_monetized` を登録し、記事への適用は `ARTICLE_OPTION` で表現する。
- `non_monetized` が付与された記事は、公開側で AdSense スクリプトを読み込まない。
- 将来オプション追加（例: `sponsored`）は `OPTION` 追加のみで対応する。

## CONTACT運用メモ

- `email_confirm` は問い合わせAPIの入力確認用フィールドであり、DBには保存しない。
- `CONTACT` テーブルには `email` のみ保存する。
