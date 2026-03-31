# 新構成CMSアプリ - 基本要件

## 禁止する操作
- 勝手に依存関係を変更せず、必ずユーザーに許可を取ってください。
- 新しい依存関係をユーザーが許可した場合、requirements.txtやpackage.jsonに書き込んでください。
- 実際のインストールは私がコンテナに入って手動で実行します。
`npm ci`も同様です。
- マイグレーションファイルの作成は不整合が起きるため、私が手動で行います。
- 一時的なデバッグ用途では、`print(hogehoge, flush=True)`を使用してください。
- 本番環境かつ恒久的なメッセージを残す場合、logger.logに書き出してください。
- 環境変数がいい例ですが、何か足りないデータがあったときフォールバックせずにすぐ落としてください。

## 実装ルール（追加）
- `__init__.py` には原則何も書かない
- コメントアウトはコードの右に書かない。必ずコメントしたい行の上に書くこと
- docstringは一行形式を使わず、複数行形式で統一する
- Pythonコード内で `os.environ` から直接環境変数を参照しない。必ず `settings/base.py` に定義した変数を経由して参照する
  ```python
  """
  固定窓レート制限キーを返す。
  """
  ```

## 開発環境での切替方針（DEBUG）
- 開発環境で再現が難しい要件は、`DEBUG=True` のときのみ代替経路に切り替える。
- 本番相当の挙動は `DEBUG=False` を正とし、最終確認は staging または本番同等環境で行う。
- 切替時もAPIの入出力契約（レスポンス形式、エラーcode）は変えない。
- 切替可否や代替挙動は settings で明示し、実装側で暗黙分岐しない。
- 対象項目:
  - Turnstile:
  `DEBUG=True` 限定で `DEV_TURNSTILE_BYPASS` を許可する。実トークン検証は `DEBUG=False` で必須。
  - メール送信（SMTP）:
  dev は MailHog または console backend に切り替える。本番SMTP直送は `DEBUG=False` のみ。
  - OGP取得（外部HTTP fetch）:
  dev はモックレスポンス併用を許可する。外部サイト実fetchは本番相当環境で確認する。
  - 画像配信/CDNパス:
  `cdn_base_url` は環境別に分離し、dev と本番でURL混在させない。
  - Celery/定期ジョブ依存処理（画像処理、PV反映など）:
  API後続処理を検証できるよう dev compose に worker/cron を含める。
  - HTTPS前提挙動（Secure Cookie, SameSite, Origin）:
  ローカルHTTPでは差分が出るため、最終確認は staging で実施する。

## Cloudflare Access 初期セットアップ（sub）
- 本番環境の `sub` は任意値を使わない。Cloudflare Access JWT の `sub` クレーム実値を使用する。
- 初期管理者作成時の `cf_access_sub` 引数には、JWT の `sub` 平文を渡す。
- 保存時はアプリ側で HMAC 化して `users.cf_access_sub` に保存するため、平文はDB保存しない。
- `sub` はブラウザの `CF_Authorization` クッキー値から取得し、JWT payload をローカルでデコードして確認する。
- 取得手順:
  1. `cms` ドメインへ Cloudflare Access ログインする。
  2. ブラウザ開発者ツールで `CF_Authorization` クッキー値をコピーする。
  3. ローカルでJWT payloadをデコードし、`sub` を確認する。
  ```bash
  export CF_JWT='コピーしたCF_Authorization'
  python - <<'PY'
  import json, base64, os
  token = os.environ["CF_JWT"]
  payload = token.split(".")[1]
  payload += "=" * (-len(payload) % 4)
  data = json.loads(base64.urlsafe_b64decode(payload))
  print(json.dumps(data, ensure_ascii=False, indent=2))
  print("sub =", data.get("sub"))
  PY
  ```

必須環境変数:
- `CLOUDFLARE_ACCESS_SUB_HASH_SECRET`:
  全環境必須。`sub` のHMACキー。32byte以上のランダム文字列を設定する。
- `DEV_ACCESS_JWT_SECRET`:
  開発環境のみ。開発用JWT署名キー。32byte以上のランダム文字列を設定する。
- `DEV_ACCESS_JWT_SUB`:
  開発環境のみ。開発用JWTに埋める `sub` 平文。初期管理者の `sub` と同じ値を設定する。

開発環境での `sub` 反映手順（推奨順）:
1. `sub` を取得して控える。
2. `.env.dev` の `DEV_ACCESS_JWT_SUB` に同じ `sub` を設定する。
3. 追加した環境変数を反映するため backend コンテナを再作成する。
```bash
docker compose -p syumatsucamera-dev -f compose/compose.dev.yml up -d --force-recreate --no-deps backend
```
4. 初期adminが未作成なら bootstrap で作成する。
```bash
docker compose -p syumatsucamera-dev -f compose/compose.dev.yml exec backend \
python manage.py shell -c "from users.bootstrap_admin import ensure_initial_admin; r=ensure_initial_admin(email='admin@example.com', password='change-me', cf_access_sub='google-oauth2|1172...', display_name='Admin', profile='initial admin', icon='/media/users/icons/default.png', header_image='/media/users/headers/default.png'); print({'created': r.created, 'id': str(r.user.id), 'email': r.user.email})"
```
5. 既存adminへ後付けする場合は `sub` をハッシュ化して保存する。
```bash
docker compose -p syumatsucamera-dev -f compose/compose.dev.yml exec backend \
python manage.py shell -c "from users.models import User,UserRole; from core.auth.cloudflare_access_subject import hash_cloudflare_access_sub; sub='google-oauth2|1172...'; u=User.objects.filter(role=UserRole.ADMIN).order_by('created_at').first(); u.cf_access_sub=hash_cloudflare_access_sub(sub); u.is_active=True; u.save(update_fields=['cf_access_sub','is_active','updated_at']); print(str(u.id), u.email)"
```
6. 最後に backend を再起動する。
```bash
docker compose -p syumatsucamera-dev -f compose/compose.dev.yml restart backend
```
7. 補足:
`users.cf_access_sub` には平文 `sub` は保存しない。アプリ側でハッシュ化した値のみ保存する。

