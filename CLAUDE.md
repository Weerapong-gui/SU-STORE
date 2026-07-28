# SU STORE — Project Guide for AI

คู่มือนี้เก็บเฉพาะสิ่งที่อ่านจากโค้ดเองไม่ได้ — โครงสร้างไฟล์/schema/รายการ dependency ให้ดูจากโค้ดตรงๆ

รายละเอียดที่โหลดเมื่อจำเป็น:
- `server/CLAUDE.md` — โครงสร้างภายใน `order_api.py`, กฎการแก้ template, หน้าจอ operator (claim station / display / refund / OCR / receipt)
- skill `deploy` — ขั้นตอน deploy, SSH เข้าเซิร์ฟเวอร์, คำสั่ง docker ที่ใช้บ่อย

---

## 1. ภาพรวม (Overview)

SU STORE เป็นระบบสั่งซื้อเสื้อรับน้องของมหาวิทยาลัยแม่ฟ้าหลวง (MFU) ประกอบด้วย 2 services หลัก:

| Service | Tech | URL | หน้าที่ |
|---------|------|-----|---------|
| `su-store` | Next.js 14 (App Router) | `https://sumfu.store` | หน้าร้านค้าสำหรับลูกค้า |
| `su-order-api` | Python (raw HTTP, no framework) | `https://admin.sumfu.xyz` | API + Admin panel |

> **Hosting:** รันบนเซิร์ฟเวอร์ตัวเอง (Arch Linux) ผ่าน Docker + Cloudflare Tunnel  
> โดเมน `sumfu.store` จดทะเบียนที่ Vercel แต่ DNS จัดการที่ Cloudflare (nameserver ชี้มา Cloudflare)

---

## 2. สถาปัตยกรรมเซิร์ฟเวอร์ (Server Architecture)

```
ลูกค้า → Cloudflare → sumfu.store → su-store (Next.js :3000)
                                           ↓ (Docker internal network)
                                     order-api (:10000)

แอดมิน → Cloudflare Tunnel → admin.sumfu.xyz → order-api (:3010 → :10000)
```

**เซิร์ฟเวอร์จริง:** `park@arch.sumfu.xyz` (password: ดูจาก admin)

**Docker containers:**
- `su-store` — port 3000, connects to order-api via `http://order-api:10000`
- `su-order-api` — port 10000 (internal), 3010 (localhost only)

**Cloudflare Tunnels:** มี 2 tunnels แยกกัน (คนละ Cloudflare zone):

| systemd service | tunnel ID | config file | hostnames |
|-----------------|-----------|-------------|-----------|
| `cloudflared` | `bc991342-...` | `/etc/cloudflared/config.yml` | `arch.sumfu.xyz`, `admin.sumfu.xyz`, `api.sumfu.xyz`, `store.sumfu.xyz` |
| `cloudflared-store` | `39308774-...` | `/home/park/.cloudflared/config-store.yml` | `sumfu.store`, `www.sumfu.store` |

ทั้งสองรัน auto-start เมื่อ reboot (systemd enabled)

**ข้อมูล persistent บนเซิร์ฟเวอร์** (อยู่นอก image ไม่หายตอน rebuild):
- Database: `/home/park/SU-STORE/data/order-api/su-order-api/orders.db` (SQLite)
- Slip images: `/home/park/SU-STORE/data/order-api/su-order-api/slips/`

---

## 3. กฎที่ห้ามพลาด

1. **อย่าแตะข้อมูลออเดอร์** — ห้ามแก้ SQL ที่ write ข้อมูล ห้ามเปลี่ยน schema โดยไม่ตั้งใจ ถ้าจำเป็นต้องแตะ ให้ backup ด้วย `sqlite3 .backup()` (ไม่ใช่ `cp` เพราะมี WAL) ก่อนเสมอ

2. **Timezone** — `created_at` ใน SQLite เก็บ UTC เสมอ ต้องบวก +7 ชั่วโมงทุกครั้งที่แสดงผล:
   - SQL: `DATE(created_at, '+7 hours')`
   - JS: `new Date(iso + 'Z').getTime() + 7*3600000`

3. **แก้แค่ `server/` → ใช้ `bash deploy-api.sh` เท่านั้น** — ห้ามใช้ `deploy.sh` เพราะมัน rebuild Next.js ไปด้วย ระหว่างนั้นลูกค้าจะเห็น "Unable to connect to the ordering service right now"

---

## 4. Business Logic สำคัญ

### หมายเลขออเดอร์ (Order ID)

รูปแบบ: `{ORDER_PREFIX}{sequence:04d}{phase}` (prefix + เลขลำดับ 4 หลัก zero-pad + เลข phase ต่อท้าย)
- ตัวอย่าง: prefix `FP28`, sequence `150`, phase `1` → `FP2801501` (ดู `create_order_code()`)
- `ORDER_PREFIX` มาจาก env var (ตอนนี้คือ `FP28`)
- Phase คำนวณจาก `get_current_phase()` (ดู DB)

