# SU-STORE

## Permanent Order API Hosting

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

service ฝั่ง server ใช้ไฟล์ [server/order_api.py](/Users/parkk/Desktop/su_store/SU-STORE/server/order_api.py:1) และเก็บข้อมูลใน SQLite

- path บน server: `/home/park/su-order-api/data/orders.db`
- slip uploads on server: `/home/park/su-order-api/data/slips`
- systemd user service: `su-order-api.service`
- รูปแบบเลขออเดอร์: `FP28` + เลขลำดับ 5 หลัก
  ตัวอย่างลำดับแรก: `FP2800001`
- Google Sheets webhook sample: `server/google_sheets_webhook.gs`
  - current spreadsheet id in sample: `1m-kRy-0nR0l2um4uE_sGRmpwSLmGDx42jPzQpFvne0U` (`gid=0`)
  - note: Google Sheets `pubhtml` URL is read-only publish view, not a webhook URL

ถ้าต้องการเปิดอัปโหลดสลิปบน Vercel ด้วย ต้องตั้ง `BLOB_READ_WRITE_TOKEN` หรือเชื่อม Vercel Blob กับ project.