## 例外レスポンス方針
- APIの業務エラーは `rest_framework.exceptions` を使って送出する。
- API層では `NotFound` と `ValidationError` を標準とし、メッセージ文言ではなく `code` でフロント制御する。
- エラーレスポンスのJSONは必ず `detail` と `code` を含める。
- `request_id` は返さない。
- ミドルウェアのエラーも同じJSON形（`detail`, `code`）に合わせる。

標準レスポンス例（400）:
```json
{
  "detail": "入力エラーです。",
  "code": "VALIDATION_ERROR",
  "errors": {
    "display_name": [
      "この項目は必須です。"
    ]
  }
}
```

標準レスポンス例（404）:
```json
{
  "detail": "対象リソースが存在しません。",
  "code": "RESOURCE_NOT_FOUND"
}
```

標準レスポンス例（500）:
```json
{
  "detail": "サーバー内部でエラーが発生しました。",
  "code": "INTERNAL_ERROR"
}
```

想定される `code` 一覧:

| code | 概要 |
| --- | --- |
| `VALIDATION_ERROR` | リクエスト入力値が不正 |
| `AUTH_REQUIRED` | 認証情報が不足している |
| `AUTH_TOKEN_INVALID` | JWTが不正、期限切れ、署名不一致 |
| `AUTH_USER_NOT_FOUND` | 認証済み主体に対応するユーザーが存在しない |
| `PERMISSION_DENIED` | 認証済みだが操作権限がない |
| `RESOURCE_NOT_FOUND` | 対象リソースが存在しない |
| `METHOD_NOT_ALLOWED` | 許可されていないHTTPメソッド |
| `RESOURCE_CONFLICT` | リソース競合（重複、状態競合など） |
| `RATE_LIMITED` | レート制限超過 |
| `SERVICE_UNAVAILABLE` | 一時的にサービス利用不可（依存先障害など） |
| `INTERNAL_ERROR` | サーバー内部エラー |
| `API_ERROR` | 上記に分類できないAPIエラー |

## レイヤー責務と分割方針
- View層の責務:
  - 認証と権限判定
  - リクエスト入力の検証
  - Serviceから受け取ったデータをSerializerに通して返却
- Service層の責務:
  - 業務ロジック全般
  - 状態遷移、整合性チェック、トランザクション制御
- Serviceは肥大化しやすいため、責務単位で複数ファイルへ分割する。
- 複数サービスを管理する場合は `services/` ディレクトリを作成し管理する。
- Serializerは原則として入力と出力の双方で通す。
- きわめてシンプルなJSON返却のみ、Serializerを省略可能とする。
- Serializerクラスが肥大化する場合は、責務ごとに分割して管理する。
- 命名は `HogeViewSet` / `HogeService` のように用途単位でまとめる。
- DRFの思想（View, Serializer, Permission, Exception Handlerの責務分離）に沿って実装する。

services ディレクトリ構成例:
```text
backend/booths/services
.
├── booth_asset_manage_services.py
├── booth_qr_services.py
└── booth_services.py
```

## 0. 技術スタック
フロントエンド: React
バックエンド: DjangoRestFramework
データベース: Postgres, Redis
その他: DockerCompose
バックエンドとフロントエンドを一つのリポジトリで管理する、モノレポ運用で進める。
開発環境（DockerCompose）
- Nginx
CORS対策のため、Nginxですべてプロキシし対策する
- Backend
Django稼働用
- Postgres
- Redis
- Frontend
devのみVite動かす用途

本番環境（k3s）
- クラスタ: k3s（オンプレミス UbuntuServer 上）
- デプロイ単位:
  - cloudflared: Deployment（Cloudflare Tunnel 終端）
  - nginx: Deployment（入口 gateway + 静的ファイル配信）
    ビルド済みReact成果物（静的ファイル）はNginxで配信する（frontend Podは不要）
  - backend: Deployment（Django/DRF）
  - redis: Deployment
  - postgres: StatefulSet
  - worker: Deployment（Celery）
  - cronjob: CronJob（定期実行）
- 外部公開:
  - NodePortは開放せず、Cloudflare Tunnel（cloudflared Pod）経由で gateway Nginx に到達させる
  - `/cms` は `cms.syumatsucamera.com` として公開し、Cloudflare Access（SSO）で認証する


ポイント
- 既存はDjangoでFE,BEを担っていた。
LCPやCLSスコアが悪いため、高速なSPAに移行するのが目的。
それに伴いアプリを1から作り直し、根本から設計し直す。

実装ポリシー
backend_app_structure.md も確認すること。
- 冪等であること
- 高速であること
- ロジックは使い回さず可能な限り共通化する
- 実運用を意識した実装にする

---

## 1. システム全体要件
- 開発環境ではDockerComposeを利用する。
- 本番環境ではオンプレミスのUbuntuServerでk3sを用いて稼働させる。
- ポート開放は行わず、CloudFlareTunnelを利用する。
```
Internet
  ↓
CloudflareTunnel (cloudflared Pod)
  ↓
nginx (gateway)
  ├─ /       → frontend
  ├─ /api    → backend
  └─ /cms    → 非公開（Cloudflare Accessで認証）
```
- `/cms` は `cms.syumatsucamera.com` として公開し、Cloudflare Accessで認証を行う。
  - SSO（Googleアカウントでログイン）で認証する。
- DjangoRestFrameworkベースのブログサイト「週末カメラ」を運用する。
- 公開側機能:
  - 記事閲覧
  - カテゴリ/タグ/検索
  - 問い合わせフォーム
- 管理側機能:
  - 独自CMSでの記事管理
  - 執筆者, ユーザー管理
  - カテゴリ管理
  - メディア管理
  - OGPキャッシュ管理

---

