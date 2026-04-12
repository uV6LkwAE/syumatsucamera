# 実装計画

本ドキュメントは、現行の OpenAPI と要件 md をもとにした実装計画です。

- API定義の正本: `backend/openapi/api-design.yaml`
- 要件の正本: `AGENTS.md`
- 既存の `api_implementation_order.md` は参考としつつ、現状と差分があるため本ドキュメントを優先する

## 1. 実装方針

- 最初に共通基盤を固め、その後に `users` -> `cms` -> `public` -> `contacts` -> `ogp` の順で進める
- `cms` 実装の途中で、APIと密結合な非同期処理を先に入れる
  - 画像処理
  - OGP生成
  - TOC生成
  - 頻出タグ更新
- 最初のマイルストーンは「CMSログイン済みユーザーが記事を作成・編集できる状態」とする
- 次のマイルストーンは「公開申請フローが通り、公開側で記事表示できる状態」とする

## 2. タグ単位の実装順

### 2.1 system

目的:
- 全APIの土台を先に揃える

実装対象:
- `GET /health`
- DRF共通例外ハンドリング
- Cloudflare Access middleware
- permission_classes
- Redis lock / PV / rate limit 共通層
- 共通 pagination

完了条件:
- health check が返る
- Access 保護対象APIで `request.user` が解決できる
- admin / author の permission を View に適用できる

### 2.2 users

目的:
- CMS 利用者の onboarding と認証後セッション確認を成立させる

実装対象:
- 仮登録
- 招待URL発行
- 本登録
- セッション確認
- ユーザー一覧 / 詳細 / 更新

完了条件:
- 管理者が仮登録ユーザーを作成できる
- 招待URLから本人が本登録できる
- `GET /api/users/session/me` で CMS 初期表示に必要な情報が返る

### 2.3 cms

目的:
- 記事編集、同時編集ロック、画像アップロード、公開申請の中核を成立させる

実装対象:
- カテゴリ管理
- 記事編集セッション
- 記事内画像アップロード
- 記事 CRUD
- 公開申請
- 記事保存フローログ

完了条件:
- author / admin が記事編集できる
- 悲観ロックが機能する
- Jodit から画像アップロードできる
- 保存後に後処理ジョブが起動する
- author が公開申請でき、admin が承認 / 却下できる

### 2.4 public

目的:
- 公開側 SPA が必要とする read API を揃える

実装対象:
- 公開記事一覧
- 記事詳細

完了条件:
- `publish` 記事だけが返る
- 記事詳細で `toc`、`ogp_by_url`、関連記事、PV 加算が機能する
- OGPカード化は本文HTMLを書き換えず、公開側でURL単体リンクを正規表現判定して行う

### 2.5 contacts

目的:
- 公開問い合わせフォームと管理一覧を成立させる

実装対象:
- 公開問い合わせ送信
- CMS 側問い合わせ一覧

完了条件:
- Turnstile 検証付きで問い合わせ保存できる
- 自動返信メールの送信までつながる
- CMS 側で問い合わせ一覧を取得できる

### 2.6 ogp

目的:
- OGP レコードの運用管理を成立させる

実装対象:
- OGP 一覧 / 詳細
- 編集
- 削除
- 再取得

完了条件:
- 記事保存後に作られた OGP レコードを一覧確認できる
- 個別修正と再取得ができる

## 3. フェーズ別計画

### Phase 0: 共通基盤

1. Django / DRF 初期設定
2. logging / 例外レスポンス方針
3. Cloudflare Access middleware
4. `core/permissions/cms_permissions.py`
5. `redis_layer`
6. 共通 pagination
7. `GET /health`

### Phase 1: users

1. User モデルと role / status 設計
2. `GET /api/users/session/me`
3. `POST /api/users`
4. `POST /api/users/{user_id}/invite`
5. `GET /api/users/activate/{user_id}`
6. `POST /api/users/activate/{user_id}`
7. `GET /api/users`
8. `GET /api/users/{user_id}`
9. `PATCH /api/users/{user_id}`

### Phase 2: cms の基礎

1. Category モデルとツリー取得
2. `GET /api/cms/categories`
3. `POST /api/cms/categories`
4. `PATCH /api/cms/categories/{category_id}`
5. `DELETE /api/cms/categories/{category_id}`
6. Article / Tag / ArticleTag / Option / ArticleOption の土台
7. `POST /api/cms/article-sessions`
8. `PATCH /api/cms/article-sessions/{lock_token}`
9. `POST /api/cms/article-images`

### Phase 3: 記事 CRUD