### slug กับ category — คนละอย่างกัน ระวังสับสน

- **slug** (`items_json` → `item.product.slug`, column `product_slug`): `single-shirt`, `fresh-jacket`, `fresh-headband`
- **category** (`item.product.category`, column `product_category`, key ของ `PRODUCT_COST`): `single`, `jacket`, `headband`

query ที่กรองสินค้าต้องเลือกให้ถูกชนิด ไม่งั้นได้ 0 แถวโดยไม่มี error; และ slug ใน `items_json` **ซ้อนอยู่ใน `item.product.slug`** ไม่ได้อยู่ระดับบนของ item

### บัตรขันโตก (Khantok Ticket)

**เงื่อนไขได้รับบัตร:**
1. รหัสนักศึกษาต้องขึ้นต้นด้วย `"693"` (KHANTOK_STUDENT_CODE_PREFIX)
2. ยังไม่เคยได้บัตรจากออเดอร์อื่น (student_code เดียวกัน)
3. Quota ยังเหลือ (฿100 quota: KHANTOK_QUOTA_100, ฿50 quota: KHANTOK_QUOTA_50)

**3 states ของบัตรขันโตกใน admin:**
- `khantokTicket = true` → 🎟 ได้บัตร ฿100/50 (สีเขียว)
- `khantokTicket = false` + `khantokTicketAlreadyClaimed = true` → 🎟 ได้ไปแล้ว (สีส้ม) — คนนี้ได้บัตรจาก order อื่น
- `khantokTicket = false` + `khantokTicketAlreadyClaimed = false` → ไม่ได้บัตร (สีเทา)

`khantok_ticket_claims` = โควตาที่จองตอนสร้างออเดอร์ ส่วน `khantok_station_claimed_at` = รับบัตรจริงที่หน้างาน คนละเรื่องกัน การรับบัตรที่หน้างานไม่แตะโควตา

### Order Statuses

```
pending_payment → waiting_confirm → paid → preparing → shipped
                                  ↘ cancelled / rejected
```

| status | ความหมาย |
|--------|---------|
| `pending_payment` | รอลูกค้าอัปโหลดสลิป |
| `waiting_confirm` | ลูกค้าอัปสลิปแล้ว รอ admin ยืนยัน |
| `paid` | admin ยืนยันแล้ว |
| `preparing` | กำลังจัดเตรียม |
| `shipped` | พร้อมรับ (แสดงว่า "Ready to Receive") |
| `received` | รับของแล้วที่ claim station |
| `refund` / `refunded` | รอคืนเงิน / คืนแล้ว |
| `cancelled` / `rejected` | ยกเลิก/ปฏิเสธ (ซ่อนจากหน้าลูกค้า) |

---

## 5. การ Deploy

| แก้ไขอะไร | ใช้ script ไหน | ผลกระทบต่อลูกค้า |
|-----------|---------------|----------------|
| เฉพาะ `server/` (order-api + templates) | `bash deploy-api.sh` | น้อยมาก (order-api restart ~3-5 วินาที) |
| Next.js frontend (`src/`) | `bash deploy.sh` | su-store + order-api restart ~1-3 นาที |
| ทั้งคู่ | `bash deploy.sh` | ~1-3 นาที |

ขั้นตอนภายใน, การ SSH, และคำสั่ง docker ที่ใช้บ่อย → skill `deploy`

---

## 6. Environment Variables

**`.env` บนเซิร์ฟเวอร์** (ที่ `/home/park/SU-STORE/.env`, ไม่ถูก commit):

| Variable | ใช้โดย | ตัวอย่าง |
|----------|--------|---------|
| `ORDER_API_BASE_URL` | su-store | `http://order-api:10000` |
| `ORDER_API_TOKEN` | ทั้งคู่ | token สำหรับ authorize |
| `COOKIE_SECRET` | su-store | random 32+ chars |
| `ORDER_PREFIX` | order-api | `FP28` |
| `ORDER_ROUND` | order-api | `1` |
| `KHANTOKE_TICKET_QUOTA` | order-api | `2000` |
| `BYPASS_TOKEN` | ทั้งคู่ | token สำหรับ bypass schedule |
| `GOOGLE_SHEETS_WEBHOOK_URL` | order-api | optional (ตอนนี้ว่าง = ปิด sync) |

---

## 7. Pitfalls ที่เคยเจอ (เรียนรู้จากประสบการณ์จริง)