## 2. ルーティング（SPA構成）
管理者
```
cms.syumatsucamera.com  （Cloudflare Accessで認証）
├─ /console                       # コンソール（トップ）
│  ├─ /articles                   # 記事管理（一覧・並び替え：新しい/古い/人気）
│  │  ├─ /new                     # 新規作成画面（保存時に初回作成）
│  │  └─ /{articleId}/edit        # 記事編集（Joddit / 画像管理 / 公開設定）
│  ├─ /categories                 # カテゴリ管理（ツリー表示）
│  │  ├─ /new                     # 作成
│  │  └─ /{categoryId}/edit       # 編集
│  ├─ /contacts                   # 問い合わせ管理（一覧）
│  ├─ /users                      # ユーザー（執筆者）管理（一覧）
│  │  └─ /{userId}                # ユーザー詳細（権限付与など）
│  ├─ /ogp                        # OGPキャッシュ管理
│  │  ├─ /                        # 一覧
│  │  └─ /{ogpId}                 # 詳細（再取得/編集/削除）
│  ├─ /media                      # メディア管理（削除するかも）
│  └─ /settings                   # 設定（必要に応じて）
│     ├─ /permissions             # 権限管理（管理者向け）
│     └─ /jobs                    # ジョブ/ワーカー状況（任意）
├─ /error
│  ├─ /404                        # CMS側NotFound
│  └─ /500                        # CMS側InternalError
└─ /*                             # 未定義パス → /error/404 に遷移
```

一般ユーザー
```
syumatsucamera.com
├─ /                              # トップ（人気6 + 新着6）
├─ /articles
│  ├─ /new                        # 新着一覧（9件ページング）
│  ├─ /popular                     # 人気一覧（9件ページング）
│  └─ /notes
│     ├─ /privacy-policy/          # プライバシーポリシー（記事）
│     ├─ /administrator-self-introduction/ # 自己紹介（記事）
│     └─ /{articleSlug}/           # 記事詳細（publishのみ / PVはRedis incr）
├─ /category
│  └─ /{categorySlug}/             # カテゴリを含む記事一覧（子孫含む・12件ページング）
├─ /tag
│  └─ /{tagSlug}/                  # タグを含む記事一覧（12件ページング）
├─ /search
│  └─ ?q=...                       # タイトル部分一致
├─ /contact                        # 問い合わせフォーム
├─ /error
│  ├─ /404                         # NotFound（SPA内部表示用）
│  └─ /500                         # InternalError（SPA内部表示用）
└─ /*                              # 未定義パス → /error/404 に遷移
```

---

## 3. 公開側要件

## 3.1 トップページ
- 人気記事・新着記事を表示。
- いずれも `status='publish'` のみ対象。
- 表示件数: 各6件。

## 3.2 一覧ページ
- 新着一覧: 公開記事を作成日降順、9件ページング。
- 人気一覧: 公開記事をPV降順、9件ページング。
  - 人気順の参照元は必ずPostgresの確定値を利用する。

## 3.3 記事詳細ページ
- URLキー: `category.slug` + `article.slug`。
- 非公開記事（`publish` 以外）は404。
- 表示時にPVをRedisへインクリメント。
  - Redisはインクリメントの増分を一時的に貯めるために利用する。
  - Postgresへの加算は定期実行（例: 1時間ごと）でまとめて反映する。
  - 参照（人気順など）は常にPostgresの確定値を参照する。
  - Redis→Postgres加算の冪等性・取りこぼし対策の詳細仕様は保留とする。
- 関連記事:
  - 同カテゴリから人気順で最大6件
  - 足りない分は全カテゴリから補完
- カテゴリパンくず、タグ、著者情報、PR/AD表示を出し分け。
- 記事APIは、一覧・詳細ともに記事詳細画面の遷移先URLとカテゴリ画面の遷移先URLを返す。
- 本文はOGP埋め込みをレンダリングし、画像URLをCDN用に変換。

## 3.3.1 記事ページのSEOメタ（OGP/Twitter）
- 記事詳細ページでは、公開時に以下のSEOメタを出力する。
  - `<title>`（例: `記事タイトル | サイト名`）
  - `<meta name="description">`
  - `<link rel="canonical">`
  - OGPメタ（`og:*`）
  - Twitter Cardメタ（`twitter:*`）
- `og:type` は記事ページでは `article` を使用する。
- `og:locale` は `ja_JP` を使用する。
- `og:url` / `canonical` は公開URL（正規URL）を使用する。
- `og:image` / `twitter:image` は記事のサムネイル画像URLを使用する。
- `description` 系は記事要約（summary）を基本とする。
- サムネイル未確定時はデフォルトサムネイルを使用してメタを構成する。

出力対象の例（方針）:

- `<title>記事タイトル | サイト名</title>`
- `<meta name="description" content="ページの説明">`
- `<link rel="canonical" href="https://example.com/articles/slug/">`
- `<meta property="og:site_name" content="サイト名">`
- `<meta property="og:locale" content="ja_JP">`
- `<meta property="og:type" content="article">`
- `<meta property="og:title" content="記事タイトル">`
- `<meta property="og:description" content="ページの説明">`
- `<meta property="og:url" content="https://example.com/articles/slug/">`
- `<meta property="og:image" content="https://example.com/media/ogp/slug.jpg">`
- `<meta name="twitter:card" content="summary_large_image">`
- `<meta name="twitter:title" content="記事タイトル">`
- `<meta name="twitter:description" content="ページの説明">`
- `<meta name="twitter:image" content="https://example.com/media/ogp/slug.jpg">`
- `<meta name="twitter:site" content="@syumatsucamera">`

## 3.3 記事表示時の要件
記事を表示するときにAPIから取得した記事を以下のように加工する必要がある。
1. 記事データを取得
- APIから `body_html` を受け取る
- （OGPを出すなら）`ogp_by_url` も同時に受け取る
- CDNの基底URL（例：`cdn_base_url`）を設定（APIで返してもOK）

2. 本文HTMLをパースして、同時に加工する（パースは1回）
- ノードを見つけるたびに加工し、描画用のReact要素を生成する
- 同時に目次用の見出し情報も収集する

