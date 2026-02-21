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
- Ollama
devのみVite動かす用途

本番環境（k3s）
- クラスタ: k3s（オンプレミス UbuntuServer 上）
- Ingress: IngressController（Nginx）
- デプロイ単位:
  - nginx: Deployment（Ingress + 静的ファイル配信）
    ビルド済みReact成果物（静的ファイル）はNginxで配信する（frontend Podは不要）
  - backend: Deployment（Django/DRF）
  - redis: Deployment
  - postgres: StatefulSet
  - worker: Deployment（Celery）
  - cronjob: CronJob（定期実行）
  - Ollama: 常駐させ、Gemma2を動かす
- 外部公開:
  - ポート開放は行わず、Cloudflare Tunnel 経由で Ingress に到達させる
  - `/cms` は `cms.syumatsucamera.com` として公開し、Cloudflare Access（SSO）で認証する


ポイント
- 既存はDjangoでFE,BEを担っていた。
LCPやCLSスコアが悪いため、高速なSPAに移行するのが目的。
それに伴いアプリを1から作り直し、根本から設計し直す。

実装ポリシー
- 冪等であること
- 高速であること
- ロジックは使い回さず可能な限り共通化する
- 実運用を意識した実装にする

---

## 1. システム全体要件
- 開発環境ではDockerComposeを利用する。
- 本番環境ではオンプレミスのUbuntuServerでk3sを用いて稼働させる。
- 本番のIngressはk3sのIngressController(Nginx)を利用する。
- ポート開放は行わず、CloudFlareTunnelを利用する。
```
Internet
  ↓
CloudflareTunnel
  ↓
nginx (Ingress Controller)
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
│  │  ├─ /new                     # 空ドラフト作成→編集へ遷移
│  │  └─ /{articleId}/edit        # 記事編集（CKEditor / 画像管理 / 公開設定）
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
│     └─ /{articleSlug}/           # 記事詳細（publishedのみ / PVはRedis incr）
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
- いずれも `status='published'` のみ対象。
- 表示件数: 各6件。

## 3.2 一覧ページ
- 新着一覧: 公開記事を作成日降順、9件ページング。
- 人気一覧: 公開記事をPV降順、9件ページング。
  - 人気順の参照元は必ずPostgresの確定値を利用する。

## 3.3 記事詳細ページ
- URLキー: `category.slug` + `article.slug`。
- 非公開記事（`published` 以外）は404。
- 表示時にPVをRedisへインクリメント。
  - Redisはインクリメントの増分を一時的に貯めるために利用する。
  - Postgresへの加算は定期実行（例: 1時間ごと）でまとめて反映する。
  - 参照（人気順など）は常にPostgresの確定値を参照する。
  - Redis→Postgres加算の冪等性・取りこぼし対策の詳細仕様は保留とする。
- 関連記事:
  - 同カテゴリから人気順で最大6件
  - 足りない分は全カテゴリから補完
- カテゴリパンくず、タグ、著者情報、PR/AD表示を出し分け。
- 本文はOGP埋め込みをレンダリングし、画像URLをCDN用に変換。

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
- `<a>` を見つけたら `href` を正規化して `ogp_by_url` を引く
- 対象ならリンクは残しつつ、その直後に自作の `<OgpCard>` を追加する方針で差し込む

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
- 対象: `Article.objects.filter(status='published')`
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
        return Article.objects.filter(status="published")

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
- 新規作成はAPIで空ドラフト作成後、編集画面へ遷移。
これはPKが確定しないと、メディアの格納ディレクトリIDが確定しないため行う。
- Jodit（無償版）で本文編集。
管理者以外で自身の記事を編集不可にする用途でReadOnlyも使えそう。
HackMDからの読み取りに対応するプラグインを自前で実装する。
マークダウンをJoditへインポートする。
逆はしない。
- hackmdのAPIを利用し、インポートに対応。
- 画像アップロードAPI経由で `/media/<article_id>/images/` へ保存。
- サムネイル:
  - チェックを入れることで規定画像をセット可能。
- 管理者は記事の公開,非公開を選択可能
- スタッフは記事自体を公開することはできない。
スタッフは記事執筆完了時に公開リクエストを行い、管理者が承認する。
承認したら公開する。
- 編集削除時に不必要になった画像を一緒に削除
- 画像ファイルの名前が重複したときの対策は？
  - アップロード時にファイル名はuuidへ変換する。
  - Djangoが同名アップロード時に付与するプレフィックスによる回避策（例: (1)）を不要にする。
- slug:
  - slugはタイトルから翻訳して生成する。
  - いったん、非公式のgoogletransを利用する（後で置き換える予定）。
  - slugはロックしない。
  - category.slug / article.slug を変更した場合はURLに反映する。
  - 過去slug（過去URL）は切り捨てる（リダイレクトは行わない）ことを要件として明記する。
- 記事編集を行うときはフラグを立てて、悲観ロックで管理する。
- 記事本文をもとに、生成ボタンを押したときに100文字以内のサマリーを自動生成する。
Gemma2を利用し、共通のModelFileを用意する。

```
FROM gemma2:2b-instruct-q4_K_M

