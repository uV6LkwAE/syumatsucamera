# apply.syumatsucamera.com セットアップ手順

## 目的
- `apply.syumatsucamera.com` への `POST` をトリガーに、Ubuntu Server 上でデプロイ job を実行する。
- 実行内容は `secret再適用 -> kubectl apply -> 初期化確認 -> migrate -> rollout restart/status` を行う。
- `apply` API は k3s 外（Ubuntu ホスト）で `systemd` 常駐する。
- 現行実装は `POST` ボディで `image_tag` を受け取り、`/status/{job_id}` で状態確認する job API である。
- 旧構成では shell スクリプトが入口だったが、現在は `apply_server.py` が入口兼実行役になっている。
- 旧シェル入口は削除し、手順書にも残さない。

## 1. ディレクトリ作成
```bash
sudo mkdir -p /opt/apply/bin /var/log/apply
sudo chown -R yamazaki:yamazaki /opt/apply /var/log/apply
```

## 2. 必要ファイル
`/opt/apply/apply_server.py` で使う環境変数ファイルを配置する。

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
TUNNEL_TOKEN=replace_me
POSTGRES_DB=syumatsucamera
POSTGRES_USER=app_prod_user
POSTGRES_PASSWORD=replace_me
DJANGO_SUPERUSER_EMAIL=admin@example.com
DJANGO_SUPERUSER_PASSWORD=replace_me
DJANGO_SUPERUSER_CF_ACCESS_SUB=google-oauth2|replace_me
DJANGO_SUPERUSER_DISPLAY_NAME=Admin
DJANGO_SUPERUSER_PROFILE=initial admin
DJANGO_SUPERUSER_ICON=/media/users/icons/default.png
DJANGO_SUPERUSER_HEADER_IMAGE=/media/users/headers/default.png
```

注記:
- `app.secret.env` は `kubectl --from-env-file` 専用で扱い、`source` しない。
- `apply_server.py` は毎回 `k3s` ディレクトリのみ sparse-checkout で同期してから `kubectl apply -k` を実行する。
- `TUNNEL_TOKEN` は `apply.secrets.env` に置き、`apply_server.py` が `cloudflared-token` Secret を毎回再作成する。
- `POSTGRES_PASSWORD` にシングルクオート（`'`）を含める場合は、上記 SQL の文字列クオートが崩れるため別途エスケープ対応が必要。

## 3. apply_server.py 作成
`/opt/apply/apply_server.py` を作成する。

