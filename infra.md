# インフラ方針（現時点）

## 1. 全体方針
- 開発環境は `Docker Compose` で構築する。
- 本番実行基盤は `k3s`（Ubuntu Server）を前提にする。
- 外部公開は Cloudflare Tunnel のみを利用し、NodePort は開放しない。
- k3s は本番専用で運用する。

## 2. 本番コンテナ構成（k3s）
- `cloudflared`: Deployment
- `nginx`: Deployment（gateway + 静的配信）
- `backend`: Deployment
- `worker`: Deployment
- `cronjob`: CronJob
- `postgres`: StatefulSet
- `redis`: Deployment

補足:
- `frontend` Pod は作らない。
- React ビルド成果物は `nginx` イメージに同梱する。
- Ollama は k3s / Docker 定義から削除済み。

## 3. イメージ方針
- NAS registry に push するのは自前イメージのみ。
  - `backend`
  - `nginx`（frontend成果物同梱）
- `worker` / `cronjob` は `backend` と同一イメージを参照する。
- 公式イメージは `docker.io` から pull する。
  - `postgres:16-alpine`
  - `redis:7-alpine`

## 4. Secret 方針
- 機密値は Git 追跡しない。
- Ubuntu Server 上に専用ディレクトリを作成し、権限を最小化する。
  - 例: `/etc/syumatsucamera/secrets`
- secret ファイルは用途で分離する。
  - `app.secret.env`: Django 実行用（k8s `app-secret` へ投入）
  - `apply.secrets.env`: deploy スクリプト実行用（Postgres初期化/初回superuser作成）
  - `registry.secret.env`: registry basic 認証情報
- `app.secret.env` は `source` しない（`kubectl --from-env-file` 専用）。
- `kubectl create secret` でクラスタへ投入する。

実行例:
```bash
kubectl create secret generic app-secret \
  --from-env-file=/etc/syumatsucamera/secrets/app.secret.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

- registry 認証用 secret も同様に out-of-band で作成する。
- k3s の at-rest encryption を有効化する。

## 5. ネットワーク方針
- 外部との入口は Cloudflare Edge。
- Edge から cloudflared Pod へ Tunnel 経由で到達させる。
- cloudflared Pod から `nginx` Service へ HTTP 転送する。
- gateway nginx が host/path で振り分ける。

経路:
```text
[Browser]
  -> [Cloudflare Edge]
  -> [Cloudflare Tunnel]
  -> [cloudflared Pod]
  -> [gateway nginx Pod]
  -> [backend Service / 外部上流]
```

gateway nginx の振り分け:
- `syumatsucamera.com`
  - `/`      -> 静的配信（SPA fallback）
  - `/api`   -> backend Service
- `cms.syumatsucamera.com`
  - `/`      -> backend Service（Access 認証前提）
- `registry.syumatsucamera.com`
  - `/`      -> `192.168.1.25:5000`
- `apply.syumatsucamera.com`
  - `/`            -> Ubuntu Server `:19081`（POST で deploy 開始）
  - `/status/...`  -> Ubuntu Server `:19081`（GET で deploy 状態確認）

## 6. CI/CD 方針
- Trigger: `main` push
- フロー:
  1. CI（Django check / frontend build）
  2. backend/nginx build + push
  3. `POST https://apply.syumatsucamera.com/`（mTLS, `202` + `job_id`）
  4. `GET https://apply.syumatsucamera.com/status/{job_id}` をポーリング
  5. 通知

- apply 側で実行する処理:
  - `kubectl create secret ... | kubectl apply -f -`
  - Postgres のロール/DB を初期化（存在時はskip）
  - `python manage.py migrate --noinput`（毎回）
  - Django superuser を初期化（存在時はskip）
  - `kubectl apply -k k3s/base`
  - `kubectl rollout restart/status`

## 7. 認証方針
- `registry.syumatsucamera.com` は mTLS 必須。
- `apply.syumatsucamera.com` も mTLS 必須。
- Cloudflare Access は `cms.syumatsucamera.com` のみに適用する。
- Docker Registry は `docker login`（basic auth）も併用する。

## 8. デプロイ安全策
- Deployment は RollingUpdate。
  - `maxUnavailable: 0`
  - `maxSurge: 1`