3. 見出し（h1/h2/h3）を収集し、パンくずでID生成しつつ、見出しにidを付与する
- `h1/h2/h3` を出現順に走査する
- 見出しテキストを取り出す
- current_h1/current_h2/current_h3 を更新する（パンくず管理）
- `breadcrumb = normalize(h1) + ">" + normalize(h2) + ">" + normalize(h3)` のような文字列を作る（存在する階層だけ）
- `id = "h-" + hash(breadcrumb)` を生成する
- 同一IDが出たら `-2`, `-3` で重複回避する
- 見出しノードへ `id` を付与して描画用に置換する（DB本文は変更しない）

4. 画像の `src` をCDNリンクに置換する
- `<img>` を見つけたら `src` を読み取る
- `data:` / `blob:` はそのままにする
- `http(s)://` の絶対URLは原則そのままにする（CDN配下に寄せたいなら別ルールにする）
- `/media/...` や相対パスは `cdn_base_url + パス` に変換する
- 変換後の `src` で `<img>` を再生成して置換する

5. OGPカードを挿入する（必要な場合）
- 本文HTMLをパースして `<a>` を見つけたら `href` を正規化して `ogp_by_url` を引く
- 対象がURL単体リンクで `ogp_by_url` に該当データがある場合は、自作の `<OgpCard>` に置換する（元リンクは表示しない）
- `ogp_by_url` に該当データがない場合のみ、元の `<a>` リンクをそのまま表示する

### 記事本文内の埋め込み方針（X / OGP）

- CMS本文では、外部サービスの `script` タグをそのまま永続保存しない。
- 埋め込みは「保存時の表現」と「公開時の描画」を分離する。
- 公開側レンダリングで本文を1回パースする際に、埋め込み変換を行う。

#### X（旧Twitter）埋め込み方針

- X投稿埋め込みは `iframe` 直書き前提ではなく、公式の `blockquote + widgets.js` 方式を基本とする。
- Jodit側では、X URL貼り付け時に以下のいずれかで保存する。
  - 独自プレースホルダとして保存する（採用）
- X埋め込みの保存形式は以下で統一する。
  - `<div data-embed="x" data-url="https://twitter.com/.../status/..."></div>`
- 公開側で X URL / プレースホルダを検出し、`blockquote.twitter-tweet` へ変換して描画する。
- SPA描画後に `twttr.widgets.load()` を呼び出して埋め込みを初期化する。
- 失敗時はフォールバックとして元URLリンクを表示する（本文の可読性を維持する）。

X埋め込みの考慮点:

- CSP（Content Security Policy）の許可設定が必要。
  - `script-src` に `https://platform.twitter.com`
  - `frame-src`（または `child-src`）に X/Twitterの埋め込み先ドメイン
- 非公開アカウント/削除済み投稿/制限投稿は表示できない可能性がある。
- 広告ブロッカーやトラッキング防止機能で `widgets.js` がブロックされる可能性がある。
- 埋め込み失敗時でもページ全体の表示を壊さないことを優先する。

#### OGP埋め込み方針（独自）

- OGP埋め込みは外部サイトの公式埋め込みスクリプトに依存せず、独自の `<OgpCard>` コンポーネントで表示する。
- OGP用の独自タグは保存しない。
- マスターの本文HTMLは一切書き換えず、Joditの標準挙動で保存された `<a>` タグをそのまま保持する。
- 公開側で本文HTMLをパースし、`<a>` 要素の `href` と表示文字列を正規表現で判定する。
- 本文中の `<a>` がURL単体リンクと判定され、`ogp_by_url` に該当データがある場合のみカードを表示する。
- OGPカード化の対象は「URL単体リンク」のみとする（誤変換防止）。
  - `href` を持つ
  - 子要素に `img` / `picture` / `video` / `iframe` を含まない
  - 表示内容がURL文字列のみであり、`href` と同一またはURLに準ずる単純テキストであることを正規表現で確認する
- Amazonリンク（一般リンク / アフィリエイトリンク）は OGPカード化の対象外とし、本文リンクをそのまま表示する。
- OGPカードを表示する場合は、重複表示を避けるため元のURLリンクは表示しない（カードへ置換またはリンク要素を吸収）。
- OGP情報が取得失敗/未取得の場合のみ、元の `<a>` リンクをそのまま表示する。
- URL正規化は行わず、完全一致URLをキーにキャッシュする（重複許容）。

AmazonリンクをOGP対象外とする理由:

- `curl` / `fetch` に対して bot 判定され、OGP取得時に 500 系エラーとなるケースがある。
- 公式の Product Advertising API / Creators系API は継続的な販売実績要件があり、初期段階では運用コストが高い。
- 将来的に販売実績が安定した段階で、別実装（公式API利用）を検討する余地は残す。

独自OGPカード仕様（最小要件）:

- 入力データは API の `ogp_by_url` から受け取る。
- カード表示項目（候補）:
  - `url`
  - `title`
  - `summary`（description）
  - `thumbnail_url`
  - `site_name`
- OGP欠損時はNoImage等のフォールバック画像を利用可能とする（要件に従う）。
- カード表示時はカード全体をリンク可能としてよく、元の本文リンクは重複表示しない。
- 外部画像読み込み失敗時にレイアウト崩れを起こさないスタイルにする。

6. TOC（入れ子構造）を構築する
- 3で集めた見出しの `{level, id, text}` を入れ子（`children`）に組み立てる
- h1の下にh2、h2の下にh3を入れる
- 生成したTOCをReactのstate/memoで保持して目次表示に渡す

7. 本文とTOCを描画する
- 本文はパース結果（加工済みReact要素）をそのまま表示する
- TOCは `children` を再帰レンダリングして `<a href="#{id}">` を出す

8. ジャンプ位置のズレを調整する
- 固定ヘッダーがあるなら `h1/h2/h3` に `scroll-margin-top` をCSSで付ける


