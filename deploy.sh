#!/usr/bin/env bash
set -euo pipefail

# SSH auth uses a dedicated deploy key (no password / no sshpass). Install it on the
# server once with:
#   ssh-copy-id -i ~/.ssh/su_store_deploy_ed25519.pub park@arch.sumfu.xyz
# The two `sudo -S` steps below still need the server's sudo password: provide it via
# DEPLOY_SSH_PASS, or (better) add a NOPASSWD sudoers rule and drop those pipes.
SUDO_PASS="${DEPLOY_SSH_PASS:-}"

SERVER="park@arch.sumfu.xyz"
REMOTE_DIR="/home/park/SU-STORE"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/su_store_deploy_ed25519}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey -i $DEPLOY_KEY"
SSH="ssh $SSH_OPTS $SERVER"
SCP="scp $SSH_OPTS"

echo "==> Packing files..."
tar -czf /tmp/su-store-deploy.tar.gz \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./tsconfig.tsbuildinfo' \
  --exclude='./.env' \
  --exclude='./deploy.sh' \
  .

echo "==> Uploading to server ($(du -sh /tmp/su-store-deploy.tar.gz | cut -f1))..."
$SCP /tmp/su-store-deploy.tar.gz $SERVER:/tmp/su-store-deploy.tar.gz

echo "==> Extracting on server..."
$SSH "
  mkdir -p $REMOTE_DIR
  tar -xzf /tmp/su-store-deploy.tar.gz -C $REMOTE_DIR --warning=no-unknown-keyword
  rm /tmp/su-store-deploy.tar.gz
"

echo "==> Ensuring image cache dir exists..."
$SSH "mkdir -p $REMOTE_DIR/data/next-image-cache && echo '$SUDO_PASS' | sudo -S chown -R 1001:1001 $REMOTE_DIR/data/next-image-cache 2>/dev/null || chmod 777 $REMOTE_DIR/data/next-image-cache"

echo "==> Rebuilding Docker (su-store + order-api)..."
$SSH "sg docker -c 'cd $REMOTE_DIR && docker compose --env-file $REMOTE_DIR/.env up -d --build --no-deps su-store order-api'" 2>&1

echo "==> Restarting cloudflared tunnel..."
$SSH "echo '$SUDO_PASS' | sudo -S systemctl restart cloudflared" || true  # connection drops briefly on tunnel restart — expected

echo "==> Warming Next.js image cache..."
$SSH "
  STORE_ORIGIN=http://localhost:3000
  for IMG in STAY_TUNED_horizontal STAY_TUNED_vertical BE_BACK_horizontal BE_BACK_vertical BE_RIGHT_BACK_horizontal BE_RIGHT_BACK_vertical; do
    for W in 640 750 828 1080 1200 1920 2048; do
      curl -s -o /dev/null \"\${STORE_ORIGIN}/_next/image?url=%2Fimages%2Fanc%2F\${IMG}.png&w=\${W}&q=75\" &
    done
  done
  wait
  echo 'Image cache warmed'
" 2>/dev/null || true

rm -f /tmp/su-store-deploy.tar.gz
echo ""
echo "✓ Done! https://sumfu.store"