```bash
#!/usr/bin/env python3
import base64
import json
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BIND_HOST = "0.0.0.0"
BIND_PORT = 19081
REPO_DIR = Path("/opt/apply/repo")
APP_SECRET_ENV = Path("/etc/syumatsucamera/secrets/app.secret.env")
APPLY_SECRET_ENV = Path("/etc/syumatsucamera/secrets/apply.secrets.env")
REGISTRY_SECRET_ENV = Path("/etc/syumatsucamera/secrets/registry.secret.env")
LOG_DIR = Path("/var/log/apply")
LOG_FILE = LOG_DIR / "deploy_apply.log"

JOB_STATUS = {}
JOB_LOCK = threading.Lock()
RUNNING_JOB_ID = None


class DeploymentError(RuntimeError):
    pass


def write_log(message):
    line = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {message}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def require_command(name):
    path = shutil.which(name)
    if not path:
        raise DeploymentError(f"{name} が見つかりません。")
    return path


def run_command(label, command, *, cwd=None, input_text=None):
    write_log(f"開始: {label}")
    result = subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        input=input_text,
        capture_output=True,
        text=True,
        check=False,
    )
    combined_output = "".join(part for part in [result.stdout, result.stderr] if part).strip()
    if result.returncode != 0:
        if combined_output:
            write_log(f"失敗: {label}")
        raise DeploymentError(combined_output or f"{label} failed with exit code {result.returncode}")
    write_log(f"完了: {label}")
    return result.stdout


def read_env_file(path):
    if not path.exists():
        raise DeploymentError(f"必須ファイルが見つかりません: {path}")
    data = {}
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            if "=" not in line:
                raise DeploymentError(f"不正な環境変数定義です: {path}")
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key:
                raise DeploymentError(f"不正な環境変数定義です: {path}")
            if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
                value = value[1:-1]
            data[key] = value
    return data


def must_get(mapping, key, source_name):
    value = mapping.get(key)
    if not value:
        raise DeploymentError(f"{source_name} の必須項目が不足しています: {key}")
    return value


def git_extra_header(token):
    token_bytes = f"x-access-token:{token}".encode("utf-8")
    basic = base64.b64encode(token_bytes).decode("ascii")
    return f"AUTHORIZATION: basic {basic}"


def sync_repository(repo_url, token, git_path):
    header = git_extra_header(token)
    if not (REPO_DIR / ".git").exists():
        run_command(
            "git clone",
            [
                git_path,
                "-c",
                f"http.extraheader={header}",
                "clone",
                "--depth=1",
                "--branch",
                "main",
                "--no-checkout",
                repo_url,
                str(REPO_DIR),
            ],
        )
        run_command(
            "git sparse-checkout init",
            [git_path, "-C", str(REPO_DIR), "sparse-checkout", "init", "--cone"],
        )
        run_command(
            "git sparse-checkout set k3s",
            [git_path, "-C", str(REPO_DIR), "sparse-checkout", "set", "k3s"],
        )

    run_command(
        "git fetch main",
        [
            git_path,
            "-C",
            str(REPO_DIR),
            "-c",
            f"http.extraheader={header}",
            "fetch",
            "--depth=1",
            "origin",
            "main",
        ],
    )
    run_command(
        "git checkout origin/main",
        [git_path, "-C", str(REPO_DIR), "checkout", "-B", "main", "origin/main"],
    )


def create_secret_from_env_file(kubectl_path, secret_name, env_file_path):
    generated = run_command(
        f"{secret_name} の secret マニフェスト生成",
        [
            kubectl_path,
            "create",
            "secret",
            "generic",
            secret_name,
            f"--from-env-file={str(env_file_path)}",
            "--dry-run=client",
            "-o",
            "yaml",
        ],
    )
    run_command(
        f"{secret_name} の反映",
        [kubectl_path, "apply", "-f", "-"],
        input_text=generated,
    )


def create_registry_secret(kubectl_path, registry_env):
    generated = run_command(
        "registry-credentials の secret マニフェスト生成",
        [
            kubectl_path,
            "create",
            "secret",
            "docker-registry",
            "registry-credentials",
            "--docker-server=registry.syumatsucamera.com",
            f"--docker-username={registry_env['REGISTRY_USERNAME']}",
            f"--docker-password={registry_env['REGISTRY_PASSWORD']}",
            "--dry-run=client",
            "-o",
            "yaml",
        ],
    )
    run_command(
        "registry-credentials の反映",
        [kubectl_path, "apply", "-f", "-"],
        input_text=generated,
    )


def create_overlay(repo_dir, job_id, image_tag):
    overlay_dir = repo_dir / "k3s" / ".deploy" / job_id
    if overlay_dir.exists():
        shutil.rmtree(overlay_dir)
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "kustomization.yaml").write_text(
        "\n".join(
            [
                "apiVersion: kustomize.config.k8s.io/v1beta1",
                "kind: Kustomization",
                "resources:",
                "  - ../../base",
                "images:",
                "  - name: registry.syumatsucamera.com/syumatsucamera/backend",
                f"    newTag: {image_tag}",
                "  - name: registry.syumatsucamera.com/syumatsucamera/nginx",
                f"    newTag: {image_tag}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return overlay_dir


def latest_backend_pod_name(kubectl_path):
    output = run_command(
        "backend pod の取得",
        [
            kubectl_path,
            "get",
            "pods",
            "-l",
            "app=backend",
            "--sort-by=.metadata.creationTimestamp",
            "-o",
            "jsonpath={.items[-1].metadata.name}",
        ],
    ).strip()
    if not output:
        raise DeploymentError("backend Pod を特定できませんでした。")
    return output


def run_job(job_id, image_tag):
    global RUNNING_JOB_ID

    kubectl_path = require_command("kubectl")
    git_path = require_command("git")

    try:
        apply_env = read_env_file(APPLY_SECRET_ENV)
        registry_env = read_env_file(REGISTRY_SECRET_ENV)

        repo_url = must_get(apply_env, "DEPLOY_REPO_URL", "apply.secrets.env")
        repo_token = must_get(apply_env, "DEPLOY_REPO_TOKEN", "apply.secrets.env")
        postgres_db = must_get(apply_env, "POSTGRES_DB", "apply.secrets.env")
        postgres_user = must_get(apply_env, "POSTGRES_USER", "apply.secrets.env")
        postgres_password = must_get(apply_env, "POSTGRES_PASSWORD", "apply.secrets.env")
        superuser_email = must_get(
            apply_env, "DJANGO_SUPERUSER_EMAIL", "apply.secrets.env"
        )
        superuser_password = must_get(
            apply_env, "DJANGO_SUPERUSER_PASSWORD", "apply.secrets.env"
        )
        superuser_cf_access_sub = must_get(
            apply_env, "DJANGO_SUPERUSER_CF_ACCESS_SUB", "apply.secrets.env"
        )
        superuser_display_name = must_get(
            apply_env, "DJANGO_SUPERUSER_DISPLAY_NAME", "apply.secrets.env"
        )
        superuser_profile = must_get(
            apply_env, "DJANGO_SUPERUSER_PROFILE", "apply.secrets.env"
        )
        superuser_icon = must_get(apply_env, "DJANGO_SUPERUSER_ICON", "apply.secrets.env")
        superuser_header_image = must_get(
            apply_env, "DJANGO_SUPERUSER_HEADER_IMAGE", "apply.secrets.env"
        )
        tunnel_token = must_get(apply_env, "TUNNEL_TOKEN", "apply.secrets.env")

        must_get(registry_env, "REGISTRY_USERNAME", "registry.secret.env")
        must_get(registry_env, "REGISTRY_PASSWORD", "registry.secret.env")

        create_secret_from_env_file(kubectl_path, "app-secret", APP_SECRET_ENV)
        cloudflared_generated = run_command(
            "cloudflared-token の secret マニフェスト生成",
            [
                kubectl_path,
                "create",
                "secret",
                "generic",
                "cloudflared-token",
                f"--from-literal=token={tunnel_token}",
                "--dry-run=client",
                "-o",
                "yaml",
            ],
        )
        run_command(
            "cloudflared-token の反映",
            [kubectl_path, "apply", "-f", "-"],
            input_text=cloudflared_generated,
        )
        create_registry_secret(kubectl_path, registry_env)

        sync_repository(repo_url, repo_token, git_path)

        overlay_dir = create_overlay(REPO_DIR, job_id, image_tag)
        try:
            run_command(
                "k3s マニフェストの反映",
                [kubectl_path, "apply", "-k", str(overlay_dir)],
            )

            run_command(
                "cloudflared の再起動",
                [kubectl_path, "rollout", "restart", "deployment/cloudflared"],
            )
            run_command(
                "backend/nginx/worker の再起動",
                [
                    kubectl_path,
                    "rollout",
                    "restart",
                    "deployment/nginx",
                    "deployment/backend",
                    "deployment/worker",
                ],
            )

            run_command(
                "postgres のロールアウト待機",
                [kubectl_path, "rollout", "status", "statefulset/postgres", "--timeout=300s"],
            )
            run_command(
                "cloudflared のロールアウト待機",
                [
                    kubectl_path,
                    "rollout",
                    "status",
                    "deployment/cloudflared",
                    "--timeout=300s",
                ],
            )
            run_command(
                "backend のロールアウト待機",
                [kubectl_path, "rollout", "status", "deployment/backend", "--timeout=300s"],
            )
            run_command(
                "nginx のロールアウト待機",
                [kubectl_path, "rollout", "status", "deployment/nginx", "--timeout=300s"],
            )
            run_command(
                "worker のロールアウト待機",
                [kubectl_path, "rollout", "status", "deployment/worker", "--timeout=300s"],
            )

            backend_pod = latest_backend_pod_name(kubectl_path)
            run_command(
                "migrate",
                [kubectl_path, "exec", backend_pod, "--", "python", "manage.py", "migrate", "--noinput"],
            )

            run_command(
                "初期管理者の確認/作成",
                [
                    kubectl_path,
                    "exec",
                    backend_pod,
                    "--",
                    "env",
                    f"DJANGO_SUPERUSER_EMAIL={superuser_email}",
                    f"DJANGO_SUPERUSER_PASSWORD={superuser_password}",
                    f"DJANGO_SUPERUSER_CF_ACCESS_SUB={superuser_cf_access_sub}",
                    f"DJANGO_SUPERUSER_DISPLAY_NAME={superuser_display_name}",
                    f"DJANGO_SUPERUSER_PROFILE={superuser_profile}",
                    f"DJANGO_SUPERUSER_ICON={superuser_icon}",
                    f"DJANGO_SUPERUSER_HEADER_IMAGE={superuser_header_image}",
                    "python",
                    "manage.py",
                    "shell",
                    "-c",
                    (
                        "from users.bootstrap_admin import ensure_initial_admin; "
                        "import os; "
                        "result = ensure_initial_admin("
                        "email=os.environ['DJANGO_SUPERUSER_EMAIL'], "
                        "password=os.environ['DJANGO_SUPERUSER_PASSWORD'], "
                        "cf_access_sub=os.environ['DJANGO_SUPERUSER_CF_ACCESS_SUB'], "
                        "display_name=os.environ['DJANGO_SUPERUSER_DISPLAY_NAME'], "
                        "profile=os.environ['DJANGO_SUPERUSER_PROFILE'], "
                        "icon=os.environ['DJANGO_SUPERUSER_ICON'], "
                        "header_image=os.environ['DJANGO_SUPERUSER_HEADER_IMAGE']); "
                        "print('admin created' if result.created else 'admin exists')"
                    ),
                ],
            )

            write_log(f"job={job_id} image_tag={image_tag} deploy success")
            with JOB_LOCK:
                JOB_STATUS[job_id] = {"status": "success", "detail": "", "image_tag": image_tag}
        finally:
            shutil.rmtree(overlay_dir, ignore_errors=True)
    except Exception as exc:
        detail = str(exc)
        write_log(f"job={job_id} image_tag={image_tag} deploy failed: {detail}")
        with JOB_LOCK:
            JOB_STATUS[job_id] = {
                "status": "failed",
                "detail": detail,
                "image_tag": image_tag,
            }
    finally:
        with JOB_LOCK:
            RUNNING_JOB_ID = None


class Handler(BaseHTTPRequestHandler):
    def _write_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_text(self, status_code, payload):
        body = payload.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/":
            self._write_json(
                HTTPStatus.NOT_FOUND,
                {"detail": "対象リソースが存在しません。", "code": "RESOURCE_NOT_FOUND"},
            )
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length) if length > 0 else b""
        if not raw_body:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "detail": "入力エラーです。",
                    "code": "VALIDATION_ERROR",
                    "errors": {"image_tag": ["この項目は必須です。"]},
                },
            )
            return

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "detail": "入力エラーです。",
                    "code": "VALIDATION_ERROR",
                    "errors": {"body": ["JSON形式ではありません。"]},
                },
            )
            return

        image_tag = str(payload.get("image_tag", "")).strip()
        if not image_tag:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "detail": "入力エラーです。",
                    "code": "VALIDATION_ERROR",
                    "errors": {"image_tag": ["この項目は必須です。"]},
                },
            )
            return
        if image_tag == "latest":
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "detail": "入力エラーです。",
                    "code": "VALIDATION_ERROR",
                    "errors": {"image_tag": ["latest は受け付けません。"]},
                },
            )
            return
        if not re.fullmatch(r"[0-9a-fA-F]{40}", image_tag):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {
                    "detail": "入力エラーです。",
                    "code": "VALIDATION_ERROR",
                    "errors": {"image_tag": ["40文字のコミットSHAを指定してください。"]},
                },
            )
            return

        global RUNNING_JOB_ID
        with JOB_LOCK:
            if RUNNING_JOB_ID is not None:
                self._write_json(
                    HTTPStatus.CONFLICT,
                    {
                        "detail": "現在デプロイが実行中です。",
                        "code": "RESOURCE_CONFLICT",
                    },
                )
                return

            job_id = str(uuid.uuid4())
            RUNNING_JOB_ID = job_id
            JOB_STATUS[job_id] = {
                "status": "running",
                "detail": "",
                "image_tag": image_tag,
            }

        thread = threading.Thread(target=run_job, args=(job_id, image_tag), daemon=True)
        thread.start()
        self._write_text(HTTPStatus.ACCEPTED, job_id)

    def do_GET(self):
        if not self.path.startswith("/status/"):
            self._write_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {
                    "detail": "許可されていないHTTPメソッドです。",
                    "code": "METHOD_NOT_ALLOWED",
                },
            )
            return

        job_id = self.path.removeprefix("/status/").strip("/")
        if not job_id:
            self._write_json(
                HTTPStatus.NOT_FOUND,
                {"detail": "対象リソースが存在しません。", "code": "RESOURCE_NOT_FOUND"},
            )
            return

        with JOB_LOCK:
            job = JOB_STATUS.get(job_id)
        if job is None:
            self._write_json(
                HTTPStatus.NOT_FOUND,
                {"detail": "対象ジョブが存在しません。", "code": "RESOURCE_NOT_FOUND"},
            )
            return

        self._write_json(HTTPStatus.OK, {"status": job["status"], "detail": job.get("detail", "")})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    write_log("apply server start")
    ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler).serve_forever()
```

