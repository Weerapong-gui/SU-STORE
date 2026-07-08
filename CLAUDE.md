# SU STORE — Project Guide for AI

คู่มือนี้อธิบายโครงสร้างทั้งระบบเพื่อให้ AI เข้าใจ context ก่อนแก้ไขโค้ด อ่านทั้งหมดก่อนทำการเปลี่ยนแปลงใดๆ

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

## 2. โครงสร้างไฟล์ (File Structure)

```
SU-STORE/
├── src/                          # Next.js frontend (su-store)
│   ├── app/
│   │   ├── api/                  # Next.js API routes (proxy → order-api)
│   │   │   ├── order/route.ts    # POST สร้างออเดอร์
│   │   │   ├── order/[orderId]/  # GET/PUT ออเดอร์เดี่ยว
│   │   │   └── order/[orderId]/payment/route.ts  # อัปโหลดสลิป
│   │   ├── checkout/             # หน้า checkout flow
│   │   ├── products/             # หน้าสินค้า
│   │   └── check-order/          # หน้าตรวจสอบออเดอร์ (ลูกค้า)
│   ├── components/
│   │   ├── CheckoutForm.tsx      # ฟอร์มสั่งซื้อ
│   │   └── CheckoutPaymentForm.tsx  # ฟอร์มอัปโหลดสลิป
│   ├── lib/
│   │   ├── remoteOrderApi.ts     # ฟังก์ชัน fetch ไปยัง order-api
│   │   └── orderStore.ts         # fallback state (ถ้า API ไม่ตอบสนอง)
│   ├── data/products.ts          # ข้อมูลสินค้า (static, frontend)
│   └── __tests__/                # Vitest unit tests (formatPrice, productSizing, rateLimit)
│
├── server/
│   ├── order_api.py              # ❗ ไฟล์หลักของ backend — Python HTTP server + business logic + routing
│   ├── ocr.py                    # OCR สำหรับตรวจสลิป (Tesseract) — import เข้าไปใน order_api.py
│   ├── openapi.yaml              # OpenAPI spec (serve ที่ /admin/openapi.yaml)
│   ├── google_sheets_webhook.gs # Apps Script ตัวอย่างสำหรับ Google Sheets webhook
│   ├── templates/               # ❗ HTML/CSS/JS ทุกหน้า (โหลดจากดิสก์ตอน import)
│   │   ├── admin.html           # Admin panel
│   │   ├── order_view.html      # หน้าตรวจออเดอร์ (read-only /orders)
│   │   ├── claim_station.html   # Claim Station (จุดรับของ /claim-station)
│   │   ├── display.html         # จอ Display 1 (/display1)
│   │   ├── display2.html        # จอ Display 2 คิวหยิบของ (/display2)
│   │   ├── receipt_template.svg # เทมเพลตใบเสร็จ SVG (serve ที่ /admin/receipt-template)
│   │   ├── assets/              # รูปสินค้า/โลโก้/บัตรขันโตก (png)
│   │   └── fonts/               # SukhumvitSet.ttc (serve ที่ /fonts/SukhumvitSet.ttc)
│   ├── tests/                   # pytest (test_order_api.py)
│   └── Dockerfile               # Docker image สำหรับ order-api
│
├── tests/                        # pytest ระดับ repo (test_display2.py)
├── .github/workflows/ci.yml      # CI: tsc + lint + npm test (frontend), python syntax + pytest (backend)
├── vitest.config.ts              # config สำหรับ Vitest (frontend tests)
├── deploy.sh                     # Deploy ทั้ง su-store + order-api (ลูกค้าอาจกระทบ ~1-3 นาที)
├── deploy-api.sh                 # ⚡ Deploy เฉพาะ order-api (เร็วกว่า, su-store ไม่ restart)
├── docker-compose.yml            # กำหนด services ทั้ง 2
└── Dockerfile                    # Docker image สำหรับ su-store (Next.js)
```

---

## 3. สถาปัตยกรรมเซิร์ฟเวอร์ (Server Architecture)

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

