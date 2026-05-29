#!/usr/bin/env bash
set -e

SERVER="park@arch.sumfu.xyz"
REMOTE_DIR="/home/park/SU-STORE"
SSH_OPTS="-o StrictHostKeyChecking=no -o PreferredAuthentications=password"
SSH="sshpass -p 23007 ssh $SSH_OPTS $SERVER"
SCP="sshpass -p 23007 scp $SSH_OPTS"

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

echo "==> Rebuilding Docker (su-store + order-api)..."
$SSH "sg docker -c 'cd $REMOTE_DIR && docker compose --env-file $REMOTE_DIR/.env up -d --build --no-deps su-store order-api'" 2>&1

echo "==> Restarting cloudflared tunnel..."
$SSH "echo 23007 | sudo -S systemctl restart cloudflared" || true  # connection drops briefly on tunnel restart — expected

rm -f /tmp/su-store-deploy.tar.gz
echo ""
echo "✓ Done! https://sumfu.store"
