# SU-STORE

เว็บขายเสื้อรับน้อง (FRESHER PACKAGE) ของมหาวิทยาลัยแม่ฟ้าหลวง — ประกอบด้วย `su-store`
(Next.js frontend) และ `su-order-api` (Python HTTP server + admin panel).

## Deployment (primary): self-hosted Docker + Cloudflare Tunnel

The live production system is **self-hosted with Docker Compose behind Cloudflare Tunnel**
(not Render). Both services are defined in `docker-compose.yml` and deployed with the
scripts in this repo:

- `deploy.sh` — rebuilds/redeploys **both** `su-store` and `order-api` (~1-3 min; customers
  may briefly see a connection error while it rebuilds).
- `deploy-api.sh` — rebuilds **only** `order-api` (fast, `su-store` is untouched). Use this
  whenever you only changed `server/` (e.g. `server/order_api.py` or `server/templates/`).

Architecture, server paths, Cloudflare Tunnel layout, and Docker commands are documented in
`CLAUDE.md` §3 (Server Architecture) and §7 (Deploy). Quick reference:

- `su-store` — Next.js on port 3000, reaches the API at `http://order-api:10000`
- `order-api` — Python server on internal port 10000 (exposed to localhost as 3010)
- Persistent data on the host (see `docker-compose.yml` volume `/home/park/SU-STORE/data/order-api:/var/data`):
  - SQLite DB: `/home/park/SU-STORE/data/order-api/su-order-api/orders.db`
    (container path `/var/data/su-order-api/orders.db`)
  - Uploaded slips: `/home/park/SU-STORE/data/order-api/su-order-api/slips/`
    (container path `/var/data/su-order-api/slips/`)

There is **no systemd unit for the app itself** — the containers run via Docker Compose with
`restart: unless-stopped`. The only systemd units involved are the two `cloudflared` tunnels
(see `CLAUDE.md` §3).

## Alternative: Render Web Service hosting (optional, not the live deployment)

> The section below documents an **optional/alternative** way to host the order API on Render.
> It is **not** how production currently runs (production is the self-hosted Docker setup above).
> Kept for reference in case a managed HTTPS host is ever needed.

The order API can run as a separate Render Web Service with a permanent HTTPS URL
and a persistent disk for SQLite + uploaded slips.

Files added for this:

- `server/Dockerfile`: Docker image for `server/order_api.py`
- `docker-compose.order-api.yml`: local/server Docker Compose runner with a persistent named volume
- `render.yaml`: Render Blueprint for a Docker web service with a 1 GB persistent disk mounted at `/var/data`

Recommended Render environment values:

- `ORDER_API_HOST=0.0.0.0`
- `ORDER_API_DB_PATH=/var/data/su-order-api/orders.db`
- `ORDER_API_SLIPS_DIR=/var/data/su-order-api/slips`
- `ORDER_PREFIX=FP28`
- `ORDER_ROUND=1`
- `KHANTOKE_TICKET_QUOTA=2000`
- `GOOGLE_SHEETS_WEBHOOK_URL=<Apps Script /exec URL>`
- `GOOGLE_SHEETS_WEBHOOK_TOKEN=<optional>`

After Render deploys, copy its public URL, for example
`https://su-order-api.onrender.com`, into Vercel as:

- `ORDER_API_BASE_URL=https://su-order-api.onrender.com`

Then redeploy the Vercel app. Check:

```bash
curl https://su-order-api.onrender.com/health
```

For local or self-hosted Docker testing:

```bash
docker compose --env-file .env.order-api.example -f docker-compose.order-api.yml up --build -d
curl http://localhost:3010/health
```

Docker Compose stores the SQLite database and uploaded slips in the named volume
`su-store_order-api-data`.

Admin page:

- URL: `http://localhost:3010/admin`
- Server URL: `http://172.26.55.36:3010/admin`
- Auth: paste `ORDER_API_TOKEN` into the token field
- Features: list orders, open uploaded slips, and update order status

Read-only order display:

- URL: `http://localhost:3010/orders`
- Server URL: `http://172.26.55.36:3010/orders`
- Auth: paste `ORDER_API_TOKEN` into the token field
- Features: view, search, filter, and open uploaded slips without editing order status

Google Sheets webhook:

- Orders are routed into product tabs named `POLO`, `BUNDLE`, `JACKET`, and `HEADBAND`
- After updating Apps Script, run `resetOrderSheets()` once to clear old rows and rewrite headers

เว็บขายเสื้อพี่เก็ต

## Order API

ถ้าต้องการให้ Vercel ใช้ฐานข้อมูลบน server ภายนอก ให้ตั้ง environment variables ต่อไปนี้ในโปรเจกต์:

- `ORDER_API_BASE_URL`
- `ORDER_API_TOKEN`
- `GOOGLE_SHEETS_WEBHOOK_URL` (optional)
- `GOOGLE_SHEETS_WEBHOOK_TOKEN` (optional)

service ฝั่ง server ใช้ไฟล์ [server/order_api.py](server/order_api.py) และเก็บข้อมูลใน SQLite

- รันด้วย Docker Compose (ไม่มี systemd service สำหรับตัวแอป — ดู "Deployment (primary)" ด้านบน)
- DB path บน host: `/home/park/SU-STORE/data/order-api/su-order-api/orders.db`
  (path ใน container: `/var/data/su-order-api/orders.db`)
- slip uploads บน host: `/home/park/SU-STORE/data/order-api/su-order-api/slips/`
  (path ใน container: `/var/data/su-order-api/slips/`)
- รูปแบบเลขออเดอร์: `{ORDER_PREFIX}{sequence:04d}{phase}` — prefix + เลขลำดับ 4 หลัก (zero-pad) + เลข phase ต่อท้าย
  ตัวอย่าง prefix `FP28`, sequence 150, phase 1 → `FP2801501`
- Google Sheets webhook sample: `server/google_sheets_webhook.gs`
  - ใส่ spreadsheet id ของคุณเองในตัวอย่าง (placeholder: `YOUR_SPREADSHEET_ID`, `gid=0`)
  - note: Google Sheets `pubhtml` URL is read-only publish view, not a webhook URL

ถ้าต้องการเปิดอัปโหลดสลิปบน Vercel ด้วย ต้องตั้ง `BLOB_READ_WRITE_TOKEN` หรือเชื่อม Vercel Blob กับ project.
