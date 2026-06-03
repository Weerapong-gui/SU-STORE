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

echo "==> Ensuring image cache dir exists..."
$SSH "mkdir -p $REMOTE_DIR/data/next-image-cache && echo 23007 | sudo -S chown -R 1001:1001 $REMOTE_DIR/data/next-image-cache 2>/dev/null || chmod 777 $REMOTE_DIR/data/next-image-cache"

echo "==> Rebuilding Docker (su-store + order-api)..."
$SSH "sg docker -c 'cd $REMOTE_DIR && docker compose --env-file $REMOTE_DIR/.env up -d --build --no-deps su-store order-api'" 2>&1

echo "==> Restarting cloudflared tunnel..."
$SSH "echo 23007 | sudo -S systemctl restart cloudflared" || true  # connection drops briefly on tunnel restart — expected

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
