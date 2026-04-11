# 画像処理実装レポート

作成日: 2026-04-10

## 概要

記事画像の保存処理を、単純なコピー保存から実際の画像処理フローへ変更した。
あわせて、公開済み記事の更新時に旧公開版を維持したまま差し替えるための staging を追加した。

## 実装内容

### 1. 記事画像の実処理を実装

対象:
- `backend/cms/services/media_services.py`
- `backend/syumatsucamera/settings/base.py`

実装した内容:
- 原本は `MEDIA_ROOT/original/...` に生データのまま保存
- 公開用は `MEDIA_ROOT/images/...` に加工後データを保存
- EXIF向き補正を公開用画像へ適用
- `resize=true` かつ元ファイルサイズが `500,000 bytes` を超える場合のみ、長辺 `2048px` 上限で縮小
- `500,000 bytes` 以下なら、縦横サイズに関係なくリサイズのみスキップ
- 記事本文画像・ユーザーアップロードサムネイルの許可形式を `jpg/jpeg/gif` に限定
- Jodit 側の `imagesExtensions` とファイル input の `accept` も `jpg/jpeg/gif` に限定
- リサイズ・透かし処理後の公開用画像が `500,000 bytes` を超える場合、JPEG は品質を二分探索で下げる
  - `CMS_ARTICLE_IMAGE_QUALITY_LOW=50`
  - `CMS_ARTICLE_IMAGE_QUALITY_HIGH=90`
  - 上限サイズ以下を満たす最大品質を採用
  - 上限サイズを満たせない場合は `CMS_ARTICLE_IMAGE_QUALITY_LOW` で保存
- PNG / WebP は記事画像アップロード許可対象外
- `exif_watermark=true` の場合、EXIF情報を左下の半透明黒帯へ描画
- `site_logo_watermark=true` の場合、右下へサイトロゴ透かしを描画
  - ロゴ幅: 長辺の `12%`
  - 透明度: `60%`
- GIF は加工せず、原本・公開用ともにそのまま保存

削除した旧仕様:
- `custom_text_overlay`
- `custom_text`

### 2. 本文HTMLの tmp パスを公開パスへ確定

対象:
- `backend/cms/services/media_services.py`
- `backend/cms/services/postprocess_services.py`

実装した内容:
- 保存時に本文へ入っている `/media/tmp/{lock_token}/...` を、後処理成功時に `/media/images/{shardA}/{shardB}/{file}` へ置換
- TOC は確定済み `body_html` から再生成
- OGP 同期も確定後の `body_html` を基準に実行

### 3. 公開済み記事の更新を staging 化

対象:
- `backend/cms/services/article_pending_snapshot_services.py`
- `backend/cms/services/article_services.py`
- `backend/cms/services/postprocess_services.py`
- `backend/public/services/article_services.py`

実装した内容:
- 既に公開中の記事を更新する場合、変更内容を Redis へスナップショット保存
- live の `Article` は即時更新せず、画像処理成功後に一括反映
- これにより、公開中記事の更新中でも旧公開版を出し続ける
- 新規公開記事は `image_job_status=completed` のものだけ公開APIで返す

副作用として解消した問題:
- 公開中記事の更新時に live DB を先に書き換えてしまう問題
- registry / worker と無関係に、画像処理中の公開崩れが起きる問題

### 4. 画像削除とサムネイル差し替えのタイミング修正

対象:
- `backend/cms/services/article_services.py`
- `backend/cms/services/postprocess_services.py`

実装した内容:
- 既存画像の削除は保存受付時ではなく、後処理成功後に実行
- 旧サムネイルの削除も、差し替え成功後に実行
- 失敗時は新規に作成した途中アセットを cleanup する
- ユーザーがアップロードしたサムネイルは、記事本文画像と同じリサイズ・JPEG品質探索処理へ通す
- 固定デフォルト、タイトル生成、現在サムネイル維持は、この画像処理パイプラインへ通さない

### 5. CMS の画像オプション UI を追加

対象:
- `frontend/src/features/cms/articles/CmsArticleEditorPage.tsx`
- `frontend/src/features/cms/helpers.ts`
- `frontend/src/features/cms/types.ts`
- `frontend/src/styles.css`
- `backend/cms/serializers.py`

実装した内容:
- Jodit 上の画像をクリックまたはタップすると、画像ごとの処理オプションパネルを表示
- 表示オプション:
  - リサイズ
  - EXIF透かし
  - サイトロゴ透かし
- デフォルト値:
  - `resize=true`
  - `exif_watermark=false`
  - `site_logo_watermark=false`
- 既存の公開画像に対してオプションを変更した場合は、その画像を一度 `tmp` へ再アップロードし、再処理対象へ切り替える
- 既存 `MediaAsset` の `processing_options_json` を CMS 詳細レスポンスに含めるよう変更
- 既存サムネイル維持は `keep_current` として扱い、既存PNGサムネイルを再アップロードしない

## 変更ファイル

主な変更ファイル:
- `backend/cms/services/media_services.py`
- `backend/cms/services/article_services.py`
- `backend/cms/services/postprocess_services.py`
- `backend/cms/services/article_pending_snapshot_services.py`
- `backend/cms/serializers.py`
- `backend/public/services/article_services.py`
- `backend/syumatsucamera/settings/base.py`
- `k3s/base/common/configmap.yaml`
- `frontend/src/features/cms/articles/CmsArticleEditorPage.tsx`
- `frontend/src/features/cms/helpers.ts`
- `frontend/src/features/cms/types.ts`
- `frontend/src/styles.css`

契約更新:
- `backend/openapi/components/schemas.yaml`

## 検証結果

実施:
- `python3 -m py_compile backend/cms/services/article_pending_snapshot_services.py backend/cms/services/article_services.py backend/cms/services/media_services.py backend/cms/services/postprocess_services.py backend/cms/serializers.py backend/public/services/article_services.py`
- `git diff --check`

結果:
- backend の構文チェック成功
- 改行・空白の diff check 成功

未実施:
- frontend build / 型チェック

理由:
- この実行環境には `npm` が入っておらず、`npm run build` を実行できなかった

## 既知の制約

1. 公開済み記事の更新内容は Redis snapshot で保持しているが、CMS 詳細取得時に pending 内容はまだ再表示していない。
   - そのため、保存直後に編集画面へ戻ると、後処理完了までは live 側の内容が見える。
   - 公開側は旧公開版維持、成功後に差し替え、という要件自体は満たしている。

2. 画像処理失敗時は live 公開版を維持する。
   - 失敗した pending 内容は自動復元しない。
   - 再編集時は再度保存し直す前提。

## 結論

今回の実装で、以下は満たした。

- 500,000 bytes を境にした resize skip
- JPEG の品質二分探索による 500,000 bytes 上限への圧縮
- GIF no-op 保存
- EXIF / ロゴ透かし
- `tmp` から `/media/images/...` への確定
- 公開済み記事の旧公開版維持
- Jodit 画像クリック / タップでの処理オプション編集

未解決として残しているのは、`pending 内容を CMS 詳細で再表示する仕組み` だけ。