SYSTEM """
あなたは要約生成器です。
与えられた本文だけを根拠に、日本語で100文字以内の要約を1文で出力してください。
本文にない情報を追加しないでください。
出力は要約文のみ。
"""

TEMPLATE """
{{ .System }}

本文:
{{ .Prompt }}

要約:
"""

PARAMETER temperature 0.2
PARAMETER num_predict 120
PARAMETER stop "\n"
```

`"keep_alive": -1` を設定し、モデルをアンロードさせない。

### 4.2 POSTされたあとに実行される処理
記事作成後に処理すべきこと
以下はワーカーに丸投げする。
1. 記事内の画像の処理
以下の順で実行する。
A. 記事内の画像のファイル名をuuidに変更する。
B. リサイズ+Exifから撮影情報取得後、透かしを挿入
C. 終わったら、配信用のディレクトリに保存する。
D. オリジナルの画像は別のディレクトリに保存し、公開しない。
E. 画像処理が完了したら、記事内の画像のパスを公開用に書き換える。
2. OGPレコード作成
記事内のリンクのOGPレコードを作成するため、リンク先をfetchする。
結果をOGPテーブルに書き込む。
取得に失敗、もしくはOGP情報が存在しない場合はフォールバックする。
サムネイルは自前のNoImage.jpgのパスに差し替えたりする。
3. 見出し生成
h1タグなどを認識して、目次をTree状に生成する。
4. 頻出のタグを更新


### 4.3 カテゴリ管理
- カテゴリーの親子の管理方法を検討。
- 作成/編集/削除のCRUD。

### 4.4 メディアマネージャー
削除するかも。
- `MEDIA_ROOT` 配下を階層ブラウズ（リスト/グリッド）。
- ファイル削除、空ディレクトリ削除（再帰削除なし）。
- EXIF表示（jpg/jpeg）。
- 相対パスのコピー機能。

### 4.5 OGPマネージャー
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
- メール確認一致チェックあり。
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

2. 対象単位ロック（記事/アセット単位で同時実行を禁止）
- キー形式: `lock:{target_type}:{target_id}:{job_name}`
- target_type: `article` または `asset`
- 型: string（値は token）
- 取得: `SET lock:{target_type}:{target_id}:{job_name} {token} NX EX {ttl_seconds}`
- 解放: token一致を確認して `DEL`
- TTL: 対象処理の想定最大実行時間 + 余裕（画像処理や外部fetchは特に長め）
- 記事POST後に走るワーカー処理（記事単位で排他）
  - 画像処理（記事内画像の変換〜保存〜本文パス書換えを含む）
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
- 管理者とスタッフの二つを用意
- 管理者はGUIでスタッフに対して権限をアタッチする
Ex. 記事の作成&編集は許可するが削除は禁止
- 認証方式:
  - 認証はCloudflare Accessで行い、認証済みのヘッダーを付与して転送する。
  - Django側で認証が確認出来たら、userテーブルを参照して、request.userをセットする。
  - DRFのpermission_classesを定義して、各クラスに付与し、柔軟に拡張する。
  - ヘッダーの信頼境界（Cloudflare経由以外を信用しないための制限）などのセキュリティ要件は要件を詰める。
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
- 画像は「原本（オリジナル）」と「派生（処理済み）」を別ディレクトリに保存する必要がある。
- 公開ページが参照するのは必ず派生側とする。
- 原本は必ず非公開とする。
- 派生のみNginxで静的配信し、原本側はルーティングを作らない。
- 画像の配信はCloudflareのCDNに任せる。
- React+DjangoRestFrameworkの構成のため、Djangoテンプレートフィルターは利用しない。
- CDN用のURL変換はサーバー側で加工して返却する必要がある可能性がある（詳細は後で詰める）。

---

## 非同期処理基盤（追記）
- NATSは利用しない。
- ワーカーはCeleryを利用する。
- 詳細（ブローカー/リトライ/キュー設計等）は後で詰める。


## 考慮すべき事項
- 排他ロック
- 画像処理ディレクトリ問題
- 差分を検知して画像処理や見出しのJSON化を行う？
差分の管理が必要そう
- 関連記事のスコア計算をどうするか？
- タスク失敗時のretlyの設定
- 
