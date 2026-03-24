```mermaid
erDiagram
    USER {
        uuid id PK "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
        string cf_access_sub UK "google-oauth2|117200000000000000001"
        string email UK "editor@syumatsucamera.com"
        string display_name "WeekendCameraEditor"
        string profile "週末にスナップ撮影をしています。"
        string role "[admin, staff]"
        bool is_active "true"
        timestamptz last_login_at "2026-03-24T10:15:03+09:00"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    CATEGORY {
        uuid id PK "8b8f5ef8-1298-46bc-a9fe-447f7f679adc"
        string name UK "Review"
        string slug UK "review"
        uuid parent_id FK "null"
        int sort_order "10"
        int lft "1"
        int rght "2"
        int tree_id "1"
        int level "0"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    ARTICLE {
        uuid id PK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        uuid category_id FK "8b8f5ef8-1298-46bc-a9fe-447f7f679adc"
        uuid author_id FK "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
        string title "Kyoto Trip"
        string slug "kyoto-trip"
        string summary "Kyoto street photo report."
        text body_html "<html><body><p>本文サンプル</p></body></html>"
        string status "[draft, publish, private]"
        string thumbnail_mode "[uploaded, default, generated]"
        timestamptz published_at "null"
        bigint views_total "0"
        uuid thumbnail_asset_id FK "0c1ac2d4-9f50-4ed8-8e6e-4d8250d25f24"
        jsonb toc_json "[]"
        uuid locked_by_id FK "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
        timestamptz locked_at "2026-03-22T10:15:03+09:00"
        uuid lock_token "3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d"
        timestamptz lock_expires_at "2026-03-22T10:20:03+09:00"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    OPTION {
        uuid id PK "958de44f-0279-4078-b445-bbc47ecb4b14"
        string code UK "non_monetized"
        string label "NonMonetized"
        text default_text "off"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    ARTICLE_OPTION {
        uuid id PK "bd194f40-6d95-40e6-9003-68cd3d43ca67"
        uuid article_id FK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        uuid option_id FK "958de44f-0279-4078-b445-bbc47ecb4b14"
        text override_text "on"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
    }

    TAG {
        uuid id PK "8dc2d935-a11b-42bc-aec8-e8618650c4af"
        string name UK "Landscape"
        string slug UK "landscape"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    ARTICLE_TAG {
        uuid id PK "3e067964-f326-4fa8-9493-5f6b57eb88a8"
        uuid article_id FK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        uuid tag_id FK "8dc2d935-a11b-42bc-aec8-e8618650c4af"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
    }

    ARTICLE_PUBLISH_REQUEST {
        uuid id PK "f79db536-902b-495f-bfe5-80ef30488fa2"
        uuid article_id FK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        uuid requested_by_id FK "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
        timestamptz requested_at "2026-03-22T10:15:03+09:00"
        string status "[pending, approved, rejected]"
        uuid handled_by_id FK "null"
        timestamptz handled_at "null"
        text note "Please review"
    }

    OGP_INFO {
        uuid id PK "2a4f9661-f937-4ea7-897b-f5e06349c084"
        uuid article_id FK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        text url "https://example.com"
        text title "Example"
        text summary "Example summary"
        text thumbnail "https://example.com/ogp.jpg"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    MEDIA_ASSET {
        uuid id PK "0c1ac2d4-9f50-4ed8-8e6e-4d8250d25f24"
        uuid article_id FK "7c89d972-7a3f-4ca1-8a31-25a99aa3380e"
        string file_name "9f2c8a1e-1234-5678-9abc-def012345678.jpg"
        int width "1920"
        int height "1280"
        string checksum_sha256 "0f9fca74f755f2f6cc57f0f9ccf2c3f2350d7b4be3f95afec8f6de95a77e4b6d"
        jsonb exif_json "exif_json_sample_v1"
        jsonb processing_options_json "resize:true,exif_watermark:true,site_logo_watermark:false,custom_text_overlay:false"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
    }

    ARTICLE_SAVE_LOG {
        uuid id PK "d805af8a-98c5-47f9-9f2f-ed57b2f3435d"
        timestamptz occurred_at "2026-03-22T10:15:09+09:00"
        uuid request_user_id FK "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
        uuid lock_token "3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d"
        string target "61c84b3e-0df5-4f50-a2af-27464c5ab210.png"
        string status "[failed, started, completed]"
        text message "Failed to insert watermark."
    }

    CONTACT {
        uuid id PK "9426a8d7-f1cb-4cd6-90f9-4eef3616f2e4"
        string subject_type "[review, blog]"
        string company_name "Acme Inc"
        string person_name "John Doe"
        string email "john@example.com"
        text body "Please contact us."
        jsonb turnstile_meta "token:ok"
        timestamptz created_at "2026-03-22T10:15:03+09:00"
        timestamptz updated_at "2026-03-22T10:15:03+09:00"
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
    USER ||--o{ ARTICLE_SAVE_LOG : requested_by

    ARTICLE ||--o{ ARTICLE_OPTION : has_options
    OPTION ||--o{ ARTICLE_OPTION : applied_to
```