**ข้อมูล persistent บนเซิร์ฟเวอร์:**
- Database: `/home/park/SU-STORE/data/order-api/su-order-api/orders.db` (SQLite)
- Slip images: `/home/park/SU-STORE/data/order-api/su-order-api/slips/`

---

## 4. ไฟล์ที่สำคัญที่สุด: `server/order_api.py`

ไฟล์หลักของ backend ทั้งหมด:
- Python HTTP server (raw `http.server` แบบ `ThreadingHTTPServer`, ไม่ใช้ Flask/FastAPI)
- SQLite database operations (schema init, order CRUD, audit/backup, khantok, display, claim)
- Business logic (khantok eligibility, refund, OCR trigger, Google Sheets sync)
- Routing + serving หน้า HTML ทุกหน้า

> **สำคัญ:** HTML/CSS/JS **ไม่ได้ฝังเป็น `r"""..."""` ใน Python อีกต่อไป** ทุกหน้าอยู่เป็นไฟล์แยกใน `server/templates/*.html` และถูกโหลดจากดิสก์ตอน import (`server/order_api.py` ~บรรทัด 156–163):
>
> ```python
> _TEMPLATES_DIR = Path(__file__).parent / "templates"
> ADMIN_HTML        = (_TEMPLATES_DIR / "admin.html").read_text(...)
> ORDER_VIEW_HTML   = (_TEMPLATES_DIR / "order_view.html").read_text(...)
> CLAIM_STATION_HTML= (_TEMPLATES_DIR / "claim_station.html").read_text(...)
> DISPLAY_HTML      = (_TEMPLATES_DIR / "display.html").read_text(...)
> DISPLAY2_HTML     = (_TEMPLATES_DIR / "display2.html").read_text(...)
> RECEIPT_SVG       = (_TEMPLATES_DIR / "receipt_template.svg").read_bytes()
> ```
>
> ดังนั้น **แก้ HTML/CSS/JS ให้แก้ที่ไฟล์ template ของหน้านั้นๆ** ไม่ใช่ใน `order_api.py`

### โครงสร้างเชิงตรรกะภายใน `order_api.py`

(อธิบายเป็นส่วนงาน ไม่อ้างเลขบรรทัดตายตัวเพราะไฟล์ยาว ~4,400 บรรทัดและเลื่อนทุกครั้งที่แก้ — ใช้ชื่อฟังก์ชัน/คลาสค้นหาแทน)

- **Config / constants** — `ORDER_PREFIX`, KHANTOK quotas, `ORDER_STATUSES`, `STATION_BY_SLUG`, `TZ_BANGKOK`, `DEFAULT_PRODUCTS`
- **Template loading** — `_TEMPLATES_DIR` และตัวแปร `*_HTML` / `RECEIPT_SVG` (~บรรทัด 156–163)
- **DB layer** — `open_db()`, schema init (สร้างตาราง `orders`, `display2_picks`, `display1_state`, `slip_ocr_results`, `admin_users`, ฯลฯ), `log_audit()`
- **Business logic functions** — `create_order_code()`, `reserve_khantok_ticket()`, `enqueue_display2()`, `_run_ocr_for_slip()`, `sync_order_to_google_sheets()`, order CRUD
- **`class OrderRequestHandler(BaseHTTPRequestHandler)`** (ใกล้ท้ายไฟล์) — dispatcher หลัก แยกตาม HTTP method: `do_GET` / `do_POST` / `do_PUT` / `do_PATCH` / `do_DELETE` (routing แบบเทียบ `path` + regex)
- **`_ReusePortHTTPServer` + main** — bootstrap server (รองรับหลาย worker ผ่าน `SO_REUSEPORT`)

### ⚠️ ข้อควรระวังเวลาแก้ `order_api.py` / templates

1. **หน้า HTML แต่ละหน้าเป็นไฟล์แยกกัน** — `admin.html`, `order_view.html`, `claim_station.html`, `display.html`, `display2.html` ต่างมี `<script>` ของตัวเอง JavaScript ของแต่ละหน้าต้องอยู่ในไฟล์ template ของหน้านั้น อย่าเอา JS ของ admin ไปใส่หน้าอื่น (และ scope ของ `var`/`let`/`const` ไม่ปนกันข้ามไฟล์ เพราะคนละหน้า)