- 最低 1 Pod は常時稼働。
- backend/worker は HPA で自動スケール。
- `revisionHistoryLimit: 3` を基本値とする。

## 9. 大まかなセットアップ手順
1. NAS registry を起動する（basic auth 有効）。
2. Cloudflare で `registry.syumatsucamera.com` と `apply.syumatsucamera.com` を作成する。
3. Cloudflare mTLS を `registry/apply` に設定する。
4. Ubuntu Server に k3s を導入し、`kubectl` を利用可能にする。
   - `curl -sfL https://get.k3s.io | sh -`
   - `sudo k3s kubectl get nodes`
   - `~/.kube/config` を `yamazaki` に配置し、`kubectl get nodes` が通る状態にする。
   - `which kubectl` が空の場合は `sudo ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl` を実行する。
5. Ubuntu Server 上で secret ディレクトリを作成する。
   - `/etc/syumatsucamera/secrets`
   - 推奨権限: directory `700` / file `600`
   - 例:
     - `sudo mkdir -p /etc/syumatsucamera/secrets`
     - `sudo chown yamazaki:yamazaki /etc/syumatsucamera/secrets`
     - `sudo chmod 700 /etc/syumatsucamera/secrets`
6. secret ファイルを作成する。
   - `app.secret.env`（Django 実行変数）
   - `apply.secrets.env`（`DEPLOY_REPO_URL`, `DEPLOY_REPO_TOKEN`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_PASSWORD`）
   - `registry.secret.env`（`REGISTRY_USERNAME`, `REGISTRY_PASSWORD`）
   - `DEPLOY_REPO_TOKEN` は GitHub リポジトリ読み取り可能な token を設定する。
   - 例:
     - `cat <<'EOF' > /etc/syumatsucamera/secrets/app.secret.env`（Django 実行用変数を記載）
     - `cat <<'EOF' > /etc/syumatsucamera/secrets/apply.secrets.env`（apply 用変数を記載）
     - `cat <<'EOF' > /etc/syumatsucamera/secrets/registry.secret.env`（registry 認証情報を記載）
     - `sudo chown yamazaki:yamazaki /etc/syumatsucamera/secrets/*.env`
     - `sudo chmod 600 /etc/syumatsucamera/secrets/*.env`
   - 注記:
     - `app.secret.env` は `kubectl --from-env-file` 専用。
     - `apply.secrets.env` / `registry.secret.env` は `apply_server.py` が参照する。
7. Ubuntu Server に deploy 用作業ディレクトリを作成し、`k3s` のみ同期する前提を作る。
   - `sudo mkdir -p /opt/apply && sudo chown -R yamazaki:yamazaki /opt/apply`
   - 初回実行時に `apply_server.py` が `DEPLOY_REPO_TOKEN` を使って `git clone --depth=1 --no-checkout` + `sparse-checkout set k3s` を行う。
8. Ubuntu Server に apply エンドポイント（`127.0.0.1:19081`）を常駐させる。
   - `apply_server.py` を `systemd` で常駐
   - `apply_server.py` は `yamazaki` 実行
9. gateway nginx で `apply` は POST 以外を拒否し、`127.0.0.1:19081` へ転送する。
10. k3s に `cloudflared` Deployment を作成する（Token Secret 参照）。
11. `apply_server.py` 実行で以下を反映する。
   - secret 再投入
   - `k3s` ディレクトリを毎回同期（`/opt/apply/repo/k3s`）
   - immutable tag を注入した kustomize overlay を `kubectl apply -k` する
   - Postgres 初期化（存在時 skip）
   - `python manage.py migrate --noinput`（毎回）
   - 初回superuser作成（存在時 skip）
   - rollout restart/status
12. GitHub Actions から build+push+apply を実行する。

前提チェック:
- `which kubectl` が通ること
- `kubectl get nodes` が成功すること
- `/opt/apply/apply_server.py` が systemd で起動していること

## 10. TODO
- `apply` 経路に第2関門（HMAC or 共有トークン）を追加する。
- registry push 経路にも第2関門を追加する。
- cloudflared の可用性（replica 戦略）を運用負荷に応じて見直す。
