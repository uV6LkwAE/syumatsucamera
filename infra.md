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
- `CRITICAL` ログ発生時はメール通知する。
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
- `main` への push 後、即時デプロイする（手動承認は挟まない）。
- CI で実施する内容:
  - `python manage.py check`
  - `npm run build`
- CD で実施する内容:
  - コンテナイメージをビルドし、`latest` と `sha` の両タグを付与して NAS レジストリへ push する。
  - Ubuntu Server へ SSH 接続し、`kubectl apply` で本番反映する。
- 本番適用は `latest` タグを利用する。
- ただし監査とロールバックのため、デプロイ時点の `sha`（および取得できる場合は image digest）を必ず記録する。
- GitHub Actions の `concurrency` を設定し、同時デプロイを禁止する。
- CI/CD は `GitHub Actions`（GitHub-hosted runner）で実行する。
- デプロイ成否に関わらず、GitHub Actions からメール通知する。
- メール通知先は単一アドレスで運用する。
- メール件名は以下の形式で統一する。
  - `[syumatsucamera][deploy][SUCCESS] <sha7> <env>`
  - `[syumatsucamera][deploy][FAILURE] <sha7> <env>`

## 7. レジストリ方針
- NAS をコンテナレジストリとして利用する（self-hosted registry）。
- ポートはインターネットへ公開しない。
- 認証がない状態は不可。`registry:2` + 認証（最低限 basic auth）を前提にする。
- 可能なら TLS を有効化する。

## 8. Runner 方針
- `self-hosted runner` は採用しない。
- `GitHub-hosted runner` で CI/CD を実行する。
- CD は SSH で Ubuntu Server へ接続して実行する。
- NAS レジストリへの `push` は GitHub Actions 側で実行する。
- Ubuntu Server は NAS レジストリからの `pull` のみ実行する。

## 9. ネットワーク・セキュリティ方針
- NAS レジストリは LAN 内アクセスに限定する。
- FW/ACL でアクセス元を必要ノードのみに制限する。
- SSH は公開鍵認証のみ許可し、パスワード認証を無効化する。
- SSH は `PermitRootLogin no` とし、デプロイ専用ユーザーで実行する。
- SSH の `22/tcp` は閉じ、推測されにくいポートへ変更する。
- デプロイ専用ユーザーの権限は最小化し、必要コマンドのみに限定する（詳細は別途詰める）。
- GitHub Actions で利用する秘密情報（SSH鍵・レジストリ認証情報）は GitHub `Secrets` で管理する。
- SSH 接続先のホスト鍵検証（`known_hosts` 固定）を必須とする。
- NAS レジストリは認証必須（basic auth以上）かつ可能な限り TLS を有効化する。
- 運用監視として SSH の失敗ログ監視と `fail2ban` の導入を行う。
- 秘密情報は GitHub `Secrets`、非機密設定は `Variables` で管理する。

## 10. デプロイ・ロールバック方針
- k3s への反映方式は `kubectl apply` を採用する。
- Deployment は RollingUpdate で更新する。
  - `maxUnavailable: 0`
  - `maxSurge: 1`
  - 最低 1 Pod は常時稼働させる（`replicas: 1` 以上）。
- 新リビジョンの起動が失敗した場合は、稼働中の旧リビジョンを維持する。
- `revisionHistoryLimit: 10` を設定し、直近 10 リビジョンを保持する。
- 問題発生時は `kubectl rollout undo` で直前リビジョンへ戻す。
- DB 変更を伴う場合は後方互換性を意識し、ロールバック手順を別途明確化する。
- デプロイ結果（時刻、実行者、対象 `sha`、成否、ロールバック有無）を監査ログとして保存する。
- 監査ログ保存時は、同内容をメールでも通知する。
- 監査ログは GitHub Actions 側と Ubuntu Server 側の両方に保存し、正本は Ubuntu Server 側ログとする。

## 11. 未確定事項（今後詰める）
- NAS レジストリ構築詳細（証明書、認証方式、バックアップ/GC）。
- Ollama を k3s 内で常駐させるか、ホスト常駐にするかの最終判断。
- デプロイ専用ユーザーに許可するコマンド範囲と `sudo` ポリシーの詳細。