## 3.4 カテゴリ一覧
- 指定カテゴリの子孫を含む公開記事を一覧表示。
- 12件ページング。

## 3.5 タグ一覧
- 公開記事を一覧表示する。
- 12件ページング。

## 3.6 検索
- クエリパラメータ `q` を記事タイトルで部分一致検索。

## 3.7 sitemap.xml（SEO）
- `django.contrib.sitemaps` を利用して `sitemap.xml` を生成する。
- 公開対象のみを出力し、CMS内部URLや非公開記事は含めない。
- URLごとに `priority` と `changefreq` を明示的に調整する。
- `lastmod` は記事の更新日時（`updated_at`）を返す。
- 記事の属性（`is_pr`, `is_ad`）に応じて優先度の重み付けを行う。
  - 例: PR/AD記事を通常記事よりわずかに高く設定する。
- 優先度は固定値にせず、将来的に運用で調整可能な実装にする。
- サイトマップの責務:
  - クローラ向けに「どのページを優先して巡回してほしいか」を示す。
  - ルーティング定義と不整合を起こさないことを最優先とする。

実装方針（クラス分割）:

1. `StaticViewSitemap`
- 対象: トップ/新着一覧/人気一覧
- `changefreq`: `daily`
- `priority` はページ種別で出し分ける。
  - top: 1.0
  - new: 0.8
  - popular: 0.9

2. `ArticleSitemap`
- 対象: `Article.objects.filter(status='publish')`
- `changefreq`: `weekly`
- `lastmod`: `updated_at`
- `priority` は記事属性で調整する。
  - 通常記事: 0.7
  - PR記事: 0.8
  - AD記事を加味する場合、PRと同等または別の重みを定義して分岐する。

3. `CategorySitemap`
- 対象: `Category.objects.all()`
- カテゴリ一覧URLを `slug` で生成する。
- `priority`: 0.6（カテゴリページは記事詳細より低め）

運用ルール:

- `reverse()` のURL名は実ルーティング名と厳密一致させる。
- `items()` の返却値と `priority()` の判定条件は同一キー体系で管理する。
- 優先度の根拠が不明にならないよう、クラスdocstringで意図を明記する。
- 将来ページ追加時は、対象のSitemapクラスを必ず更新する。

参考実装イメージ:

```python
from django.contrib.sitemaps import Sitemap
from django.urls import reverse
from cms.models import Article, Category


class StaticViewSitemap(Sitemap):
    """トップ/新着/人気の静的ページをサイトマップに載せる。"""

    changefreq = "daily"

    def items(self):
        return ["blog:top", "blog:new_articles", "blog:popular_articles"]

    def location(self, item):
        return reverse(item)

    def priority(self, item):
        if item == "blog:top":
            return 1.0
        if item == "blog:new_articles":
            return 0.8
        if item == "blog:popular_articles":
            return 0.9
        return 0.5


class ArticleSitemap(Sitemap):
    """公開記事をサイトマップに載せ、更新日と優先度を返す。"""

    changefreq = "weekly"

    def items(self):
        return Article.objects.filter(status="publish")

    def lastmod(self, obj):
        return obj.updated_at

    def priority(self, obj):
        if obj.is_pr:
            return 0.8
        return 0.7


class CategorySitemap(Sitemap):
    """カテゴリ一覧ページをサイトマップに載せる。"""

    def items(self):
        return Category.objects.all()

    def location(self, obj):
        return reverse("blog:category_list", kwargs={"slug": obj.slug})

    def priority(self, obj):
        return 0.6
```

## 3.8 robots.txt / ads.txt
- `robots.txt` と `ads.txt` は公開ルート直下で配信する。
  - `/robots.txt`
  - `/ads.txt`
- Django APIで配信せず、Nginxの静的配信で返す。
- 開発時は `frontend/public/` に配置する。
  - `frontend/public/robots.txt`
  - `frontend/public/ads.txt`
- 本番時はフロントエンドのビルド成果物に同梱し、Nginxのドキュメントルート直下に配置する。
- ルーティングや認証（Cloudflare Access）とは切り離し、常に公開側ドメインのルートで取得可能にする。
---

## 4. CMS要件

### 4.1 ダッシュボード
- 執筆者（ユーザー）管理
- 記事一覧（新しい順/古い順/人気順）。
- カテゴリ管理（ツリー表示）。
子カテゴリーあり
- 問い合わせ一覧表示。

### 4.2 記事作成/編集/削除
- 新規作成は編集画面で入力し、保存APIの初回保存で記事を作成する。
- Jodit（無償版）で本文編集。
管理者以外で自身の記事を編集不可にする用途でReadOnlyも使えそう。
- 画像アップロードAPI経由で記事内画像を保存する。
  - 本文にはCDNの完全URLを保存しない。相対パスを保存する。
  - 公開時に本文パース処理で `cdn_base_url` を付与してCDNリンクへ置換する。
  - 画像ファイル名はアップロード時点でUUID名を確定する（後段処理でリネームしない）。
  - フロントは `FormData.append("file", file, "{uuid}.{ext}")` で送信時ファイル名のみUUID化する実装を採用する。
  - サーバー側でUUID形式/拡張子/MIMEを検証し、必要なら再採番可能な設計にする。
  - アップロード先は `lock_token` 単位の `tmp` とし、サーバー側で保存先を強制決定する。
  - `tmp` は k3s の永続ボリュームに保存する。
- サムネイル:
  - サムネイルは `thumbnail_asset_id` のみで管理し、`ARTICLE.thumbnail_mode` は廃止する。
  - 記事保存時のリクエストでは、以下の3択を受け付ける。
    1. ユーザーが選択した画像を使用する（記事内画像と同様にリサイズを適用）
    2. 固定のデフォルト画像を使用する
    3. タイトル文字列をもとに生成した画像を使用する
  - 方式の判定はDBカラムではなく、保存リクエストの `thumbnail_request.mode` で行う。
  - サムネイル上書きは許可し、新規反映成功後に旧サムネイル実体を削除する。
  - サムネイル保存時は、通常アップロード画像と同様にMIMEとサイズ上限を検証する。
  - 許容ファイルサイズ上限は `50MB` とする。
