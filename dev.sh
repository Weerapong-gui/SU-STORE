#!/usr/bin/env bash
# Local dev: order-api (Python, port 10000) + Next.js (port 3000), both against a
# throwaway SQLite DB in data/dev/ — never production data. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

PY="$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)"
DEV_DATA="$PWD/data/dev"
mkdir -p "$DEV_DATA"

if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
COOKIE_SECRET=$(openssl rand -hex 32)
ORDER_API_BASE_URL=http://127.0.0.1:10000
ORDER_API_TOKEN=dev-token
BYPASS_TOKEN=dev-bypass
ALWAYS_OPEN=1
EOF
  echo "Created .env.local"
fi

[ -d node_modules ] || npm install

ORDER_API_HOST=127.0.0.1 \
ORDER_API_PORT=10000 \
ORDER_API_DB_PATH="$DEV_DATA/orders.db" \
ORDER_API_SLIDES_DIR="$DEV_DATA/slides" \
ORDER_API_ASSETS_DIR="$DEV_DATA/display2_assets" \
ORDER_API_TOKEN=dev-token \
BYPASS_TOKEN=dev-bypass \
PICKUP_PASSWORD=dev \
  "$PY" server/order_api.py &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT

echo "order-api → http://127.0.0.1:10000/admin"
npm run dev
