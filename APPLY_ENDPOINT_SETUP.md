# apply.syumatsucamera.com セットアップ手順

## 目的
- `apply.syumatsucamera.com` への `POST` をトリガーに、Ubuntu Server 上で固定スクリプトを実行する。
- 実行内容は `secret再適用 -> kubectl apply -> kubectl rollout restart/status` に限定する。
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

LOCK_FILE="/tmp/deploy_apply.lock"
LOG_FILE="/var/log/apply/deploy_apply.log"
APP_SECRET_ENV="/etc/syumatsucamera/secrets/app.secret.env"
REGISTRY_SECRET_ENV="/etc/syumatsucamera/secrets/registry.secret.env"

exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "already running" | tee -a "${LOG_FILE}"; exit 1; }

{
  date -u +"[%Y-%m-%dT%H:%M:%SZ] deploy start"

  test -f "${APP_SECRET_ENV}"
  test -f "${REGISTRY_SECRET_ENV}"

  kubectl create secret generic app-secret \
    --from-env-file="${APP_SECRET_ENV}" \
    --dry-run=client -o yaml | kubectl apply -f -

  set -a
  . "${REGISTRY_SECRET_ENV}"
  set +a

  test -n "${REGISTRY_USERNAME}"
  test -n "${REGISTRY_PASSWORD}"

  kubectl create secret docker-registry registry-credentials \
    --docker-server=registry.syumatsucamera.com \
    --docker-username="${REGISTRY_USERNAME}" \
    --docker-password="${REGISTRY_PASSWORD}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl apply -k /opt/apply/k3s/base
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