2. **Escape ข้อมูลลูกค้าก่อน `innerHTML`** — ในไฟล์ template ใช้ helper `esc()` / `text()` ห่อค่าที่มาจากผู้ใช้ (ชื่อ, note ฯลฯ) ก่อนต่อเป็น HTML string เสมอ กัน XSS และกัน HTML แตก; เวลา generate SVG ให้ล้อม attribute ด้วย double-quote เสมอ เช่น `fill="#4f6ef7"` (attribute ที่ไม่มี quote ทำให้ browser parse ผิด กราฟไม่ขึ้น)

3. **Timezone** — `created_at` ใน SQLite เก็บ UTC เสมอ ต้องบวก +7 ชั่วโมงทุกครั้งที่แสดงผล:
   - SQL: `DATE(created_at, '+7 hours')`
   - JS: `new Date(iso + 'Z').getTime() + 7*3600000`

4. **อย่าแตะข้อมูลออเดอร์** — ห้ามแก้ SQL queries ที่ write ข้อมูล, ห้ามเปลี่ยน schema โดยไม่ตั้งใจ

---

## 5. Business Logic สำคัญ

### สินค้า (Products)

| สินค้า | slug | ต้นทุน |
|--------|------|--------|
| FRESHER POLO SHIRT | `single` | ฿158 |
| FRESHER JACKET | `jacket` | ฿685 |
| FRESHER HEADBAND | `headband` | ฿20 |

ราคาขายจริงอยู่ใน `DEFAULT_PRODUCTS` (บรรทัด ~93) และ DB table `products`

### หมายเลขออเดอร์ (Order ID)

รูปแบบ: `{ORDER_PREFIX}{sequence:04d}{phase}` (prefix + เลขลำดับ 4 หลัก zero-pad + เลข phase ต่อท้าย)
- ตัวอย่าง: prefix `FP28`, sequence `150`, phase `1` → `FP2801501` (ดู `create_order_code()`)
- `ORDER_PREFIX` มาจาก env var (ตอนนี้คือ `FP28`)
- Phase คำนวณจาก `get_current_phase()` (ดู DB)

### บัตรขันโตก (Khantok Ticket)

**เงื่อนไขได้รับบัตร:**
1. รหัสนักศึกษาต้องขึ้นต้นด้วย `"693"` (KHANTOK_STUDENT_CODE_PREFIX)
2. ยังไม่เคยได้บัตรจากออเดอร์อื่น (student_code เดียวกัน)
3. Quota ยังเหลือ (฿100 quota: KHANTOK_QUOTA_100, ฿50 quota: KHANTOK_QUOTA_50)

**3 states ของบัตรขันโตกใน admin:**
- `khantokTicket = true` → 🎟 ได้บัตร ฿100/50 (สีเขียว)
- `khantokTicket = false` + `khantokTicketAlreadyClaimed = true` → 🎟 ได้ไปแล้ว (สีส้ม) — คนนี้ได้บัตรจาก order อื่น
- `khantokTicket = false` + `khantokTicketAlreadyClaimed = false` → ไม่ได้บัตร (สีเทา)

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
| `cancelled` / `rejected` | ยกเลิก/ปฏิเสธ (ซ่อนจากหน้าลูกค้า) |

---

## 6. Database Schema (SQLite)

ไฟล์: `/var/data/su-order-api/orders.db` (ใน Docker container)