1. `POST /api/cms/articles`
2. `GET /api/cms/articles/{article_id}`
3. `PATCH /api/cms/articles/{article_id}`
4. `GET /api/cms/articles`
5. `DELETE /api/cms/articles/{article_id}`
6. 保存時の入力検証
  - slug 生成
  - `twitter_card`
  - `thumbnail_request`
  - `article_option`
  - 画像差分
  - `lock_token` 照合

### Phase 4: 記事保存後処理

1. `process_images`
2. `build_ogp`
3. `build_toc`
4. `update_hot_tags`
5. `ARTICLE_SAVE_LOG` 記録
6. `GET /api/cms/article-save-logs`

完了条件:
- 保存後にジョブが走る
- 失敗画像をログ参照できる
- 記事本文のリンクから OGP キャッシュを保存できる
- 公開可否判定に画像処理結果を使える

### Phase 5: 公開申請

1. `POST /api/cms/articles/{article_id}/publish-requests`
2. `POST /api/cms/publish-requests/{publish_request_id}/approve`
3. `POST /api/cms/publish-requests/{publish_request_id}/reject`

完了条件:
- author は公開申請できる
- admin は承認 / 却下できる
- 画像処理未完了記事は公開できない

### Phase 6: public

1. `GET /api/public/articles`
2. `GET /api/public/articles/{category_slug}/{article_slug}`

補足:
- 公開APIは `publish` 記事のみ返す
- 新着/人気/カテゴリ/タグ/タイトル検索/著者絞り込みは `GET /api/public/articles` のクエリで表現する
- 記事詳細で Redis PV 加算を入れる
- 記事詳細は `path`、`category.path`、`article_option`、`toc`、`ogp_by_url` を返す
- 記事メタ情報には `is_profit` を含め、Cloudflare Worker が AdSense 注入可否を判定できるようにする

### Phase 7: contacts

1. `POST /api/contacts`
2. `GET /api/cms/contacts`

### Phase 8: ogp

1. `GET /api/ogp`
2. `GET /api/ogp/{ogp_id}`
3. `PATCH /api/ogp/{ogp_id}`
4. `DELETE /api/ogp/{ogp_id}`
5. `POST /api/ogp/{ogp_id}/refetch`

## 4. API単位の実装順

### system

1. `GET /health`

### users

1. `GET /api/users/session/me`
2. `POST /api/users`
3. `POST /api/users/{user_id}/invite`
4. `GET /api/users/activate/{user_id}`
5. `POST /api/users/activate/{user_id}`
6. `GET /api/users`
7. `GET /api/users/{user_id}`
8. `PATCH /api/users/{user_id}`

### cms

1. `GET /api/cms/categories`
2. `POST /api/cms/categories`
3. `PATCH /api/cms/categories/{category_id}`
4. `DELETE /api/cms/categories/{category_id}`
5. `POST /api/cms/article-sessions`
6. `PATCH /api/cms/article-sessions/{lock_token}`
7. `POST /api/cms/article-images`
8. `POST /api/cms/articles`
9. `GET /api/cms/articles/{article_id}`
10. `PATCH /api/cms/articles/{article_id}`
11. `GET /api/cms/articles`
12. `DELETE /api/cms/articles/{article_id}`
13. `POST /api/cms/articles/{article_id}/publish-requests`
14. `POST /api/cms/publish-requests/{publish_request_id}/approve`
15. `POST /api/cms/publish-requests/{publish_request_id}/reject`
16. `GET /api/cms/article-save-logs`

### public

1. `GET /api/public/articles`
2. `GET /api/public/articles/{category_slug}/{article_slug}`

### contacts

1. `POST /api/contacts`
2. `GET /api/cms/contacts`

### ogp

1. `GET /api/ogp`
2. `GET /api/ogp/{ogp_id}`
3. `PATCH /api/ogp/{ogp_id}`
4. `DELETE /api/ogp/{ogp_id}`
5. `POST /api/ogp/{ogp_id}/refetch`

## 5. 先に終わらせるべきマイルストーン

### マイルストーン 1

CMS ログイン済みユーザーが記事を編集できる。

必要範囲:
- Phase 0
- Phase 1
- Phase 2
- Phase 3

### マイルストーン 2

記事保存後処理と公開申請フローが通る。

必要範囲:
- Phase 4
- Phase 5

### マイルストーン 3

公開側 SPA が主要ページを表示できる。

必要範囲:
- Phase 6

### マイルストーン 4

運用補助機能が揃う。

必要範囲:
- Phase 7
- Phase 8

## 6. 注意点

- `article-save-logs` は API 単体では完結せず、保存後ジョブとログ記録の実装が前提になる
- `ogp` タグの API は、記事保存後に OGP レコードが生成される前提で実装する
- `public` 記事詳細 API は依存が最も多いため、一覧系より実装コストが高い
- `api_implementation_order.md` に残る古い記述は、実装タスク起票前に本ドキュメントへ統一する
