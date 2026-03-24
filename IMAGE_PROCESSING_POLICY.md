# 画像処理ポリシー

## 基本方針

- 記事の作成と編集は同じクラスおよび同じ業務ロジックで処理する。
- 作成用と編集用で似たロジックを分岐実装しない。
- 記事保存APIは単一とし、作成と編集の両方を扱う。
- 記事本文の更新と画像処理は、一連の流れとして扱う。
- ただし画像処理自体は非同期ジョブで実行する。

## 記事保存APIの入力

- 記事本文
- タイトル
- サマリー
- その他のメタ情報
- 画像差分JSON

画像差分JSONでは少なくとも以下を受け取る。

- 新規画像の追加情報
- 既存画像の削除情報
- 新規画像ごとの処理オプション
- サムネイルリクエスト情報

画像差分JSONの例:

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
    },
    {
      "file_name": "61c84b3e-0df5-4f50-a2af-27464c5ab210.png",
      "options": {
        "resize": true,
        "exif_watermark": false,
        "site_logo_watermark": true,
        "custom_text_overlay": true,
        "custom_text": "DRAFT"
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

補足:

- `lock_token` は今回の編集セッションを示す。
- `new_images` は今回の保存で採用する画像ごとの設定一覧である。
- `new_images[].file_name` は `tmp` 上の対象ファイル名である。
- `new_images[].options` で画像ごとの処理オンオフを指定する。
- `options.resize` はリサイズの実行可否を示す。
- `options.exif_watermark` はEXIF由来の透かし挿入可否を示す。
- `options.site_logo_watermark` はサイトロゴ透かし挿入可否を示す。
- `options.custom_text_overlay` はカスタムテキスト挿入可否を示す。
- `options.custom_text_overlay=true` の場合は `options.custom_text` を必須とする。
- `delete_images` は今回の保存で本文から外し、最終的に削除対象とする既存 asset UUID の一覧である。
- `delete_images` は保存フロー内で原本と公開用画像の即時削除対象として扱う。
- `thumbnail_request` はサムネイルの決定方式を示す。
- `thumbnail_request.mode` は `use_uploaded`, `use_default`, `generate_from_title` の3択とする。
- `thumbnail_request.mode=use_uploaded` の場合は `thumbnail_request.file_name` を必須とする。
- `thumbnail_request.mode=generate_from_title` の場合は `thumbnail_request.title_text` を必須とする。
- `thumbnail_request.mode=generate_from_title` でクライアント保持の生成画像をPOSTする場合は `thumbnail_request.file_name` も必須とする。
- 保存APIは `lock_token` と `new_images[].file_name` から `media/tmp/{lock_token}/{file_name}` を組み立てる。
- 保存APIは、各 `file_name` から UUID と拡張子を検証する。
- オプション未指定時のデフォルトは `resize=true`, `exif_watermark=true`, `site_logo_watermark=false`, `custom_text_overlay=false` とする。

## Jodit前提のアップロード方針

- Jodit は画像貼り付け時に即アップロードされる前提で扱う。
- エディター上で画像を削除しても、サーバー上の実ファイルは自動削除されない前提で扱う。
- そのため、画像アップロード先は最終保存先ではなく、一時領域 `tmp` とする。
- 画像アップロード時の保存先は、記事編集ロックで発行した `lock_token` を使ってサーバー側で強制決定する。
- Jodit 側は保存先パスを決めず、`lock_token` のみを送信する。
- サーバー側は `lock_token` を検証し、対応する一時保存先へアップロードする。
- フロント側では、アップロード前に画像ファイル名をランダムな UUID ベースの名前へ置換する。
- 送信ファイル名は `{asset_uuid}.{ext}` 形式に統一する。
- 差分JSONの `new_images` には、UUID 化済みファイル名と画像ごとの処理オプションを入れる。

## Jodit画像ホバーメニュー方針

- Jodit編集画面上の画像をホバーしたときに、画像処理オプションメニューを表示する。
- オプション項目は次の4つを用意する。
- `resize`
- `exif_watermark`
- `site_logo_watermark`
- `custom_text_overlay`
- `custom_text_overlay` が有効な場合のみ、`custom_text` 入力欄を表示する。
- ホバー操作で変更した内容は、画像ごとの設定としてフロント側で保持する。
- 記事保存時に、その設定を `new_images[].options` として送信する。

### Jodit側の軽い実装例

```javascript
const editor = Jodit.make("#editor", {
  uploader: {
    url: "/api/cms/article-images",
    format: "json",
    prepareData(formData) {
      formData.append("lock_token", articleLockToken);
      return formData;
    }
  }
});
```

補足:

- Jodit 側は保存先パスを決めない。
- Jodit 側は `lock_token` を送るだけにする。
- Jodit へ渡すファイル名は、送信前に UUID 化した名前を使う。
- 保存先ディレクトリの決定はサーバー側の責務とする。

### サーバー側の軽い実装例

```python
from pathlib import Path
from uuid import UUID


MEDIA_ROOT = Path("media")


def build_tmp_upload_path(lock_token: str, file_name: str) -> Path:
    """
    lock_token 配下の一時保存パスを返す。
    """
    UUID(lock_token)

    target_dir = MEDIA_ROOT / "tmp" / lock_token
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / file_name


def handle_article_image_upload(uploaded_file, lock_token: str, file_name: str) -> str:
    """
    一時保存し、本文用の相対パスを返す。
    """
    target_path = build_tmp_upload_path(lock_token=lock_token, file_name=file_name)

    with target_path.open("wb") as destination:
        for chunk in uploaded_file.chunks():
            destination.write(chunk)

    return str(target_path)
```

補足:

- サーバー側で保存先を `media/tmp/{lock_token}/` に強制する。
- クライアントに保存先ディレクトリを決めさせない。
- 保存APIと画像アップロードAPIで同じ `lock_token` を使う。

## 編集開始時の前提

- 編集画面を初回表示した時点で、編集開始APIを呼び出す。
- 編集開始APIは記事ロックを取得し、`lock_token` を返す。
- フロントはその `lock_token` を Jodit 初期化時に保持する。
- 画像アップロード、TTL延長、保存APIは同じ `lock_token` を使う。

## 一時保存パス

- 一時保存先は編集セッション単位で分離する。
- 一時保存パスは `media/tmp/{lock_token}/{asset_uuid}.{ext}` とする。
- `tmp` ディレクトリ直下へ画像ファイルを直接配置しない。
- `tmp` 直下はセッションディレクトリだけを持つ構成とする。
- Jodit からアップロードされた画像は、すべてこの一時領域へ保存する。
- 記事本文内の画像パスは、保存完了までは `tmp` パスを保持する。
- `tmp` はPodローカルの一時領域ではなく、専用PVCへ保存する。
- backend と worker は同じ `tmp` 用PVCをマウントする。
- k3s 上でも `tmp` は永続ボリュームとして扱う。

## 保存時の不要画像整理

- Jodit では貼り付け後に画面上から消した画像の実体が `tmp` に残る。
- そのため、記事保存時に画像差分JSONを送る。
- 保存APIは、画像差分JSONに含まれない `tmp` 画像を画像処理前に削除する。
- 画像差分JSONに含まれる画像のみを、今回の保存対象として扱う。
- `delete_images` に含まれる既存画像は、保存フロー内で原本と公開用画像を即時削除する。
- `new_images` に含まれる画像は、画像ごとの `options` に従って処理を分岐する。

## 画像処理後の最終保存先

- 画像処理完了後、ファイルは UUID シャーディングした最終保存先へ移動する。
- オリジナル画像は外部公開しない。
- 公開用画像のみ Nginx で配信する。

最終保存パス:

- オリジナル非公開ファイルパス
  `media/original/{xx}/{yy}/{asset_uuid}.{ext}`
- 公開用ファイルパス
  `media/images/{xx}/{yy}/{asset_uuid}.{ext}`

## HTML内画像パスの置換

- 記事の HTML 内では、一時的に `tmp` パスを保持する。
- DB保存済みの本文HTML自体は書き換えない。
- 公開画面とJodit編集画面では、表示時にJSで `tmp` パスを公開用パスへ表面的に置換する。
- UUID 自体は変わらないため、置換はファイル名の UUID を基準に実施する。
- オリジナル画像のパスは HTML に書き込まない。
- 公開側で参照するのは常に `media/images/...` のみとする。
- 画像処理に成功した画像だけを公開用パスへ変換対象とする。

## クリーンアップ

- 画像処理が完了したら、対象の `tmp/{lock_token}` ディレクトリ自体を削除する。
- 保存時に不要と判定された `tmp` 画像も削除対象とする。
- `tmp` ディレクトリ直下全体をクリーンアップ対象にしない。
- `tmp` 直下全体を対象にすると、他セッションで使用中の未処理画像まで削除されるため禁止とする。
- 画像処理が一部失敗した場合でも、対象の `tmp/{lock_token}` はクリーンアップしてよい。

## APIレスポンスと公開状態

- 記事の投稿APIは、受理時点で `202 Accepted` を返す。
- 画像処理は非同期ジョブで継続する。
- 画像処理ジョブが完了したら、ジョブ自身が記事の公開フラグを `True` に更新する。
- 画像処理完了前は公開状態にしない。
- 画像処理が1件でも失敗した場合、記事は公開しない。
- 画像処理に失敗した場合、自動で編集画面へ遷移しない。
- CMS側では、対象記事に警告バッジを表示する。
- CMS側では、記事保存フローログを表示して失敗内容を確認できるようにする。
- 失敗後に編集画面を開き直した場合、`lock_token` は新しく発行してよい。

## 実装する非同期ジョブ

1. `process_article_save_flow`
- 記事保存APIが `202 Accepted` を返した後に起動する。
- `new_images` をもとに `tmp/{lock_token}` 配下の画像を処理する。
- 処理成功した画像を `media/original/{xx}/{yy}/...` と `media/images/{xx}/{yy}/...` へ保存する。
- `delete_images` に含まれる既存画像を即時削除する。
- 記事保存フローログテーブルへ成功/失敗を記録する。
- 1件でも失敗した場合は記事を公開しない。
- 最終的に `tmp/{lock_token}` をクリーンアップする。

### `process_article_save_flow` が行う画像処理

1. 事前検証
- `lock_token` を検証する。
- 対象記事の編集ロック状態を確認する。
- `new_images[].file_name` が UUID 形式と拡張子ルールを満たすか確認する。
- `new_images[].options` の値を検証する。
- `custom_text_overlay=true` の場合に `custom_text` が空でないか確認する。
- `tmp/{lock_token}/{new_images[].file_name}` の実体が存在するか確認する。
- 本文HTML内の `tmp` パスと `new_images` / `delete_images` の整合を確認する。

2. 削除対象画像の即時削除
- `delete_images` に含まれる既存画像を取得する。
- 対象画像の原本と公開用画像を削除する。
- 関連する `MEDIA_ASSET` レコードを更新または削除する。
- 削除成功/失敗を記事保存フローログテーブルへ記録する。

3. 新規画像の処理
- `tmp/{lock_token}` 配下の対象画像を1件ずつ開く。
- 必要なメタ情報を取得する。
- `options.resize=true` の場合のみリサイズを行う。
- `options.exif_watermark=true` の場合のみEXIF由来の透かしを挿入する。
- `options.site_logo_watermark=true` の場合のみサイトロゴ透かしを挿入する。
- `options.custom_text_overlay=true` の場合のみカスタムテキストを挿入する。
- オリジナル画像を `media/original/{xx}/{yy}/{asset_uuid}.{ext}` へ保存する。
- 公開用画像を `media/images/{xx}/{yy}/{asset_uuid}.{ext}` へ保存する。
- `MEDIA_ASSET` に処理結果メタ情報を書き込む。
- 書き込む項目は `article_id`, `file_name`, `width`, `height`, `checksum_sha256`, `exif_json`, `processing_options_json` とする。
- `file_name` は `{asset_uuid}.{ext}` をそのまま保存する。
- `exif_json` のキーは `ISO`, `F`, `SS`, `WB`, `機種名`, `レンズ`, `焦点距離` を使用する。
- 画像ごとの成功/失敗を記事保存フローログテーブルへ記録する。

4. 記事状態の確定
- `new_images` の全件成功を確認する。
- 1件でも失敗があれば記事は公開しない。
- 全件成功した場合のみ、ジョブ自身が記事の公開フラグを `True` に更新する。
- 公開フラグ更新の成功/失敗を記事保存フローログテーブルへ記録する。

5. 後始末
- 成功/失敗を問わず `tmp/{lock_token}` ディレクトリ自体を削除する。
- クリーンアップ結果を記事保存フローログテーブルへ記録する。

## 記事保存フロー失敗時の基本方針

- 画像処理が1件でも失敗した場合、その保存処理全体を失敗として扱う。
- 失敗時は記事の公開フラグを `True` にしない。
- 失敗時もDB上の本文HTMLは `tmp` パスのままとする。
- 失敗時は既存の公開済み本文や既存画像を壊さないことを優先する。
- 失敗理由は記事保存フローログテーブルへ保存し、CMS はログ参照API経由で確認する。
- 成功した画像は最終保存先へそのまま保存してよい。
- 失敗した画像の `tmp` もクリーンアップしてよい。
- どの画像が失敗したかはログへ残す。
- 自動再試行は行わない。
- `delete_images` で削除した既存画像は、失敗時もロールバックしない。

## 想定される失敗理由

画像ファイル自体の問題:

- 壊れた画像である
- 対応外フォーマットである
- MIME type と拡張子が一致しない
- 実体が画像ファイルではない

画像処理ロジックの問題:

- 画像を開けない
- リサイズに失敗する
- 透かし挿入に失敗する
- 保存形式変換に失敗する
- Exif 読み出しに失敗する

ファイルシステムとストレージの問題:

- `tmp` ファイルが欠損している
- `tmp` 用PVCの一時障害が発生する
- 書き込み権限エラーが起きる
- 容量不足が発生する
- move または rename に失敗する

業務フローの問題:

- `lock_token` が不整合である
- 対象記事のロックが失効している
- 差分JSONと本文HTMLが整合しない
- `delete_images` の内容が不正である
- 成功画像と失敗画像が混在した状態で公開可否判定を誤る

保存完了処理の問題:

- 表示時の `tmp` から公開用パスへの変換に失敗する
- DB更新に失敗する
- 公開フラグ更新に失敗する
- ログ書き込みに失敗する
- クリーンアップに失敗する

実行基盤の問題:

- worker がタイムアウトする
- Pod が途中で再起動する
- ジョブが途中でクラッシュする
- DB や Redis との接続が一時的に失敗する

## 記事保存フローログ方針

- 記事保存フローのログは `ARTICLE_SAVE_LOG` テーブルへ保存する。
- 記事の作成、記事の更新、画像処理、表示時パス変換、公開フラグ更新の結果を同じテーブルへ集約する。
- 保存カラムは次の通りとする。
  - `occurred_at`
  - `request_user_id`
  - `lock_token`
  - `target`
  - `status`
  - `message`
- `request_user_id` カラムには、`USER.id` の UUID を保存する。
- フロントは、記事保存フローログを読み出すAPIをポーリングして表示する。
- ログ参照APIでは、少なくとも `request_user_id` と時間範囲で絞り込めるようにする。
- ログファイルを直接配信する方式は採用しない。

レコードのサンプル:

| occurred_at | request_user_id | lock_token | target | status | message |
| --- | --- | --- | --- | --- | --- |
| 2026-03-22T10:15:03+09:00 | 11111111-1111-1111-1111-111111111111 | 3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d | article | success | 記事保存ジョブの受付が完了しました。 |
| 2026-03-22T10:15:07+09:00 | 11111111-1111-1111-1111-111111111111 | 3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d | 9f2c8a1e-1234-5678-9abc-def012345678.jpg | success | 画像処理が完了しました。 |
| 2026-03-22T10:15:09+09:00 | 11111111-1111-1111-1111-111111111111 | 3d88e9d7-3a4f-4c13-8b2c-31dff2c29b6d | 61c84b3e-0df5-4f50-a2af-27464c5ab210.png | failed | 透かし挿入に失敗しました。 |

## 現時点の前提メモ

- 記事IDごとの画像管理は採用しない。
- 保存ディレクトリは画像 UUID を基準に管理する。
- `tmp` から最終保存先への移動と、表示時の表面的なパス変換は同じ保存フローの前提として扱う。

## 要検討事項

- CMS 画面で失敗理由をどう表示するか
記事保存フローログを返却するAPIを一定期間ごとにポーリングする。

- 画像処理ジョブのタイムアウト時間をどう決めるか

- 画像処理中の状態を記事側にどう持つか
持たない。
