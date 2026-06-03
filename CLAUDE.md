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
│   └── data/products.ts          # ข้อมูลสินค้า (static, frontend)
│
├── server/
│   ├── order_api.py              # ❗ ไฟล์หลักทั้งหมด — Python HTTP server + Admin HTML/CSS/JS
│   ├── ocr.py                    # OCR สำหรับตรวจสลิป (Tesseract)
│   └── Dockerfile                # Docker image สำหรับ order-api
│
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

**เซิร์ฟเวอร์จริง:** `park@arch.sumfu.xyz` (password: `23007`)

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

ไฟล์เดียวที่ทำหน้าที่ทั้งหมดของ backend:
- Python HTTP server (raw `http.server`, ไม่ใช้ Flask/FastAPI)
- Admin panel HTML/CSS/JS (embed เป็น string `ADMIN_HTML = r"""..."""`)
- Order view HTML สำหรับลูกค้า (`ORDER_VIEW_HTML = r"""..."""`)
- SQLite database operations
- Slip image serving

### โครงสร้างภายใน `order_api.py`

```
บรรทัด 1–34      imports, constants setup
บรรทัด 35–92     config (ORDER_PREFIX, KHANTOK quotas, statuses, schedule)
บรรทัด 93–133    DEFAULT_PRODUCTS (fallback สินค้าถ้า DB ว่าง)
บรรทัด 136–2284  ADMIN_HTML = r"""..."""
  ├── CSS :root variables (light/dark theme)
  ├── HTML structure (header, tabs, tables, modals)
  └── <script> block (บรรทัด 771–2284) — JavaScript ทั้งหมดของ admin
        ├── Token management
        ├── Tab switching
        ├── Orders tab (renderOrders, renderOrderStats, loadOrders)
        ├── Analytics tab (loadAnalytics, renderDailyChart)
        ├── Products, Settings, Audit, Backup tabs
        └── Dark mode toggle (initTheme IIFE — ต้องอยู่ใน ADMIN_HTML ไม่ใช่ ORDER_VIEW_HTML)
บรรทัด 2289–2767  ORDER_VIEW_HTML = r"""...""" (หน้าตรวจออเดอร์แยก)
บรรทัด 2800+      Python functions: DB init, order CRUD, API handlers
บรรทัด 4800+      HTTP request dispatcher (routing)
```

### ⚠️ ข้อควรระวังเวลาแก้ `order_api.py`

1. **สองหน้า HTML แยกกัน** — `ADMIN_HTML` และ `ORDER_VIEW_HTML` เป็น string คนละก้อน JavaScript ของ admin ต้องอยู่ใน `ADMIN_HTML` เท่านั้น อย่าเอาไปใส่ใน `ORDER_VIEW_HTML`

2. **SVG/HTML attribute ใน JavaScript string** — ใช้ single-quote JS string + double-quote HTML attributes:
   ```javascript
   '<rect x="' + x + '" width="' + w + '" fill="#4f6ef7"/>'
   ```
   อย่าใช้ `\"` (backslash-quote) เพราะ Python raw string จะทำให้เกิด literal backslash

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

รูปแบบ: `{ORDER_PREFIX}{sequence:04d}{phase}`
- ตัวอย่าง: `FP28150 1` = prefix `FP28`, sequence `1501`, phase `1`  
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
sshpass -p 23007 ssh -o StrictHostKeyChecking=no park@arch.sumfu.xyz
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

## 10. Pitfalls ที่เคยเจอ (เรียนรู้จากประสบการณ์จริง)

### 🐛 JavaScript อยู่ผิด HTML block
**ปัญหา:** `initTheme` IIFE อยู่ใน `ORDER_VIEW_HTML` แทน `ADMIN_HTML` → toggle ใช้ไม่ได้
**บทเรียน:** ตรวจสอบว่าโค้ดอยู่ในก้อน `r"""..."""` ที่ถูกต้องเสมอ

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

### 🐛 `let` ซ้ำกับ `var` ข้าม script block
**ปัญหา:** ถ้า declare `let allOrders` ใน script block 2 ทับกับ `var allOrders` ใน script block 1 → SyntaxError → script ทั้งก้อนไม่รัน
**บทเรียน:** `ADMIN_HTML` และ `ORDER_VIEW_HTML` มีแต่ละ script block ของตัวเอง ไม่เกี่ยวกัน (คนละหน้า HTML)

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
