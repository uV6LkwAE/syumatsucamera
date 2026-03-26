# Backendアプリ構成と責務

このドキュメントは、`syumatsucamera` のバックエンド構成を実装前提で整理したものです。

## 1. 基本方針

- Djangoは「機能アプリ + 共通基盤」で責務を分離する。
- Redis操作は必ず `redis_layer` を経由し、生のキー文字列を各所に直書きしない。
- APIエンドポイントは非同期処理を直接実行せず、Celeryへ投入のみ行う。
- 定期実行は `python manage.py <command>` をCronJobから呼び出す。
- 重い処理の業務ロジックは `services` に置き、Command/Celery taskは薄く保つ。
- 必須データが欠ける場合はフォールバックせず、その場で失敗させる。

## 2. 推奨ディレクトリ構成（backend）

`cms` と `articles` は統合し、記事・カテゴリ・タグ・承認を1アプリで管理する。

```txt
backend/
  manage.py
  syumatsucamera/
    settings/
    urls.py

  core/
    middleware/
      cloudflare_access.py      # 記事管理 / ユーザー管理 / OGP管理 / 招待本登録などの各リクエストで Cloudflare Access ヘッダを検証し request.user を解決
    permissions/
      cms_permissions.py         # adminのみ読み書き / author+admin読み書き / 記事のauthor+admin読み書き の DRF permission_classes定義
    exceptions/
    pagination/

  redis_layer/
    client.py                    # Redisクライアント初期化
    keys.py                      # Redisキー生成関数（単一責務）
    lock.py                      # SET NX EX / token一致DEL
    pv_counter.py                # PV INCR/flush補助
    rate_limit.py                # INCR + EXPIRE共通化

  apps/
    users/                       # 仮登録, 本登録, 招待, ユーザー/author/管理者
    cms/                         # 記事, カテゴリ, タグ, 公開承認フロー
    public/                      # 公開サイト向けRead API
    contacts/                    # 問い合わせ
    media_assets/                # メディアメタ情報/保存パス管理
    ogp/                         # OGPキャッシュ

  workers/
    celery_app.py
    tasks/
      article_postprocess.py
      process_images.py
      build_ogp.py
      build_toc.py
      update_hot_tags.py
      pv_flush.py

  management/
    commands/
      pv_flush.py
      nas_backup.py
      ogp_link_healthcheck.py
```

## 3. アプリ内ファイル構成ルール

全アプリで以下を基本とする。

- `views.py`: HTTP層（認証、認可、入力受理、レスポンス整形）
- `services.py`: 業務ロジック（DBアクセス、計算、状態遷移）
- `serializers.py`: 入出力スキーマ定義と検証

原則:

- `serializers.py` 以外の命名は使わない（例: `article_serializers.py` は禁止）。
- `services.py` は各アプリ直下に1つ置く。
- ただし重い処理は分割ファイルを許可する。
  - 例: `image_precessing_services.py`（命名はプロジェクト内で統一）
- ViewSetでは責務の近い処理をまとめ、サービス層へ引き渡す。
- Access認証スキーマは OpenAPI の `components.securitySchemes.CloudflareAccessJwt` に定義し、権限クラスは実装側では `core/permissions/cms_permissions.py`、設計書上では各 operation の `x-permission-class` に対応付ける。

## 4. views.pyとservices.pyの責務境界

### views.py（HTTP層）

- 認証/認可の適用（permission_classes, middleware前提の認証情報利用）
- シリアライザーによる入力検証
- サービス呼び出し
- HTTPステータスとレスポンス形式の決定

### services.py（業務層）

- トランザクションを含む業務処理
- DB検索・更新・集計・状態遷移
- 非同期投入判断に必要なドメイン処理

禁止事項:

- ViewSetに業務計算や複雑なDB処理を直書きしない。
- サービス層でHTTPレスポンスオブジェクトを返さない。

## 5. シリアライザー運用ルール

- APIの入力/出力は原則シリアライザーを通して検証する。
- 「さほど重要ではない返却値」は例外として辞書組み立てを許可する。
- 必須フィールドが不足している場合、デフォルト値で補完しない。
- 検証失敗はその場で例外を返し、処理継続しない。

