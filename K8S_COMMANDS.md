# k3s / Kubernetes 基本コマンド集

このプロジェクトの前提:
- namespace なし運用（default）
- マニフェスト管理ルート: `k3s/base`（本番反映は apply サーバー経由の overlay）
- 主要リソース: `nginx`, `backend`, `worker`, `cronjob`, `postgres`, `redis`, `cloudflared`

## 1. 現在状態の確認
```bash
kubectl get nodes -o wide
kubectl get pods -o wide
kubectl get deploy
kubectl get sts
kubectl get svc
kubectl get cronjob
kubectl get hpa
```

## 2. マニフェスト適用
```bash
kubectl kustomize k3s/base
```

差分確認のみ（plan相当）:
```bash
kubectl diff -k k3s/base
```

レンダリング結果のみ確認（plan補助）:
```bash
kubectl kustomize k3s/base
```

本番反映は `apply.syumatsucamera.com` 経由の overlay 適用を使う。

削除:
```bash
kubectl delete -k k3s/base
```

## 3. Secret 作成・更新
`app-secret`:
```bash
kubectl create secret generic app-secret \
  --from-env-file=/etc/weekend-camera/secrets/app.secret.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

`registry-credentials`:
```bash
kubectl create secret docker-registry registry-credentials \
  --docker-server=registry.syumatsucamera.com \
  --docker-username="$REGISTRY_USERNAME" \
  --docker-password="$REGISTRY_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`cloudflared-token`:
```bash
kubectl create secret generic cloudflared-token \
  --from-literal=token="$CLOUDFLARED_TUNNEL_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## 4. ロールアウト操作
再起動（設定変更や手動反映時に使用）:
```bash
kubectl rollout restart deployment/nginx deployment/backend deployment/worker
```

反映待ち:
```bash
kubectl rollout status deployment/nginx --timeout=300s
kubectl rollout status deployment/backend --timeout=300s
kubectl rollout status deployment/worker --timeout=300s
```

履歴確認:
```bash
kubectl rollout history deployment/backend
```

ロールバック:
```bash
kubectl rollout undo deployment/backend
```

## 5. ログ確認
```bash
kubectl logs deployment/backend --tail=200
kubectl logs deployment/worker --tail=200
kubectl logs deployment/nginx --tail=200
kubectl logs deployment/cloudflared --tail=200
```

追従:
```bash
kubectl logs -f deployment/backend
```

## 6. Pod 調査
Pod一覧:
```bash
kubectl get pods -o wide
```

詳細:
```bash
kubectl describe pod <pod-name>
```

イベント:
```bash
kubectl get events --sort-by=.metadata.creationTimestamp
```

## 7. コンテナ内実行
```bash
kubectl exec -it deploy/backend -- /bin/sh
kubectl exec -it deploy/postgres -- /bin/sh
kubectl exec -it deploy/redis -- /bin/sh
```

## 8. スケーリング
手動スケール:
```bash
kubectl scale deployment/backend --replicas=2
kubectl scale deployment/worker --replicas=2
```

HPA確認:
```bash
kubectl get hpa
kubectl describe hpa backend
kubectl describe hpa worker
```

## 9. イメージ・認証トラブル確認
ImagePullエラー確認:
```bash
kubectl describe pod <pod-name> | sed -n '/Events/,$p'
```

Secret参照確認:
```bash
kubectl get secret app-secret -o yaml
kubectl get secret registry-credentials -o yaml
kubectl get secret cloudflared-token -o yaml
```

## 10. CronJob 操作
一覧:
```bash
kubectl get cronjob
```

即時実行テスト:
```bash
kubectl create job --from=cronjob/app-cronjob app-cronjob-manual-$(date +%s)
```

PV反映の即時実行テスト:
```bash
kubectl create job --from=cronjob/app-pv-flush app-pv-flush-manual-$(date +%s)
```

Jobログ:
```bash
kubectl get jobs
kubectl logs job/<job-name>
```

## 11. よく使う一括確認
```bash
kubectl get deploy,sts,svc,pods,hpa,cronjob
```

```bash
kubectl get pods -o custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[*].ready,STATUS:.status.phase,RESTARTS:.status.containerStatuses[*].restartCount,IMAGE:.spec.containers[*].image
```
