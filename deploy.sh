#!/usr/bin/env bash
# Deploy the committed HEAD to the production server and rebuild containers.
#
#   ./deploy.sh          # su-store + order-api
#   ./deploy.sh store    # su-store only
#   ./deploy.sh api      # order-api only
#
# Ships `git archive HEAD` (never uncommitted edits) via rsync over SSH key auth.
# Server-only files (.env, .env.local, data/) are not in git, so they are never touched.
# Override the target with DEPLOY_HOST=park@192.168.31.242 (LAN) if Tailscale is down.
set -euo pipefail

TARGET="${1:-all}"
case "$TARGET" in
  all)   SERVICES="su-store order-api" ;;
  store) SERVICES="su-store" ;;
  api)   SERVICES="order-api" ;;
  *) echo "usage: $0 [all|store|api]" >&2; exit 1 ;;
esac

SERVER="${DEPLOY_HOST:-park@100.94.120.103}"
REMOTE_DIR="/home/park/SU-STORE"
SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes $SERVER"

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi
REV="$(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Exporting $REV..."
git archive HEAD | tar -x -C "$STAGE"
echo "$REV $(date -u +%FT%TZ)" > "$STAGE/REVISION"

echo "==> Syncing to $SERVER:$REMOTE_DIR..."
rsync -rlcz "$STAGE/" "$SERVER:$REMOTE_DIR/"

echo "==> Rebuilding: $SERVICES"
$SSH "cd $REMOTE_DIR && docker compose --env-file .env up -d --build --no-deps $SERVICES"

echo "==> Waiting for health checks..."
for i in $(seq 1 30); do
  sleep 3
  STATUS="$($SSH "docker inspect -f '{{.Name}}={{.State.Health.Status}}' su-store su-order-api")"
  if ! echo "$STATUS" | grep -qv '=healthy'; then
    echo "$STATUS"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "✗ Not healthy after 90s:" >&2; echo "$STATUS" >&2
    echo "  Check logs: ssh $SERVER docker logs --tail 50 su-store" >&2
    exit 1
  fi
done

if [ "$TARGET" != api ]; then
  echo "==> Warming Next.js image cache..."
  $SSH '
    for IMG in STAY_TUNED_horizontal STAY_TUNED_vertical BE_BACK_horizontal BE_BACK_vertical BE_RIGHT_BACK_horizontal BE_RIGHT_BACK_vertical; do
      for W in 640 750 828 1080 1200 1920 2048; do
        curl -s -o /dev/null "http://localhost:3000/_next/image?url=%2Fimages%2Fanc%2F${IMG}.png&w=${W}&q=75" &
      done
    done
    wait
  ' || true
fi

echo ""
echo "✓ Deployed $REV → https://sumfu.store"
