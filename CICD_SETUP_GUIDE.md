# CI/CD 構築手順書（GitHub Actions + NAS Registry + Ubuntu Deploy）

このドキュメントは、`infra.md` の方針に沿って CI/CD を構築するための実行手順をまとめたものです。

- CI/CD 実行基盤: GitHub-hosted runner
- トリガー: `main` ブランチへの `push`
- レジストリ: NAS（self-hosted registry）
- デプロイ方式: GitHub Actions -> SSH -> Ubuntu Server -> `kubectl apply`
- イメージタグ: `latest` + `sha`
- 本番適用タグ: `latest`
- 監査用に `sha` / digest を記録
- 同時デプロイ禁止: GitHub Actions `concurrency`
- 通知: 成功/失敗ともメール通知
- 監査ログ: GitHub Actions と Ubuntu の両方へ保存（正本は Ubuntu 側）

---

## 0. 前提と進め方

現時点では Ubuntu Server 上で既存サービスが稼働しており、停止したくない前提で進める。
そのため、作業は以下の 2 段階で実施する。

1. 非破壊準備フェーズ（今すぐ実施可能）
2. 切替フェーズ（開発完了後に実施）

---

## 1. 非破壊準備フェーズ（今すぐ実施可能）

### 1.1 GitHub 側の設定

- `Secrets` を登録する（漏えい禁止情報のみ）
  - `SSH_PRIVATE_KEY`
  - `SSH_KNOWN_HOSTS`
  - `REGISTRY_USERNAME`
  - `REGISTRY_PASSWORD`
  - `MAIL_SMTP_HOST`
  - `MAIL_SMTP_PORT`
  - `MAIL_USERNAME`
  - `MAIL_PASSWORD`
  - `MAIL_TO`
- `Variables` を登録する（非機密）
  - `DEPLOY_HOST`
  - `DEPLOY_PORT`
  - `DEPLOY_USER`
  - `REGISTRY_HOST`
  - `REGISTRY_REPOSITORY`
  - `K8S_NAMESPACE`
  - `ENV_NAME`（例: `prod`）

### 1.2 Ubuntu 側の準備（既存サービスに影響しない範囲）

- デプロイ専用ユーザーを作成する（通常運用ユーザーと分離）
- SSH を強化する
  - 公開鍵認証のみ
  - パスワード認証無効
  - `PermitRootLogin no`
  - `22/tcp` 閉鎖 + 変更ポート利用
- 監査ログ保管先を準備する
  - 例: `/var/log/syumatsucamera/deployments.log`
  - ローテーション設定（`logrotate`）
- 失敗ログ対策
  - `fail2ban` 導入
  - SSH 失敗ログ監視

### 1.3 NAS レジストリ準備

- `registry:2` + 認証（basic auth 以上）を有効化
- 可能なら TLS 有効化
- 直近 10 リビジョン保持ポリシーを設定
- 公開ポートをインターネットへ露出しない

### 1.4 Kubernetes マニフェストの事前準備（反映はまだしない）

- `Deployment` に RollingUpdate 戦略を定義
  - `maxUnavailable: 0`
  - `maxSurge: 1`
- `replicas: 1` 以上を維持
- `revisionHistoryLimit: 10`
- `readinessProbe` / `livenessProbe` / `startupProbe` を定義
- `imagePullSecrets` を設定

### 1.5 ワークフローファイルの事前作成

`.github/workflows/` に CI/CD 用 YAML を作成する。
この段階ではデプロイジョブを `dry-run` 相当にして、まだ本反映しない。

実装要件:
- `on.push.branches: [main]`
- `concurrency` で同時デプロイ禁止
- CI:
  - `python manage.py check`
  - `npm run build`
- Build/Push:
  - イメージへ `latest` と `sha` の両タグ付与
  - NAS レジストリへ push
- 通知:
  - success/failure ともメール送信
  - 件名形式:
    - `[syumatsucamera][deploy][SUCCESS] <sha7> <env>`
    - `[syumatsucamera][deploy][FAILURE] <sha7> <env>`

### 1.6 監査ログフォーマットの先行確定

最低限、以下を 1 レコードに含める。
- 時刻（UTC もしくは JST で統一）
- 実行者（GitHub actor）
- commit sha
- image digest（取得できる場合）
- 結果（success/failure）
- rollback 実施有無
- GitHub Actions run URL

---

## 2. 切替フェーズ（開発完了後に実施）

### 2.1 段階的有効化

1. `main` push で CI + Build + Push まで有効化
2. 数回安定を確認
3. SSH デプロイステップを有効化
4. `kubectl apply` + `rollout status` を有効化

### 2.2 本番デプロイ時の実行フロー

1. `main` push
2. GitHub Actions 開始
3. CI 実行（check/build）
4. イメージ build
5. NAS へ `latest` + `sha` push
6. Ubuntu Server へ SSH 接続
7. `kubectl apply` 実行
8. `kubectl rollout status` で完了判定
9. 成功/失敗を監査ログへ保存
10. 成功/失敗に関わらずメール通知

### 2.3 失敗時の扱い

- ローリング更新中に新リビジョンが Ready にならない場合:
  - 旧リビジョンを維持（`maxUnavailable: 0`）
- 必要に応じて:
  - `kubectl rollout undo` を実行
- 失敗時は必ず:
  - 監査ログ記録
  - FAILURE メール通知

---

## 3. 運用ルール

### 3.1 タグ運用

- push: `latest` + `sha`
- 適用: `latest`
- 監査: 実際に適用した `sha` / digest を記録

### 3.2 同時デプロイ禁止

- `concurrency` で同時実行を禁止
- 新しい実行が来た場合の扱い（キャンセル/待機）は workflow 側で明示

### 3.3 監査ログの保存先

- 正本: Ubuntu 側 `deployments.log`
- 副本: GitHub Actions 実行ログ

### 3.4 通知ルール

- 成功時: SUCCESS メール送信
- 失敗時: FAILURE メール送信
- `CRITICAL` ログ発生時: アプリ側メール通知（ログ方針準拠）

---

## 4. 最終チェックリスト（実装前）

- [ ] GitHub `Secrets`/`Variables` 登録完了
- [ ] Ubuntu の SSH 強化完了（鍵認証のみ、22閉鎖）
- [ ] デプロイ専用ユーザー作成完了
- [ ] NAS レジストリ認証/TLS/保持ポリシー確認
- [ ] k8s マニフェストに RollingUpdate/Probe 設定済み
- [ ] workflow に `concurrency` 設定済み
- [ ] success/failure メール通知確認済み
- [ ] Ubuntu 側監査ログ出力確認済み

---

## 5. 補足

- デプロイコマンドの詳細（`kubectl apply` 対象パス、`rollout status` 対象名、timeout）は、実環境に合わせて最終確定する。
- 既存サービス停止を避けるため、必ず「Build/Push の安定確認 -> Deploy 有効化」の順で段階導入する。