- SEOメタ設定:
  - 記事編集画面で `twitter:card` の種別を選択できるようにする。
  - 選択肢は `summary` / `summary_large_image` とする。
  - `ARTICLE.twitter_card` カラムで保持する。
  - DBカラムは `summary_large_image` を default とし、not null で保持する。
  - 公開時の `<meta name="twitter:card">` は記事設定の値を使用する。
- 管理者は記事の公開,非公開を選択可能
- 管理者は公開承認フローをスキップして直接公開できる。
- ただし、画像処理ジョブが完了していない記事は公開できない（管理者も含む）。
- author は記事自体を公開することはできない。
author は記事執筆完了時に公開リクエストを行い、管理者が承認する。
承認したら公開する。
- 編集削除時に不必要になった画像を一緒に削除
- 記事編集APIでは、本文内画像の差分（追加・削除対象）を検証して処理する。
  - API入力として、追加画像と削除対象画像の情報を受け取る前提とする。
  - サーバー側でも本文HTMLと照合し、矛盾があればエラーにする。
  - 削除対象画像は、原本と公開用画像を両方削除する。
  - 削除対象の `MEDIA_ASSET` レコードも整合を保って更新/削除する。
  - 画像差分JSONは `lock_token`, `new_images`, `delete_images`, `thumbnail_request` を受け取る。
  - 画像差分JSONの例:
    ```json
    {
      "lock_token": "3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d",
      "new_images": [
        {
          "file_name": "9f2c8a1e-1234-5678-9abc-def012345678.jpg",
          "options": {
            "resize": true,
            "exif_watermark": true,
            "site_logo_watermark": false,
            "custom_text_overlay": false,
            "custom_text": ""
          }
        }
      ],
      "delete_images": [
        "2a0e7d75-f03f-4916-a03e-6e4f5ce2e3b9"
      ],
      "thumbnail_request": {
        "mode": "generate_from_title",
        "file_name": "7c89d972-7a3f-4ca1-8a31-25a99aa3380e-thumb.jpg",
        "title_text": "Kyoto Trip"
      }
    }
    ```
- 記事削除時は、記事に紐づく画像をサムネイルを含めてすべて物理削除してよい。
  - 対象: 本文画像（原本/公開用）、サムネイル実体（`thumbnail_asset_id` が指すアセット）
- 画像ファイルの名前が重複したときの対策は？
  - アップロード時にファイル名はuuidへ変換する（記事内画像・サムネイル共通）。
  - Djangoが同名アップロード時に付与するプレフィックスによる回避策（例: (1)）を不要にする。
- slug:
  - slugはタイトルから翻訳して生成する。
  - いったん、非公式のgoogletransを利用する（後で置き換える予定）。
  - slugはロックしない。
  - category.slug / article.slug を変更した場合はURLに反映する。
  - 過去slug（過去URL）は切り捨てる（リダイレクトは行わない）ことを要件として明記する。
- 記事編集を行うときはフラグを立てて、悲観ロックで管理する。
  - 他者が編集中の記事は編集画面をブロックし、編集不可にする。
  - フロントから定期的にTTL延長APIを呼び出してロックを延長する（疎通確認を兼ねる）。
  - TTL延長の呼び出し間隔は `5分` とする。
  - ユーザーがタブを閉じる/離脱した場合は延長されなくなるため、TTL切れで自然解放する。
  - 保存APIでもロック確認（`lock_token` 照合）を行い、ロック保持者以外の更新を拒否する。
- 記事本文サマリーの自動生成機能は現時点では保留とする（将来要件）。

### 4.2 POSTされたあとに実行される処理
記事作成後に処理すべきこと
以下はワーカーに丸投げする。
1. 記事内の画像の処理
以下の順で実行する。
A. ジョブ開始時に対象記事をロックする（ジョブ進行中は記事をロック状態にする）。
B. 画像処理は必ず `tmp/{lock_token}`（一時領域）を経由して行う。
C. リサイズ+Exifから撮影情報取得後、透かしを挿入（ファイル名はアップロード時にUUID確定済み）
D. 処理成功した画像は、その都度オリジナル保存先と公開用保存先へ移動してよい。
E. オリジナルの画像は別のディレクトリに保存し、公開しない。
F. 画像処理が一部失敗しても、成功した画像は保存済みとしてよい。
G. 本文HTML自体は書き換えない。
H. 公開画面とJodit編集画面では、表示時にJSで `tmp` パスを公開用パスへ表面的に置換する。
I. 記事編集APIから渡された削除対象画像について、原本/公開用画像を削除し、関連する `MEDIA_ASSET` を整理する。
J. 正常終了・異常終了のどちらでも、最終処理で対象 `tmp/{lock_token}` ディレクトリ配下をクリーンアップする。
K. `tmp/{lock_token}` クリーンアップ完了後に、ジョブ自身が記事ロックを解除する（成功/失敗時ともに実施）。
L. 画像処理ジョブが完了するまで記事は公開不可とする。
M. 画像処理が1件でも失敗した場合、記事は公開しない。
N. CMS側では対象記事へ警告バッジを表示し、記事保存フローログを参照できるようにする。
O. どの画像が失敗したかは記事保存フローログテーブルへ残す。
2. OGPレコード作成
記事内のリンクのOGPレコードを作成するため、リンク先をfetchする。
結果をOGPテーブルに書き込む。
マスターの本文HTMLは一切書き換えない。
OGPカード化や埋め込み変換は公開側レンダリング時に行い、保存時には本文を汚染しない。
公開側では本文HTMLをパースし、URL単体リンクだけを正規表現で検知してOGPカードへ置換する。
取得に失敗した場合でも記事保存フロー全体は継続し、取得できた範囲のOGP情報のみ保存する。
3. 見出し生成
h1タグなどを認識して、目次をTree状に生成する。
4. 頻出のタグを更新