## 制約メモ（DB制約）

- 空ドラフトは作成しない。`ARTICLE` は初回保存時に必須項目を満たした状態で作成する。
- `category.slug` は `UNIQUE`
- `tag.slug` は `UNIQUE`
- `article.slug` はカテゴリ配下で一意: `UNIQUE(category_id, slug)`
- `article_tag` は重複禁止: `UNIQUE(article_id, tag_id)`
- `article_option` は重複禁止: `UNIQUE(article_id, option_id)`
- `media_asset.file_name` は重複禁止: `UNIQUE(file_name)`
- `user.cf_access_sub` は `UNIQUE`（`NULL` を許容する実装。PostgreSQLは `NULL` 同士を重複扱いしない）
- `user.email` は `UNIQUE`（大文字小文字を同一視する実装を推奨）
- `user.role` は列挙制約: `admin/staff`
- `user.profile` は `max_length=300`
- `user` は `CHECK (NOT is_active OR (cf_access_sub IS NOT NULL AND display_name IS NOT NULL AND profile IS NOT NULL AND char_length(btrim(display_name)) > 0 AND char_length(btrim(profile)) > 0))` を推奨
- `article_publish_request.status` は列挙制約（例: `pending/approved/rejected`）
- `article.status` は列挙制約（例: `draft/publish/private`）+ `DEFAULT 'draft'`
- `article.thumbnail_mode` は列挙制約（例: `uploaded/default/generated`）
- `article.title` / `article.slug` / `article.summary` / `article.body_html` は空文字禁止を推奨: `CHECK (char_length(btrim(col)) > 0)`
- `article.views_total` は負数禁止を推奨: `CHECK (views_total >= 0)`
- `article` は公開状態と公開日時の整合を推奨: `CHECK ((status = 'publish' AND published_at IS NOT NULL) OR (status <> 'publish' AND published_at IS NULL))`
- `article.thumbnail_asset_id` は常時 `NOT NULL`（`default` モード時も `MEDIA_ASSET` の既存デフォルト画像IDを参照）
- `article` はロック4項目（`locked_by_id`, `locked_at`, `lock_token`, `lock_expires_at`）を同時NULLまたは同時NOT NULLにする `CHECK` を推奨
- `article` はロック期限の前後関係を推奨: `CHECK (lock_expires_at IS NULL OR lock_expires_at > locked_at)`
- `article_save_log.status` は列挙制約（例: `failed/started/completed`）
- `contact.subject_type` は列挙制約（例: `review/blog`）

## ARTICLE_SAVE_LOG運用メモ

- 記事保存フローの監査用ログを保持する。
- カラムは `occurred_at`, `request_user_id`, `lock_token`, `target`, `status`, `message` を持つ。
- `request_user_id` カラムには、`USER.id` の UUID を保存する。
- フロントはAPI経由で、`request_user_id` や時間範囲を条件に絞り込んで参照する。
- 詳細ログの保存先はログファイルではなくDBテーブルとする。

## オプション運用メモ

- `is_pr` / `is_ad` は `ARTICLE` カラムで持たず、`ARTICLE_OPTION` で管理する。
- `OPTION.code` に `pr` / `ad` / `non_monetized` を登録し、記事への適用は `ARTICLE_OPTION` で表現する。
- `non_monetized` が付与された記事は、公開側で AdSense スクリプトを読み込まない。
- 将来オプション追加（例: `sponsored`）は `OPTION` 追加のみで対応する。

## CONTACT運用メモ

- `email_confirm` は問い合わせAPIの入力確認用フィールドであり、DBには保存しない。
- `CONTACT` テーブルには `email` のみ保存する。

## MEDIA_ASSET運用メモ

- `MEDIA_ASSET.id` は内部識別子であり、画像ファイル名そのものではない。
- 画像参照に必要なファイル名は `file_name` に保存する。
- `processing_options_json` には実際に適用した画像処理オプションを保存する。
- `exif_json` のキーは `ISO`, `F`, `SS`, `WB`, `機種名`, `レンズ`, `焦点距離` を使用する。

### exif_json サンプル（JSON）

```json
{
  "ISO": 160,
  "F": "F2.8",
  "SS": "1/250",
  "WB": "Auto",
  "機種名": "X-T5",
  "レンズ": "XF16-55mmF2.8",
  "焦点距離": "23mm"
}
```
