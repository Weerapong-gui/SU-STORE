#!/usr/bin/env bash
set -euo pipefail

# SSH auth uses a dedicated deploy key (no password / no sshpass). Install it on the
# server once with:
#   ssh-copy-id -i ~/.ssh/su_store_deploy_ed25519.pub park@arch.sumfu.xyz
# Override the key path with DEPLOY_KEY=... if needed.
SERVER="park@arch.sumfu.xyz"
REMOTE_DIR="/home/park/SU-STORE"
DEPLOY_KEY="${DEPLOY_KEY:-$HOME/.ssh/su_store_deploy_ed25519}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey -i $DEPLOY_KEY"
SSH="ssh $SSH_OPTS $SERVER"
SCP="scp $SSH_OPTS"

echo "==> Packing server files..."
tar -czf /tmp/su-api-deploy.tar.gz \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./tsconfig.tsbuildinfo' \
  --exclude='./.env' \
  --exclude='./deploy.sh' \
  --exclude='./deploy-api.sh' \
  ./server \
  ./docker-compose.yml

echo "==> Uploading to server ($(du -sh /tmp/su-api-deploy.tar.gz | cut -f1))..."
$SCP /tmp/su-api-deploy.tar.gz $SERVER:/tmp/su-api-deploy.tar.gz

echo "==> Extracting on server..."
$SSH "
  tar -xzf /tmp/su-api-deploy.tar.gz -C $REMOTE_DIR --warning=no-unknown-keyword
  rm /tmp/su-api-deploy.tar.gz
"

echo "==> Rebuilding order-api only..."
$SSH "sg docker -c 'cd $REMOTE_DIR && docker compose --env-file $REMOTE_DIR/.env up -d --build --no-deps order-api'" 2>&1

rm -f /tmp/su-api-deploy.tar.gz
echo ""
echo "✓ Done! order-api redeployed."
