# apply.syumatsucamera.com セットアップ手順

## 目的
- `apply.syumatsucamera.com` への `POST` をトリガーに、Ubuntu Server 上で固定スクリプトを実行する。
- 実行内容は `secret再適用 -> kubectl apply -> 初期化確認 -> migrate -> rollout restart/status` を行う。
- `apply` API は k3s 外（Ubuntu ホスト）で `systemd` 常駐する。

## 1. ディレクトリ作成
```bash
sudo mkdir -p /opt/apply/bin /var/log/apply
sudo chown -R yamazaki:yamazaki /opt/apply /var/log/apply
```

## 2. 固定スクリプト作成
`/opt/apply/bin/deploy_apply.sh` を作成する。

```bash
cat <<'EOF' | sudo tee /opt/apply/bin/deploy_apply.sh > /dev/null
#!/usr/bin/env bash
set -euo pipefail

# 排他制御とログ出力先
LOCK_FILE="/tmp/deploy_apply.lock"
LOG_FILE="/var/log/apply/deploy_apply.log"
APP_SECRET_ENV="/etc/syumatsucamera/secrets/app.secret.env"
APPLY_SECRET_ENV="/etc/syumatsucamera/secrets/apply.secrets.env"
REGISTRY_SECRET_ENV="/etc/syumatsucamera/secrets/registry.secret.env"
REPO_DIR="/opt/apply/repo"

# 二重実行を防ぐためのロック取得
exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "already running" | tee -a "${LOG_FILE}"; exit 1; }

{
  date -u +"[%Y-%m-%dT%H:%M:%SZ] deploy start"

  # 必須ファイルの存在確認
  test -f "${APP_SECRET_ENV}"
  test -f "${APPLY_SECRET_ENV}"
  test -f "${REGISTRY_SECRET_ENV}"

  # apply専用の環境変数を読み込む
  set -a
  . "${APPLY_SECRET_ENV}"
  set +a

  # Gitは非対話で実行する
  export GIT_TERMINAL_PROMPT=0
  GIT_AUTH_HEADER="Authorization: Basic $(printf 'x-access-token:%s' "${DEPLOY_REPO_TOKEN}" | base64 | tr -d '\n')"

  # applyスクリプト側で必要な変数の空チェック
  test -n "${POSTGRES_DB}"
  test -n "${POSTGRES_USER}"
  test -n "${POSTGRES_PASSWORD}"
  test -n "${DJANGO_SUPERUSER_USERNAME}"
  test -n "${DJANGO_SUPERUSER_PASSWORD}"
  test -n "${DEPLOY_REPO_URL}"
  test -n "${DEPLOY_REPO_TOKEN}"

  # app-secret を毎回再作成して反映
  kubectl create secret generic app-secret \
    --from-env-file="${APP_SECRET_ENV}" \
    --dry-run=client -o yaml | kubectl apply -f -

  # registry 認証情報を読み込む
  set -a
  . "${REGISTRY_SECRET_ENV}"
  set +a

  # registry 認証情報の空チェック
  test -n "${REGISTRY_USERNAME}"
  test -n "${REGISTRY_PASSWORD}"

  # imagePullSecret を毎回再作成して反映
  kubectl create secret docker-registry registry-credentials \
    --docker-server=registry.syumatsucamera.com \
    --docker-username="${REGISTRY_USERNAME}" \
    --docker-password="${REGISTRY_PASSWORD}" \
    --dry-run=client -o yaml | kubectl apply -f -

  # 初回のみ clone して k3s ディレクトリだけ sparse-checkout する
  if [ ! -d "${REPO_DIR}/.git" ]; then
    git -c http.extraheader="${GIT_AUTH_HEADER}" \
      clone --filter=blob:none --no-checkout "${DEPLOY_REPO_URL}" "${REPO_DIR}"
    git -C "${REPO_DIR}" sparse-checkout init --cone
    git -C "${REPO_DIR}" sparse-checkout set k3s
  fi

  # 毎回最新の main を同期する
  git -C "${REPO_DIR}" -c http.extraheader="${GIT_AUTH_HEADER}" \
    fetch origin main
  git -C "${REPO_DIR}" -c http.extraheader="${GIT_AUTH_HEADER}" \
    checkout -B main origin/main

  # k3s マニフェストを適用し、先に postgres/backend の起動を待つ
  kubectl apply -k "${REPO_DIR}/k3s/base"
  kubectl rollout status statefulset/postgres --timeout=300s
  kubectl rollout status deployment/backend --timeout=300s

  # 初回不足時のみ Postgres のロール/DB を作成する
  kubectl exec statefulset/postgres -- sh -ec "
    psql -U postgres -d postgres -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'\" | grep -q 1 || \
    psql -U postgres -d postgres -c \"CREATE ROLE \\\"${POSTGRES_USER}\\\" LOGIN PASSWORD '${POSTGRES_PASSWORD}'\"
    psql -U postgres -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'\" | grep -q 1 || \
    psql -U postgres -d postgres -c \"CREATE DATABASE \\\"${POSTGRES_DB}\\\" OWNER \\\"${POSTGRES_USER}\\\"\"
  "

  # 毎回 migrate を実行する
  kubectl exec deploy/backend -- python manage.py migrate --noinput

  # 初回不足時のみ Django superuser を作成する
  kubectl exec deploy/backend -- env \
    DJANGO_SUPERUSER_USERNAME="${DJANGO_SUPERUSER_USERNAME}" \
    DJANGO_SUPERUSER_PASSWORD="${DJANGO_SUPERUSER_PASSWORD}" \
    python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); username = '${DJANGO_SUPERUSER_USERNAME}'; password = '${DJANGO_SUPERUSER_PASSWORD}'; user, created = User.objects.get_or_create(username=username, defaults={'is_staff': True, 'is_superuser': True}); (user.set_password(password), setattr(user, 'is_staff', True), setattr(user, 'is_superuser', True), user.save()) if created else None; print('superuser created' if created else 'superuser exists')"

  # 最新イメージ反映のために対象 Deployment を再起動し、完了待ち
  kubectl rollout restart deployment/nginx deployment/backend deployment/worker
  kubectl rollout status deployment/nginx --timeout=300s
  kubectl rollout status deployment/backend --timeout=300s
  kubectl rollout status deployment/worker --timeout=300s

  date -u +"[%Y-%m-%dT%H:%M:%SZ] deploy success"
} | tee -a "${LOG_FILE}"
EOF

sudo chmod 700 /opt/apply/bin/deploy_apply.sh
```