現行の `apply_server.py` は job API である。実機コードはこの構成に合わせる。

- `POST /` に JSON `{ "image_tag": "<40文字のcommit SHA>" }` を送る
- `latest` は拒否する
- `GET /status/{job_id}` で実行状態を返す
- `app-secret` / `cloudflared-token` / `registry-credentials` を毎回再適用する
- `k3s/.deploy/{job_id}` に overlay を作り、`backend` と `nginx` の image tag を `image_tag` で置換する
- `kubectl apply -k` の後に `rollout restart/status` を行う
- `migrate` と `ensure_initial_admin` は backend Pod に対して実行する

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
job_id="$(curl -sS -X POST http://127.0.0.1:19081/ -H 'Content-Type: application/json' -d '{"image_tag":"0123456789abcdef0123456789abcdef01234567"}')"
echo "${job_id}"
curl -i "http://127.0.0.1:19081/status/${job_id}"
```

期待値:
- `POST /` は `202` と `job_id` を返す
- `GET /status/{job_id}` は JSON を返す
  - 例: `{"status": "running"}`
  - 例: `{"status": "failed", "detail": "..."}`

## 7. Nginx サーバーブロック設定
既存の Nginx 設定ファイルへ以下の `server` ブロックを追加する。

```bash
# registry
server {
    listen 127.0.0.1:18080;
    server_name registry.syumatsucamra.com;

    client_max_body_size 2g;

    location / {
        proxy_pass http://192.168.1.25:5000;

        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;

        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }
}