## 6. REST設計ルール

- URL/関数名に動詞を入れない（リソース中心）。
- 振る舞いはHTTPメソッドで表現する。
- 追加操作が必要な場合はDRFの `@action` を使う。
- ViewSet単位で責務を揃える（同一リソース操作を集約）。

例:

- `POST /articles/{id}/publish` のような命名より、可能な限り状態更新として表現する。
- ただし運用上必要な操作は `@action` で明示的に提供する。

## 7. API docstringルール

- すべてのAPIエントリ（ViewSetメソッド/アクション）の冒頭にdocstringを必須化する。
- docstringには次を簡潔に書く。
  - APIの責務
  - 入力の概要
  - 返却の概要

全レイヤー向け拡張ルール:

- `views.py`: すべての公開メソッドにdocstringを付与する。
- `services.py`: すべての公開関数/メソッドにdocstringを付与する。
- `serializers.py`: Serializerクラスと主要メソッド（`validate`, `create`, `update`）にdocstringを付与する。
- `redis_layer/*.py`: キー生成関数、ロック関数、カウンタ関数すべてにdocstringを付与する。
- docstringは短く、責務と入出力を端的に記述する。

短い例:

```python
def create(self, request, *args, **kwargs):
    \"\"\"記事ドラフトを新規作成するAPI。入力を検証し、作成結果を返す。\"\"\"
```

## 8. 非同期タスク（Celery）一覧

記事POST後の後処理（要件準拠）:

1. `process_images`
- 記事内画像のUUID化
- リサイズ/Exif抽出/透かし挿入
- 派生画像を配信用ディレクトリへ保存
- 原本は非公開ディレクトリへ保存
- 本文中画像パスの公開用書き換え

2. `build_ogp`
- 記事内リンクをfetchしてOGPレコードを作成
- 失敗時はフォールバックデータで補完

3. `build_toc`
- h1/h2/h3を解析してTOC Treeを生成

4. `update_hot_tags`
- 頻出タグを更新

5. `article_postprocess`（任意）
- 上記タスクを順序制御するオーケストレーション

実装ルール:

- API側は `transaction.on_commit()` で `task.delay(...)` を呼ぶ。
- タスク本体は薄く保ち、実処理は `apps/*/services.py` へ委譲する。

## 9. 定期実行ジョブ（CronJob -> manage.py command）一覧

1. `pv_flush`（30分ごと）
- Redis PV集計をPostgres確定値へ反映

2. `nas_backup`（3日ごと）
- NASへの定期バックアップ

3. `ogp_link_healthcheck`（月1）
- OGPリンク健全チェック
- 必要ならOGP全件再fetch更新を同ジョブまたは別ジョブで実施

実装ルール:

- `management/commands` はエントリとして薄く保つ。
- 業務ロジックは各アプリの `services.py` へ委譲する。

## 10. Redisキー方針（抜粋）

- グローバルロック: `lock:job:{job_name}`
- 対象単位ロック: `lock:{target_type}:{target_id}:{job_name}`
- PVカウンタ: `pv:day:{YYYYMMDD}:article:{article_id}`
- レート制限: `rl:{scope}:{identifier}:{route}`

運用ルール:

- ロック取得は `SET ... NX EX ...`
- 解放はtoken一致時のみ `DEL`
- TTLは必須（自然解放の保険）

## 11. 例外方針（暫定）

詳細は別途設計するが、現時点の暫定方針は以下とする。

- 必須データ不足は即時エラー（補完禁止）。
- バリデーションエラーはシリアライザーで明示的に返却。
- 外部依存（Redis/外部fetch）失敗時は握りつぶさず、再試行対象か即時失敗かを明確化する。
- 「落とすべき条件」をサービス層で統一し、View層で分岐を増やしすぎない。

追加ルール:

- 独自例外クラスは作成しない。
- 例外は `rest_framework.exceptions` の標準例外クラスのみ使用する。
- エラーメッセージは必ず日本語で、短く、ユーザーが理解できる文にする。
- フロントでそのまま表示される前提で文言を設計する。

実装規約:

- `MethodNotAllowed` は第2引数に日本語メッセージを渡す。
  - 例: `raise MethodNotAllowed(request.method, "許可されていない操作です。")`