### 4.3 カテゴリ管理
- カテゴリーの親子の管理方法を検討。
- 作成/編集/削除のCRUD。
- `sort_order` はカテゴリ作成/更新APIで単体入力として受け取らない。
- カテゴリ作成時の並び順は、同一親カテゴリ配下の末尾へ追加する。
- 同一親カテゴリ配下の並び替えは、1件ごとの `sort_order` 更新ではなく、親カテゴリ単位の配列で扱う。
- カテゴリ更新APIでは、対象カテゴリを含む同一親カテゴリ配下の全 `category_id` を順番どおり配列で受け取る。
- カテゴリ削除APIでは、削除後に残る同一親カテゴリ配下の全 `category_id` を順番どおり配列で受け取る。
- 並び替え配列は、対象親カテゴリ配下の全件を過不足なく含むことを必須とする。
- 配列内の重複、不足、他親カテゴリの混入が1件でもあればエラーにする。
- サーバー側は受け取った配列順に `sort_order=0,1,2...` を再採番する。

### 4.4 OGPマネージャー
- OGPキャッシュレコードの一覧。
- 個別/一括に準じた再取得、編集、削除操作。
- OGPの取得タイミング:
  - OGPの情報は記事の保存+編集時にすべて作成する。
  - 夜間ジョブで一か月に1度、OGPレコードを全件fetchしなおして更新する。
  - 記事内のURLをそのままfetchする。
  - URL正規化は行わない（完全一致URLをキーにキャッシュし、重複は許容する）。

---

## 5. 問い合わせ要件（確定）
- 入力項目:
  - 用件（選択）
  - 企業名
  - 担当者名
  - メール
  - メール確認
  - 本文
- Cloudflare Turnstile によるスパム対策。
- 送信成功時に自動返信メール送信。
Gmail-SMTP利用
- 送信内容はDB保存。
- 送信失敗時の扱い、迷惑メール対策（From/Reply-To等）は要件を詰める。

---

## 7. データモデル要件
ER_DIAGRAM.md を参照。

---

## 7. Redisのキーの扱い
前提（共通）
- Redisキーは「重複実行防止（ロック）」「PVの一時集計」「API叩きすぎ防止（レート制限）」のみに使う
- ロックは `SET ... NX EX ...` で取得し、処理完了時にジョブ自身が `DEL` して解放する
- `EX`（TTL）は保険として必ず付与する（TTL切れによる二重実行を避けるため長めに設定する）
- ロック解放は token 一致の場合のみ削除する（誤解放防止）
- ワーカーが異常終了して `DEL` できなくても、TTLでロックが自然消滅し、永久停止しない
- DBが正となるデータ（ジョブ進捗・成功時刻など）の保存はRedisに持たない

1. グローバルロック（同名ジョブの同時実行を禁止）
- キー形式: `lock:job:{job_name}`
- 型: string（値は token）
- 取得: `SET lock:job:{job_name} {token} NX EX {ttl_seconds}`
- 解放: token一致を確認して `DEL`
- TTL: 想定最大実行時間 + 余裕（長めに設定）
- 対象ジョブ（定期実行）
  - `lock:job:pv_flush`（PV更新: 30分に一度）
  - `lock:job:nas_backup`（NASバックアップ: 3日に一度）
  - `lock:job:ogp_link_healthcheck`（OGPリンク健全チェック: 月に一度）
- 対象ジョブ（記事POST後に走るワーカー処理で、全体を単一ジョブとして扱う場合）
  - `lock:job:postprocess_article`（記事の後処理を丸ごと1本として排他したい場合のみ）
  - 通常は 2. の対象単位ロックを使い、グローバルロックは使わない（全記事が直列になるのを避けるため）
  - 画像処理ジョブは `lock_token` 単位の `tmp` を使うため、グローバルロック前提にはしない。

2. 対象単位ロック（記事/アセット単位で同時実行を禁止）
- キー形式: `lock:{target_type}:{target_id}:{job_name}`
- target_type: `article` または `asset`
- 型: string（値は token）
- 取得: `SET lock:{target_type}:{target_id}:{job_name} {token} NX EX {ttl_seconds}`
- 解放: token一致を確認して `DEL`
- TTL: 対象処理の想定最大実行時間 + 余裕（画像処理や外部fetchは特に長め）
- 記事POST後に走るワーカー処理（記事単位で排他）
  - 画像処理（記事内画像の変換〜保存を含む）
    - `lock:article:{article_id}:process_images`
  - OGPレコード作成（リンク先fetch→OGPテーブル書込→フォールバック含む）
    - `lock:article:{article_id}:build_ogp`
  - 見出し生成（h1等から目次Tree生成→toc_json更新）
    - `lock:article:{article_id}:build_toc`
  - 頻出タグ更新
    - `lock:article:{article_id}:update_hot_tags`
  - 記事後処理を「順番付きパイプラインで1回だけ」保証したい場合のまとめロック（任意）
    - `lock:article:{article_id}:postprocess`
    - 使う場合は、上の個別ロックは省略するか、二重ロックにならない設計に統一する
- 画像処理の追加安全策（アセット単位で排他したい場合のみ）
  - `lock:asset:{asset_id}:process_image`
  - 原則は「記事単位ロック」で十分（記事ID確定後に処理する前提のため）

3. PVカウンタ（Redis側の一時集計）
- キー形式: `pv:day:{YYYYMMDD}:article:{article_id}`
- 型: integer（string）
- 更新: `INCR pv:day:{YYYYMMDD}:article:{article_id}`
- TTL: フラッシュ間隔（30分）+ 遅延許容 + 保険（長めに設定）
- フラッシュ処理（30分に一度）
  - `lock:job:pv_flush` を取得してからDBへ反映する（重複フラッシュ防止）
  - 反映後のRedisキーは削除してもよいし、TTLに任せてもよい（運用で統一）
- 備考
  - `REDIS_PV_COUNTER` テーブルは「キー定義/パターン管理」として維持し、実カウントはRedisの上記キーに保持する想定