**ตาราง `orders` — columns หลัก:**
```sql
internal_id        INTEGER PRIMARY KEY
order_code         TEXT UNIQUE        -- FP28XXXXX
status             TEXT               -- ดู ORDER_STATUSES
payment_status     TEXT
full_name          TEXT
student_code       TEXT               -- รหัสนักศึกษา (ใช้เช็ค khantok eligibility)
phone              TEXT
email              TEXT
school             TEXT
parent_phone       TEXT
product_slug       TEXT
product_name       TEXT
size               TEXT
quantity           INTEGER
total_amount       REAL
items_json         TEXT               -- JSON array สำหรับ multi-item orders
khantok_ticket     INTEGER (0/1)
khantok_ticket_value  INTEGER         -- 100 หรือ 50
khantok_ticket_already_claimed INTEGER (0/1)
khantok_ticket_claimed_at TEXT
admin_note         TEXT               -- Note ที่ admin กรอกใน Edit form
slip_path          TEXT               -- path ไปยังไฟล์สลิป
created_at         TEXT               -- UTC ISO datetime
updated_at         TEXT
round_number       INTEGER
```

**ตารางอื่น:**
- `products` — สินค้าจาก DB (override DEFAULT_PRODUCTS)
- `khantok_ticket_claims` — บัตรขันโตกที่ออกไปแล้ว (ticket_value, order_id)
- `order_audit_log` — log การเปลี่ยนแปลงออเดอร์
- `order_backups` — backup snapshots
- `settings` — config ต่างๆ (schedule, warning message ฯลฯ)

---

## 7. การ Deploy

### เลือก script ให้ถูกต้อง

| แก้ไขอะไร | ใช้ script ไหน | ผลกระทบต่อลูกค้า |
|-----------|---------------|----------------|
| เฉพาะ `server/order_api.py` (admin panel) | `bash deploy-api.sh` | น้อยมาก (order-api restart ~3-5 วินาที) |
| Next.js frontend (`src/`) | `bash deploy.sh` | su-store + order-api restart ~1-3 นาที |
| ทั้งคู่ | `bash deploy.sh` | ~1-3 นาที |

### ⚠️ อย่าใช้ `deploy.sh` ถ้าแก้แค่ `order_api.py`

เหตุผล: `deploy.sh` rebuild ทั้ง `su-store` (Next.js build ช้า) และ `order-api` พร้อมกัน ระหว่าง rebuild ลูกค้าจะเห็น "Unable to connect to the ordering service right now"

### ขั้นตอน deploy-api.sh

```
1. tar เฉพาะ ./server และ ./docker-compose.yml (~60KB)
2. scp upload ไป server
3. extract ที่ /home/park/SU-STORE/
4. docker compose up -d --build --no-deps order-api
   (rebuild order-api เท่านั้น, su-store ไม่ถูกแตะ)
```

### หลัง deploy ต้อง restart cloudflared ด้วยมั้ย?

`deploy-api.sh` **ไม่** restart cloudflared → ไม่มี downtime ของ tunnel
`deploy.sh` **restart** `cloudflared` (tunnel ของ `sumfu.xyz`) → tunnel ดับ ~10-15 วินาที แต่ **ไม่กระทบ `sumfu.store`** เพราะเป็นคนละ tunnel (`cloudflared-store`)

### SSH เข้าเซิร์ฟเวอร์โดยตรง

```bash
sshpass -p <PASSWORD> ssh -o StrictHostKeyChecking=no park@arch.sumfu.xyz
```

### คำสั่ง Docker ที่ใช้บ่อย

```bash
docker ps                                    # ดู containers ที่รัน
docker logs --tail=100 su-order-api          # ดู log ของ order-api
docker logs --tail=100 su-store              # ดู log ของ Next.js
docker exec su-store wget -qO- http://order-api:10000/health  # ทดสอบ connectivity
```

---

## 8. Environment Variables

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
| `GOOGLE_SHEETS_WEBHOOK_URL` | order-api | optional |

---

## 9. Admin Panel (`admin.sumfu.xyz/admin`)

Admin panel คือ HTML หน้าเดียว serve จาก `order-api` ที่ path `/admin`

### Tabs ของ Admin:
- **Orders** — จัดการออเดอร์ทั้งหมด (เปลี่ยนสถานะ, ดูสลิป, แก้ไข, export CSV)
- **Analytics** — สรุปยอด, กราฟรายวัน, กำไรสุทธิ (~ประมาณ)
- **Products** — จัดการสินค้า
- **Settings** — ตั้งค่า schedule, warning message
- **Audit Log** — ประวัติการเปลี่ยนแปลง
- **Backup** — backup/restore ออเดอร์