`registry.secret.env` の例:
```env
REGISTRY_USERNAME=replace_me
REGISTRY_PASSWORD=replace_me
```

`app.secret.env` に最低限必要な追加入力例:
```env
SECRET_KEY=replace_me
DEBUG=false
ALLOWED_HOSTS=syumatsucamera.com,cms.syumatsucamera.com
...（Django本体の実行用変数を定義）
```

`apply.secrets.env` に最低限必要な追加入力例:
```env
DEPLOY_REPO_URL=https://github.com/uV6LkwAE/syumatsucamera
DEPLOY_REPO_TOKEN=replace_me
POSTGRES_DB=syumatsucamera
POSTGRES_USER=app_prod_user
POSTGRES_PASSWORD=replace_me
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_PASSWORD=replace_me
```

注記:
- `app.secret.env` は `kubectl --from-env-file` 専用で扱い、`source` しない。
- `deploy_apply.sh` は毎回 `k3s` ディレクトリのみ sparse-checkout で同期してから `kubectl apply -k` を実行する。
- `POSTGRES_PASSWORD` にシングルクオート（`'`）を含める場合は、上記 SQL の文字列クオートが崩れるため別途エスケープ対応が必要。

## 3. 固定スクリプト動作確認
```bash
/opt/apply/bin/deploy_apply.sh
echo $?
```

## 4. apply_server.py 作成
`/opt/apply/apply_server.py` を作成する。