# apply
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

    location ^~ /status/ {
        if ($request_method != GET) {
            return 405;
        }

        proxy_pass http://127.0.0.1:19081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Request-Id $request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
```

反映:

```bash
sudo nginx -t
sudo systemctl reload nginx
job_id="$(curl -sS -X POST http://127.0.0.1:18082/)"
echo "${job_id}"
curl -i "http://127.0.0.1:18082/status/${job_id}"
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
- `deploy.yml` の deploy フェーズで、`POST https://apply.syumatsucamera.com/` に `{"image_tag":"${{ github.sha }}"}` を送る。
- `build_and_push` 成功後にのみ deploy フェーズが動くよう `needs` を維持する。

## 12. 重要補足（k3sのimage pullとmTLS）
- `apply_server.py` では `docker pull` を実行しない。
- Pod の image pull は k3s の containerd が実行する。
- `registry.syumatsucamera.com` で mTLS を必須にする場合、k3s ノード側（containerd）にも mTLS クライアント証明書設定が必要になる。

## 13. 実行タイミングの整理
- 毎回実行:
  - `git` で `k3s` ディレクトリのみ同期（sparse-checkout）
  - `kubectl apply -k /opt/apply/repo/k3s/base`
  - `python manage.py migrate --noinput`
  - `rollout restart/status`
- 初回だけ実質作成:
  - Django superuser 作成（存在時はskip）
- 毎回前提確認:
  - Postgres に `POSTGRES_USER` / `POSTGRES_DB` で接続できることを検証
