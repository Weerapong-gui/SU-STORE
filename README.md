# SU-STORE
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
- รูปแบบเลขออเดอร์: `FP28` + เลขลำดับ 4 หลัก + รอบ
  ตัวอย่างลำดับแรก: `FP2800011`
- Google Sheets webhook sample: `server/google_sheets_webhook.gs`
  - current spreadsheet id in sample: `1m-kRy-0nR0l2um4uE_sGRmpwSLmGDx42jPzQpFvne0U` (`gid=0`)
  - note: Google Sheets `pubhtml` URL is read-only publish view, not a webhook URL

ถ้าต้องการเปิดอัปโหลดสลิปบน Vercel ด้วย ต้องตั้ง `BLOB_READ_WRITE_TOKEN` หรือเชื่อม Vercel Blob กับ project.
