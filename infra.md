# インフラ方針（現時点）

## 1. 全体方針
- 開発環境は `Docker Compose` で構築する。
- 本番実行基盤は `k3s`（Ubuntu Server）を前提にする。
- ただしマシンスペック（i3-6100T / 16GB）を踏まえ、常駐コンテナは最小化する。

## 2. コンテナ構成方針
- フロントエンドは Vite でビルドした静的成果物を `nginx` イメージに同梱して配信する。
- バックエンドは Django/DRF。
- DB は Postgres、キャッシュは Redis。
- Ollama は UI上の即時生成要件のため常時起動を前提にする。

## 3. ディレクトリ構成方針
- `compose/` に Compose ファイル群を配置する。
- `dockerfile/` に Dockerfile 群と Nginx 設定を配置する。
- 環境変数は `.env.dev` / `.env.prod` で管理し、機密値はリポジトリにコミットしない。

## 4. Django 設定方針
- settings は以下3分割で運用する。
  - `syumatsucamera.settings.base`
  - `syumatsucamera.settings.development`
  - `syumatsucamera.settings.production`
- 必須環境変数が欠けている場合は起動時に即エラーで落とす。

## 5. ログ方針
- アプリ共通ログは Python logging で管理する。
- ログレベル別（DEBUG/INFO/WARNING/ERROR/CRITICAL）にファイル出力する。
- `TimedRotatingFileHandler` で日次ローテーションする。
- 保持期間は `LOG_RETENTION_DAYS` で制御する。
- 出力先は環境変数で制御する。
  - `LOG_DIR`
  - `LOG_FILE_ALL`
  - `LOG_FILE_DEBUG`
  - `LOG_FILE_INFO`
  - `LOG_FILE_WARNING`
  - `LOG_FILE_ERROR`
  - `LOG_FILE_CRITICAL`

## 6. CI/CD 方針
- トリガーは `main` ブランチへの `push`。
- CI で実施する内容:
  - `python manage.py check`
  - `npm run build`
- イメージタグは `sha` と `latest` の併用で運用する（本番適用は `sha` 優先）。
- GitHub Actions は継続利用する。

## 7. レジストリ方針
- NAS をコンテナレジストリとして利用する（self-hosted registry）。
- ポートはインターネットへ公開しない。
- 認証がない状態は不可。`registry:2` + 認証（最低限 basic auth）を前提にする。
- 可能なら TLS を有効化する。

## 8. Runner 方針
- GitHub-hosted runner の送信元IPは固定ではないため、NAS 側のIP制限と相性が悪い。
- そのため `self-hosted runner` を採用する（Ubuntu 側で実行）。
- self-hosted runner で CI/CD を実行し、NAS レジストリへ push/pull を行う。

## 9. ネットワーク・セキュリティ方針
- NAS レジストリは LAN 内アクセスに限定する。
- FW/ACL でアクセス元を Ubuntu サーバ等の必要ノードに制限する。
- 秘密情報は GitHub `Secrets`、非機密設定は `Variables` で管理する。

## 10. デプロイ・ロールバック方針
- k3s デプロイ時はイメージを `sha` タグで固定して適用する。
- 問題発生時は直前の `sha` へ戻すことでロールバックする。
- DB 変更を伴う場合は後方互換性を意識し、ロールバック手順を別途明確化する。

## 11. 未確定事項（今後詰める）
- k3s への具体的な反映手順（`kubectl apply` / Helm / GitOps の選定）。
- NAS レジストリ構築詳細（証明書、認証方式、バックアップ/GC）。
- Ollama を k3s 内で常駐させるか、ホスト常駐にするかの最終判断。