```bash
cat <<'EOF' | sudo tee /opt/apply/apply_server.py > /dev/null
from http.server import BaseHTTPRequestHandler, HTTPServer
import subprocess

SCRIPT_PATH = "/opt/apply/bin/deploy_apply.sh"
BIND_HOST = "127.0.0.1"
BIND_PORT = 19081

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length > 0:
            self.rfile.read(length)

        result = subprocess.run([SCRIPT_PATH], capture_output=True, text=True)
        code = 200 if result.returncode == 0 else 500

        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write((result.stdout + result.stderr).encode("utf-8"))

    def do_GET(self):
        self.send_response(405)
        self.end_headers()

    def log_message(self, fmt, *args):
        return

if __name__ == "__main__":
    HTTPServer((BIND_HOST, BIND_PORT), Handler).serve_forever()
EOF

sudo chown yamazaki:yamazaki /opt/apply/apply_server.py
```

## 5. systemd 常駐設定
`/etc/systemd/system/apply-server.service` を作成する。

```bash
cat <<'EOF' | sudo tee /etc/systemd/system/apply-server.service > /dev/null
[Unit]
Description=Apply Endpoint Server
After=network.target

[Service]
Type=simple
User=yamazaki
WorkingDirectory=/opt/apply
ExecStart=/usr/bin/python3 /opt/apply/apply_server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now apply-server.service
sudo systemctl status apply-server.service --no-pager
```

## 6. ローカル疎通確認（19081）
```bash
curl -i -X POST http://127.0.0.1:19081/
curl -i http://127.0.0.1:19081/
```

期待値:
- `POST` は `200` または `500`
- `GET` は `405`

## 7. Nginx apply ブロック設定（18082）
既存の Nginx 設定ファイルへ以下の `server` ブロックを追加する。

```nginx
server {
    listen 127.0.0.1:18082;
    server_name apply.syumatsucamera.com;

    location = / {
        if ($request_method != POST) {
            return 405;
        }

        proxy_pass http://127.0.0.1:19081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Request-Id $request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 600s;
    }
}
```

反映:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -i -X POST http://127.0.0.1:18082/
curl -i http://127.0.0.1:18082/
```

## 8. Cloudflare Tunnel 設定
- `apply.syumatsucamera.com` の public hostname を追加する。
- Service URL は `http://127.0.0.1:18082` を指定する。

## 9. Cloudflare mTLS 設定
- `SSL/TLS > クライアント証明書` で `apply.syumatsucamera.com` を有効ホストに追加する。
- 未提示/未検証証明書をブロックする。
- 証明書個体（`cert_serial` または `cert_fingerprint_sha256`）を固定する。

## 10. 外部疎通確認（mTLS あり / なし）
```bash
curl -i -X POST \
  --cert gha-push-client.crt \
  --key gha-push-client.key \
  https://apply.syumatsucamera.com/

curl -i -X POST https://apply.syumatsucamera.com/
```

期待値:
- mTLSあり: `200` または `500`
- mTLSなし: ブロック（`403`）

## 11. GitHub Actions 連携
- `deploy.yml` の deploy フェーズで、`POST https://apply.syumatsucamera.com/` を実行する。
- `build_and_push` 成功後にのみ deploy フェーズが動くよう `needs` を維持する。

## 12. 重要補足（k3sのimage pullとmTLS）
- `deploy_apply.sh` では `docker pull` を実行しない。
- Pod の image pull は k3s の containerd が実行する。
- `registry.syumatsucamera.com` で mTLS を必須にする場合、k3s ノード側（containerd）にも mTLS クライアント証明書設定が必要になる。

## 13. 実行タイミングの整理
- 毎回実行:
  - `git` で `k3s` ディレクトリのみ同期（sparse-checkout）
  - `kubectl apply -k /opt/apply/repo/k3s/base`
  - `python manage.py migrate --noinput`
  - `rollout restart/status`
- 初回だけ実質作成:
  - Postgres ロール作成（存在時はskip）
  - Postgres DB 作成（存在時はskip）
  - Django superuser 作成（存在時はskip）