### การ Authenticate:
- ใช้ `API Token` ที่กรอกใน navbar (เก็บใน `sessionStorage`)
- Token ต้องตรงกับ `ORDER_API_TOKEN` env var

### Dark Mode:
- Follow ระบบ (CSS `prefers-color-scheme`) โดย default
- Override ได้ด้วยปุ่ม toggle บน navbar (เก็บใน `localStorage` key `suStoreTheme`)

---

## 9.1 หน้าจอ/ฟีเจอร์อื่นๆ ของ operator (นอกเหนือจาก Admin Panel)

order-api ยัง serve หน้าจอและฟีเจอร์สำคัญอีกหลายตัวที่ไม่ได้อยู่ในแท็บของ admin ทั้งหมดอยู่ในไฟล์ template แยกกัน (ดู §4)

### Claim Station — จุดรับของ (`/claim-station`, `claim_station.html`)

หน้าสำหรับ staff ที่จุดแจกของ แยกจาก admin panel:
- **Auth คนละแบบกับ admin** — ใช้ `claim_token` รายบุคคลในตาราง `admin_users` ส่งผ่าน header `Authorization: Claim <token>` (ตรวจด้วย `_has_claim_station_authorization()` / `_get_claim_station_user()`) ล็อกอินที่ `/claim-station/login`
- ค้นหาออเดอร์ (ตาม student_code / phone / ชื่อ), ดูสลิป, มาร์คว่ารับของแล้ว (`PATCH /claim-station/orders/{code}/received`), แก้ชื่อผู้รับ, อัปโหลดสลิปเพิ่ม, พิมพ์ใบเสร็จ
- เมื่อมาร์ค received จะ trigger การ enqueue ไปยัง Display 2 และ (สำหรับ headband-only) ปิด refund ให้อัตโนมัติ

### Display screens — จอแสดงผลที่งาน

- **Display 1** (`/display1`, `display.html`) — จอที่จุดรับ ควบคุมสถานะโดย staff ผ่าน `POST /display1/update` (เก็บ state ต่อ username ในตาราง `display1_state`) รองรับ slideshow (`/display1/slides`, อัปโหลด/ลบสไลด์ได้)
- **Display 2** (`/display2`, `display2.html`) — จอคิว "หยิบของ" แยกตามสถานี (polo / jacket / headband / khantok ตาม `STATION_BY_SLUG`) เมื่อออเดอร์ถูกยืนยันที่ claim station ฟังก์ชัน `enqueue_display2()` จะแตกออเดอร์เป็น 1 แถวต่อ 1 ชิ้นในตาราง `display2_picks` (idempotent ต่อ `order_internal_id`+`item_index`) staff กด "หยิบแล้ว" ผ่าน `POST /display2/pick`; asset รูปของแต่ละสถานีเก็บใน `display2_assets`

### Refund flow — การคืนเงิน

- Statuses `refund` / `refunded` (payment_status `refund_pending` / `refunded`) เพิ่มเข้ามาใน `ORDER_STATUSES`
- **Headband-only order คืนเงินอัตโนมัติ** — ออเดอร์ที่มีแต่ `fresh-headband` จะถูกตั้ง `status='refund'` ตั้งแต่ตอนสร้าง (log audit `auto_refund_headband`) และปิดยอดเป็น `refunded` เมื่อ claim station มาร์ค received (audit `refund_completed`)
- ออเดอร์สถานะ refund/refunded ถูก **กันออกจาก** ยอดขาย, quota, และ analytics แต่ยังนับแยกใน `refundedAmount` / `refundedCount`

### OCR ตรวจสลิป (`server/ocr.py` + ตาราง `slip_ocr_results`)

- ตอนลูกค้าอัปโหลดสลิป order-api จะเรียก `_run_ocr_for_slip()` **ใน background thread** ซึ่ง `import ocr` แล้วเรียก `ocr.extract_slip_data()` (Tesseract) ดึง amount / date / sender / bank / ref_number
- ผลเก็บในตาราง `slip_ocr_results` และตรวจ **สลิปซ้ำ** จาก `ref_number` ที่ชนกับออเดอร์อื่น; สลิปที่เป็น PDF จะข้าม OCR (status `skipped`)
- admin เห็นผล OCR ประกอบการยืนยันการชำระเงิน

