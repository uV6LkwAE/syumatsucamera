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
  - `/`      -> Ubuntu Server `:19081`（POST のみ許可）

## 6. CI/CD 方針
- Trigger: `main` push
- フロー:
  1. CI（Django check / frontend build）
  2. backend/nginx build + push
  3. `POST https://apply.syumatsucamera.com/`（mTLS）
  4. 通知

- apply 側で実行する処理:
  - `kubectl create secret ... | kubectl apply -f -`
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
- `revisionHistoryLimit: 5` を基本値とする。

## 9. 大まかなセットアップ手順
1. NAS registry を起動する（basic auth 有効）。
2. Cloudflare で `registry.syumatsucamera.com` と `apply.syumatsucamera.com` を作成する。
3. Cloudflare mTLS を `registry/apply` に設定する。
4. k3s に `cloudflared` Deployment を作成する（Token Secret 参照）。
5. k3s に `nginx/backend/worker/cronjob/postgres/redis` を適用する。
6. Ubuntu Server に apply エンドポイント（`127.0.0.1:19081`）を常駐させる。
7. gateway nginx で `apply` は POST 以外を拒否する。
8. Ubuntu Server 上で secret を作成し、`kubectl create secret ... | kubectl apply -f -` で投入する。
9. `kubectl apply -k k3s/base` で反映する。
10. GitHub Actions から build+push+apply を実行する。

## 10. TODO
- `apply` 経路に第2関門（HMAC or 共有トークン）を追加する。
- registry push 経路にも第2関門を追加する。
- cloudflared の可用性（replica 戦略）を運用負荷に応じて見直す。