4. グローバルレート制限（API叩きすぎ防止）
- キー形式: `rl:{scope}:{identifier}:{route}`
- 型: integer（string）
- 更新: `INCR`（初回のみ `EXPIRE` を付与）
- TTL: ウィンドウ幅（例: 60秒 / 600秒 等、ルートごとに設定）
- scope例: `ip` / `session` / `cf`
- identifier例: IP文字列、session_id、Cloudflare由来の識別子等
- route例: `POST_/api/contact` のようにメソッド＋パスを正規化した文字列
- 代表例
  - `rl:ip:{ip}:POST_/api/contact`
  - `rl:ip:{ip}:POST_/api/articles`
  - `rl:ip:{ip}:POST_/api/articles/{article_id}/publish`
- 備考
  - 問い合わせフォームなどの連投制限は、このグローバルレート制限に含める（個別キーは作らない）

---

## 8. 認証・権限要件
- 管理者と author の二つを用意
- 管理者はGUIで author に対して権限をアタッチする
Ex. 記事の作成&編集は許可するが削除は禁止
- 認証方式:
  - 認証はCloudflare Accessで行い、認証済みのヘッダーを付与して転送する。
  - Cloudflare Access の判定はサブドメイン単位の前提に寄せず、Access 保護対象の各リクエスト単位で扱う。
  - Django側では、各リクエストごとに Cloudflare Access ヘッダーを検証し、userテーブルを参照して `request.user` をセットする。
  - DRFのpermission_classesを定義して、各クラスに付与し、柔軟に拡張する。
  - ヘッダーの信頼境界（Cloudflare経由以外を信用しないための制限）などのセキュリティ要件は要件を詰める。
  - 記事管理、ユーザー管理、OGP管理などの Access 保護対象リクエストが未認証であれば、Cloudflare Access の認証画面へ遷移させる前提で構成する。
  - Django側で想定ヘッダーが欠落している、または検証に失敗した場合は未認証として扱う。
- 認証境界の責務:
  - Cloudflare Access は「認証画面へ遷移させる責務」を持つ。
  - Django ミドルウェアは「ヘッダーを検証して request.user を解決する責務」を持つ。
  - 各 View は `permission_classes` で認可を定義する。
- permission_classes の基本単位:
  - `admin` のみ読み書き
  - `author + admin` 読み書き
  - `記事のauthor と admin` のみ読み書き
- 仮登録フロー:
  - 管理者が `email` と `role` を入力して仮登録ユーザーを作成する。
  - 仮登録時点では `cf_access_sub` は未設定でよい。
  - 管理者は仮登録ユーザーごとに招待URLを発行できるようにする。
  - 招待URLの発行APIは `users/{user_id}/invite` とする。
  - 実際にユーザーが到達する本登録URLは `users/activate/{user_id}` とする。
- 本登録フロー:
  - 仮登録ユーザーが招待URLを開く。
  - 招待URL到達後、Cloudflare Access へ遷移してログインする。
  - ログイン後、フロントは `display_name` と `profile` の入力を受け付ける。
  - Django側はヘッダーに載った `sub` と対象 `user_id` を用いて、対象ユーザーの `cf_access_sub`, `display_name`, `profile` を更新して本登録を完了する。
  - 本登録完了後に、そのユーザーを有効化して Access 保護対象APIの利用可能状態にする。
- 必要なAPI/エンドポイント:
  - 管理者向け仮登録API
  - 管理者向け招待URL発行API
  - 本登録URL用エンドポイント `users/activate/{user_id}`
  - 本登録完了API
  - セッション確認API（認証済みユーザーの状態確認）
- 権限の種類
permissions.pyで定義する内容は以下。

---

## 6. 定期実行
cmsapp/management/commands内に定期ジョブ用のスクリプトを実装。
`python manage.py command` で動かせる想定。

1. PVを更新する（30分に一度）
2. 同一ネットワーク内のNASへの定期バックアップ（3日に一度）
3. OGPリンク健全チェック（月に一度）

---

## API設計
仕様決定次第、確定。

---

## 環境変数
各APIごとのページネーション変数

---

## 画像配信・保存要件（追記）
- 画像は「原本（オリジナル）」と「公開用（処理済み）」を別ディレクトリに保存する必要がある。
- 公開ページが参照するのは必ず公開用側とする。
- 原本は必ず非公開とする。
- 公開用のみNginxで静的配信し、原本側はルーティングを作らない。
- 画像の配信はCloudflareのCDNに任せる。
- React+DjangoRestFrameworkの構成のため、Djangoテンプレートフィルターは利用しない。
- 本文HTMLにはCDNの完全URLをハードコードしない。相対パスを保存する。
- CDN用のURL変換は公開側の本文パース処理（画像 / OGP / X埋め込みの変換と同じパス）で行う。
- 記事内画像とサムネイルは記事IDごとに分けず、UUIDシャーディングで保存する。
  - 記事内画像（原本）: `MEDIA_ROOT/original/{xx}/{yy}/{asset_uuid}.{ext}`
  - 記事内画像（公開用）: `MEDIA_ROOT/images/{xx}/{yy}/{asset_uuid}.{ext}`
  - サムネイル（原本）: `MEDIA_ROOT/original/{xx}/{yy}/{asset_uuid}.{ext}`
  - サムネイル（公開用）: `MEDIA_ROOT/images/{xx}/{yy}/{asset_uuid}.{ext}`
- 記事内画像・サムネイルのファイル名はランダムUUIDを使用し、元ファイル名は保存パスに使わない。
- 拡張子は固定しない（`jpg` 強制しない）。実際の出力形式に合わせる。
- `tmp` は `MEDIA_ROOT/tmp/{lock_token}/{asset_uuid}.{ext}` に保存し、k3s の永続ボリュームに載せる。

---

## 非同期処理基盤（追記）
- NATSは利用しない。
- ワーカーはCeleryを利用する。
- 詳細（ブローカー/リトライ/キュー設計等）は後で詰める。