### Receipt / ใบเสร็จ SVG (`receipt_template.svg` + `SukhumvitSet.ttc`)

- เทมเพลตใบเสร็จเป็น SVG ที่ serve ที่ `GET /admin/receipt-template` (ค่าคงที่ `RECEIPT_SVG`) และฟอนต์ไทย `SukhumvitSet.ttc` serve ที่ `/fonts/SukhumvitSet.ttc`
- ทั้ง admin panel และ claim station เติมข้อมูลลง SVG ฝั่ง client แล้วสั่ง `window.print()` เพื่อพิมพ์ใบเสร็จ (พิมพ์ทีละใบหรือหลายใบพร้อมกันได้)

---

## 10. Pitfalls ที่เคยเจอ (เรียนรู้จากประสบการณ์จริง)

### 🐛 JavaScript อยู่ผิดไฟล์ template
**ปัญหา:** ใส่ JS ของหน้าหนึ่ง (เช่น `initTheme` ของ admin) ไปในไฟล์ template อีกหน้า → ฟีเจอร์ใช้ไม่ได้
**บทเรียน:** แต่ละหน้าคือไฟล์ `templates/*.html` คนละไฟล์และมี `<script>` ของตัวเอง แก้ JS ให้แก้ในไฟล์ template ของหน้านั้น (`admin.html` / `order_view.html` / `claim_station.html` / `display.html` / `display2.html`) ไม่ใช่ในไฟล์อื่นหรือใน `order_api.py`

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
**บทเรียน:** ใช้ `deploy-api.sh` เมื่อแก้แค่ admin panel

### 🐛 Build context ใหญ่เกิน
**ปัญหา:** Docker ส่ง build context ~418MB ทั้งที่แก้ไฟล์เดียว
**สาเหตุ:** ไม่มี `.dockerignore` ที่ครอบคลุม `node_modules` และ `.next`
**สถานะ:** ยังเป็นอยู่ แต่ไม่ทำให้ผลลัพธ์ผิดพลาด

### 🐛 ตัวแปร JS ซ้ำกันภายในไฟล์ template เดียว
**ปัญหา:** declare ตัวแปรชื่อเดียวกันซ้ำ (เช่น `let allOrders` ทับ `var allOrders`) ภายใน `<script>` ก้อนเดียวกัน → SyntaxError → script ทั้งก้อนไม่รัน
**บทเรียน:** ระวังชื่อตัวแปรซ้ำภายในไฟล์ template เดียวกัน ส่วนตัวแปรข้ามไฟล์ (คนละหน้า HTML) ไม่ปนกันอยู่แล้ว เพราะโหลดเป็นคนละเอกสาร

---

## 11. Analytics — การคำนวณกำไร

```python
PRODUCT_COST = {"single": 158, "jacket": 685, "headband": 20}
# กำไรสุทธิ = revenue - Σ(จำนวนสินค้าแต่ละชนิด × ต้นทุน)
# แสดงใน Analytics tab ว่า "กำไรสุทธิ (~ประมาณ)"
```

**Daily chart:** query `DATE(created_at, '+7 hours')` เพื่อ group by วันไทย
ยกเว้นวัน `2026-05-17` (วันทดสอบ ไม่นับ)

---

## 12. Checklist ก่อน Deploy

- [ ] Python syntax: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())"`
- [ ] ถ้าแก้แค่ `order_api.py` → ใช้ `bash deploy-api.sh`
- [ ] ถ้าแก้ Next.js → ใช้ `bash deploy.sh` (แจ้งผู้ดูแลก่อนถ้ามีลูกค้ากำลังสั่งซื้อ)
- [ ] หลัง deploy รอ ~30 วินาที แล้วรีเฟรชหน้า admin เพื่อตรวจสอบ
- [ ] commit + push ขึ้น GitHub ทุกครั้ง