### 🐛 JavaScript อยู่ผิดไฟล์ template
**ปัญหา:** ใส่ JS ของหน้าหนึ่ง (เช่น `initTheme` ของ admin) ไปในไฟล์ template อีกหน้า → ฟีเจอร์ใช้ไม่ได้
**บทเรียน:** แต่ละหน้าคือไฟล์ `templates/*.html` คนละไฟล์และมี `<script>` ของตัวเอง แก้ JS ให้แก้ในไฟล์ template ของหน้านั้น ไม่ใช่ในไฟล์อื่นหรือใน `order_api.py`

### 🐛 ไม่ได้ escape ข้อมูลลูกค้าก่อน innerHTML
**ปัญหา:** ต่อค่าที่มาจากผู้ใช้ (ชื่อ/note) เข้า HTML string ตรงๆ → HTML แตก หรือเสี่ยง XSS
**บทเรียน:** ห่อค่าด้วย helper `esc()` / `text()` ในไฟล์ template ก่อนใส่ `innerHTML` เสมอ

### 🐛 SVG attribute ไม่มี quotes
**ปัญหา:** `fill=#4f6ef7` → browser parse ผิด → กราฟแท่งไม่แสดง
**บทเรียน:** ใน JS string ที่ generate SVG ต้องใช้ double-quote ล้อม attribute เสมอ: `fill="#4f6ef7"`

### 🐛 Docker disk full
**ปัญหา:** deploy ล้มเหลวด้วย ENOSPC เพราะ Docker images สะสม
**บทเรียน:** รัน `docker system prune -a -f` เมื่อ disk ใกล้เต็ม (ตรวจด้วย `df -h`)

### 🐛 ลูกค้าเจอ "Unable to connect" ระหว่าง deploy
**ปัญหา:** `deploy.sh` rebuild ทั้ง su-store และ order-api พร้อมกัน ทำให้ order-api down นาน
**บทเรียน:** ใช้ `deploy-api.sh` เมื่อแก้แค่ฝั่ง server

### 🐛 Build context ใหญ่เกิน
**ปัญหา:** Docker ส่ง build context ~418MB ทั้งที่แก้ไฟล์เดียว
**สาเหตุ:** ไม่มี `.dockerignore` ที่ครอบคลุม `node_modules` และ `.next`
**สถานะ:** ยังเป็นอยู่ แต่ไม่ทำให้ผลลัพธ์ผิดพลาด

### 🐛 ตัวแปร JS ซ้ำกันภายในไฟล์ template เดียว
**ปัญหา:** declare ตัวแปรชื่อเดียวกันซ้ำ (เช่น `let allOrders` ทับ `var allOrders`) ภายใน `<script>` ก้อนเดียวกัน → SyntaxError → script ทั้งก้อนไม่รัน
**บทเรียน:** ระวังชื่อตัวแปรซ้ำภายในไฟล์ template เดียวกัน ส่วนตัวแปรข้ามไฟล์ (คนละหน้า HTML) ไม่ปนกันอยู่แล้ว เพราะโหลดเป็นคนละเอกสาร

### 🐛 SSE loop ที่ไม่เขียนอะไรเลยตอนข้อมูลไม่เปลี่ยน
**ปัญหา:** `/admin/stats-stream` เขียน socket เฉพาะตอน payload เปลี่ยน → client ปิดแท็บแล้วตรวจไม่เจอ (รู้ได้ทาง BrokenPipe ตอนเขียนเท่านั้น) thread ค้างหมุนกิน CPU จนทั้ง process ช้า
**บทเรียน:** long-lived stream ต้องเขียน heartbeat ทุก tick เสมอ และงานที่ทุก connection ใช้ร่วมกันต้องคำนวณครั้งเดียวแล้วแชร์

---

## 8. Analytics

**Daily chart:** query `DATE(created_at, '+7 hours')` เพื่อ group by วันไทย
ยกเว้นวัน `2026-05-17` (วันทดสอบ ไม่นับ)

กำไรสุทธิคำนวณจาก `PRODUCT_COST` ในโค้ด แสดงใน Analytics tab ว่า "กำไรสุทธิ (~ประมาณ)"

---

## 9. Checklist ก่อน Deploy

- [ ] Python syntax: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())"`
- [ ] pytest ผ่าน (ดู env vars ที่ต้องตั้งใน `.github/workflows/ci.yml` — import ของ `order_api.py` สร้าง data dir ตอน import)
- [ ] ถ้าแก้แค่ `server/` → ใช้ `bash deploy-api.sh`
- [ ] ถ้าแก้ Next.js → ใช้ `bash deploy.sh` (แจ้งผู้ดูแลก่อนถ้ามีลูกค้ากำลังสั่งซื้อ)
- [ ] หลัง deploy รอ ~30 วินาที แล้วรีเฟรชหน้า admin เพื่อตรวจสอบ
- [ ] commit + push ขึ้น GitHub ทุกครั้ง