- `ValidationError` は日本語メッセージを渡す。
どのフィールドがどの制約に違反しているか詳しく返す。
  - 例: `raise ValidationError("タイトルフィールドは40文字以内である必要があります。")`
- `ParseError`, `NotFound`, `PermissionDenied`, `NotAuthenticated`, `AuthenticationFailed`, `Throttled` なども同様に日本語メッセージを必須とする。
  - 例: `raise ParseError("不正なリクエストです。")`

補足ルール:

- `MethodNotAllowed` に限らず、すべてのAPIエラーで日本語メッセージを必須とする。
- 想定外例外（500）はレスポンス形式を `{"detail": "サーバー内部でエラーが発生しました。"}` に統一する。

レスポンス形式ルール:

- 単一メッセージ系エラーは DRF 標準の `detail` 形式を使用する。
- バリデーションエラーは、どのフィールドが違反したか分かるよう DRF 標準の辞書形式をそのまま使用する。

バリデーションエラーの例（フィールド単位）:

```json
{
  "title": [
    "タイトルフィールドは40文字以内である必要があります。"
  ],
  "category_id": [
    "このフィールドは必須です。"
  ]
}
```

バリデーションエラーの例（非フィールド）:

```json
{
  "non_field_errors": [
    "開始日時は終了日時より前である必要があります。"
  ]
}
```

業務エラーのHTTPステータス運用（暫定）:

- 権限不足: `PermissionDenied` (`403`)
  - 例: `この操作を行う権限がありません。`
- 認証不足/失敗: `NotAuthenticated` / `AuthenticationFailed` (`401`)
- リソース不存在: `NotFound` (`404`)
- リクエスト形式不正: `ParseError` (`400`)
- 入力値不正/状態不正（DRF標準で409がないため当面ここに寄せる）: `ValidationError` (`400`)
  - 例: 公開状態遷移の不正、必須入力不足
- 編集中ロック関連（DRF標準で409がないため当面 `PermissionDenied` に寄せる）: `PermissionDenied` (`403`)

ロック関連の文言（ユーザー向け）:

- 他者編集中: `他のユーザーが編集中です。`
- ロック失効/延長失敗後の保存時: `セッションが切れました。再読み込みしてください。`

## 12. ログレベル運用基準（要件準拠）

本番の恒久ログは `logger.log` に出力する。
ログレベルは「影響範囲」「復旧の緊急性」「データ整合性リスク」で判断する。

### DEBUG

- 開発時の詳細調査用。通常運用では常時有効にしない。
- 例:
  - Redisキー生成結果やロック取得パラメータの確認
  - Celeryタスク入力ペイロードの詳細（機微情報は除外）
  - OGP解析ステップの中間状態

### INFO

- 正常系の重要イベント記録。
- 例:
  - 記事ドラフト作成/更新/公開リクエスト受付
  - PV flushジョブ開始/完了、反映件数
  - OGP月次更新ジョブの実行開始/完了

### WARNING

- 処理は継続できるが、放置で問題化する可能性がある状態。
- 例:
  - 記事内の一部リンクでOGP取得失敗（記事保存自体は継続）
  - 画像の一部でExifが欠損し、既定処理で継続
  - レート制限閾値超過リクエストの多発

### ERROR

- 単一処理として失敗。再試行や個別復旧が必要。
- 例:
  - 記事POST後タスク（画像処理/TOC生成/OGP生成）の失敗
  - `manage.py pv_flush` 実行失敗（DB反映失敗）
  - 問い合わせ保存やメール送信の失敗
  - 必須入力不足によるAPI失敗（バリデーションエラーを除く想定外欠落）

### CRITICAL

- サービス継続性、認証境界、データ整合性に重大な影響がある障害。
- 例:
  - Postgres接続断や書き込み不能が継続し、主要APIが停止
  - Redis接続断でロック/PV集計/レート制限が機能不全
  - Cloudflare Access前提ヘッダー検証が崩れ、CMS保護境界が破綻する恐れ
  - 配信用画像と非公開原本の保存先取り違えなど、データ公開事故につながる不整合
  - 例外ハンドラ不全で500応答が連鎖し、API全体が不安定
