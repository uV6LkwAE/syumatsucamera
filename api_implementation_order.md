# API実装順序（ざっくり）

本ドキュメントは、バックエンドAPIを先行実装するための推奨順序をまとめたものです。  
`AGENTS.md` と `backend_app_structure.md` の方針（`views.py / services.py / serializers.py` 分離、`redis_layer` 集約）を前提にしています。

## 1. 基盤共通（最初）

目的: 以降の実装で仕様ブレを防ぐ。

- Django / DRF 基本設定
- logging 設定（`django.request` / `app` ロガー含む）
- 例外レスポンス方針の共通化
  - 日本語メッセージ
  - 500は `{"detail": "サーバー内部でエラーが発生しました。"}`
  - ValidationError は DRF 標準の辞書形式
- Cloudflare Access 認証ミドルウェア
- Access 保護対象API（記事管理 / ユーザー管理 / OGP管理 / 招待本登録）の各リクエスト単位でヘッダー検証
- DRF permission 基盤（admin/author）
  - adminのみ読み書き
  - author + admin 読み書き
  - authorのみ読み
- `redis_layer`
  - `keys.py`
  - `lock.py`
  - `pv_counter.py`
  - `rate_limit.py`

## 2. モデルと最小CRUDの土台

目的: CMSコアAPI実装のための最低限の永続化層を先に固める。

- `users`
  - 仮登録
  - 招待URL発行
  - 本登録
  - セッション確認
- `cms`（統合アプリ）
  - Article
  - Category
  - Tag
  - ArticleTag
  - Option / ArticleOption
  - ArticlePublishRequest
  - MediaAsset
  - OGP系
  - Contact
- `serializers.py` / `views.py` / `services.py` の枠組み作成

## 3. CMS記事編集コアAPI（最優先）

目的: CMSで記事を作って編集できる状態を先に成立させる。

- 記事作成 API（初回保存で作成）
- 記事取得 API
- 記事更新 API
  - 入力検証
  - slug生成
  - `thumbnail_asset_id`
  - 画像差分（追加/削除）入力の検証
- 記事削除 API
  - 本文画像 / サムネイル物理削除ルール`thumbnail_asset_id` 実体を削除
  `preset_logo` 除外

## 4. 同時編集ロックAPI（悲観ロック）

目的: 編集競合事故を先に防ぐ。

- ロック取得 API
- TTL延長 API（5分ごと）
- 保存APIでの `lock_token` 照合

## 5. 画像アップロードAPI（記事内画像・サムネイル）

目的: Jodit連携とメディア登録を成立させる。

- 記事内画像アップロード API
  - `FormData.append("file", file, "{uuid}.{ext}")` 前提
  - UUIDファイル名検証 / MIME / サイズ検証
  - 相対パス返却（CDN完全URLは返さない）
- サムネイルアップロード API（通常アップロード）
  - MIME / サイズ検証（50MB）
  - `MEDIA_ASSET` 登録

## 6. サムネイル関連API

目的: CMS編集画面でサムネイル運用を確立する。

- サムネイル保存 API
  - クライアント保持の生成画像をPOST
  - MIME / サイズ検証（50MB）
- サムネイル差し替え処理
  - 新サムネイル確定成功後に旧サムネイル削除

## 7. 記事公開フローAPI

目的: CMSの運用ルール（admin/author差分）を成立させる。

- author: 公開リクエスト API
- admin: 承認 / 却下 API
- admin: 直接公開 API（承認スキップ）
- 公開ガード
  - 画像処理ジョブ未完了なら公開不可

## 8. 非同期ジョブ（Celery）: 画像処理を最優先

目的: 公開可能条件に直結するため最初に作る。

- 画像処理ジョブ
  - 記事ロック
  - `/temp` 経由必須
  - 全処理完了時のみコミット
  - 失敗時は正式保存先へ反映しない
  - 正常/異常どちらでも `/temp` cleanup -> ロック解除
  - 共用 `tmp` 前提のためグローバルロックで直列化
- OGP生成ジョブ
- TOC生成ジョブ
- 頻出タグ更新ジョブ

## 9. 公開側Read API

目的: フロント実装前に表示系APIを一通り揃える。

- トップ（人気6 / 新着6）
- 新着一覧 / 人気一覧（ページング）
- 記事詳細
  - `body_html`
  - `ogp_by_url`
  - `cdn_base_url`
  - related articles
  - 非公開404
- カテゴリ一覧
- タグ一覧
- 検索
- PV `INCR`（Redis）

## 10. 問い合わせAPI

目的: 公開機能の主要フォームを成立させる。

- 入力検証
- Turnstile 検証
- DB保存
- 自動返信メール送信

## 11. OGP管理 / CMS補助API

目的: 運用補助機能を追加する。

- OGP一覧 / 再取得 / 編集 / 削除
- ユーザー管理 / 権限付与
- メディア管理（必要なら）

## 12. 定期実行ジョブ（management commands）

目的: 本番運用に必要な保守・集計処理を揃える。

- PV flush（30分）
- OGPリンク健全チェック（月次）
- OGP全件再fetch更新（月次、統合/分離は実装時判断）
- NASバックアップ（3日）

## 13. SEO / 公開補助

目的: 公開品質を仕上げる（API本体の後でよい）。

- sitemap（Django sitemaps）
- OGP/Twitter meta 用の公開側データ整備
- `robots.txt` / `ads.txt`（静的ファイル、API不要）

## 実装の区切り（おすすめ）

最初のマイルストーンは以下:

1. 基盤共通
2. CMS記事編集コアAPI
3. 同時編集ロックAPI
4. 画像アップロードAPI
5. サムネイルAPI
6. 画像処理ジョブ
7. 公開フローAPI

ここまでで、CMS運用の中核（作成・編集・画像・公開判定）が一通り成立します。
