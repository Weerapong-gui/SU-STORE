# server/ — order-api

โหลดเมื่อทำงานกับไฟล์ใน `server/` ภาพรวมระบบและกฎที่ห้ามพลาดอยู่ใน `CLAUDE.md` ที่ราก repo

---

## `order_api.py` — ไฟล์หลักของ backend

Python HTTP server แบบ raw `http.server` (`ThreadingHTTPServer`) ไม่ใช้ Flask/FastAPI รวม DB layer, business logic, routing และการ serve หน้า HTML ไว้ในไฟล์เดียว

> **สำคัญ:** HTML/CSS/JS **ไม่ได้ฝังเป็น `r"""..."""` ใน Python** ทุกหน้าอยู่เป็นไฟล์แยกใน `server/templates/*.html` และถูกโหลดจากดิสก์ตอน import:
>
> ```python
> _TEMPLATES_DIR = Path(__file__).parent / "templates"
> ADMIN_HTML        = (_TEMPLATES_DIR / "admin.html").read_text(...)
> CLAIM_STATION_HTML= (_TEMPLATES_DIR / "claim_station.html").read_text(...)
> RECEIPT_SVG       = (_TEMPLATES_DIR / "receipt_template.svg").read_bytes()
> ```
>
> ดังนั้น **แก้ HTML/CSS/JS ให้แก้ที่ไฟล์ template ของหน้านั้นๆ** ไม่ใช่ใน `order_api.py`

### หาโค้ดยังไง

ไฟล์ยาว ~4,500 บรรทัดและเลื่อนทุกครั้งที่แก้ — ค้นด้วยชื่อฟังก์ชัน/คลาส อย่าอ้างเลขบรรทัด

- **Config / constants** — `ORDER_PREFIX`, KHANTOK quotas, `ORDER_STATUSES`, `STATION_BY_SLUG`, `TZ_BANGKOK`, `DEFAULT_PRODUCTS`
- **DB layer** — `open_db()` (connection pool + WAL), schema init, `log_audit()`
- **Caching** — `cache_get`/`cache_set` (TTL สั้น), `create_orders_summary_cached()`, `get_stats_snapshot()`
- **Business logic** — `create_order_code()`, `reserve_khantok_ticket()`, `mark_khantok_station_claimed()`, `enqueue_display2()`, `_run_ocr_for_slip()`, `sync_order_to_google_sheets()`
- **`class OrderRequestHandler(BaseHTTPRequestHandler)`** (ใกล้ท้ายไฟล์) — dispatcher หลัก แยกตาม HTTP method: `do_GET` / `do_POST` / `do_PUT` / `do_PATCH` / `do_DELETE` (เทียบ `path` + regex)
- **`_ReusePortHTTPServer` + main** — bootstrap (รองรับหลาย worker ผ่าน `SO_REUSEPORT`, จำนวนจาก `ORDER_API_WORKERS`)

### ข้อควรระวัง

1. **แต่ละหน้า HTML เป็นไฟล์แยก** — `admin.html`, `order_view.html`, `claim_station.html`, `display.html`, `display2.html`, `display3.html` ต่างมี `<script>` ของตัวเอง JS ของหน้าไหนต้องอยู่ในไฟล์ของหน้านั้น (scope ไม่ปนกันข้ามไฟล์อยู่แล้วเพราะคนละเอกสาร)

2. **Escape ข้อมูลลูกค้าก่อน `innerHTML`** — ใช้ helper `esc()` / `text()` ห่อค่าที่มาจากผู้ใช้ (ชื่อ, note) เสมอ; เวลา generate SVG ต้องล้อม attribute ด้วย double-quote

3. **งานที่วนซ้ำในหน้า long-lived** (SSE, endpoint ที่จอ poll) ต้องคำนวณครั้งเดียวแล้วแชร์ ไม่ใช่ query ต่อ connection ต่อ tick

---

## หน้าจอ/ฟีเจอร์ของ operator

### Claim Station — จุดรับของ (`/claim-station`, `claim_station.html`)

- **Auth คนละแบบกับ admin** — ใช้ `claim_token` รายบุคคลในตาราง `admin_users` ส่งผ่าน header `Authorization: Claim <token>` (ตรวจด้วย `_has_claim_station_authorization()` / `_get_claim_station_user()`) ล็อกอินที่ `/claim-station/login`
- ค้นหาออเดอร์ (student_code / phone / ชื่อ), ดูสลิป, มาร์ครับของแล้ว (`PATCH /claim-station/orders/{code}/received`), แก้ชื่อผู้รับ, อัปโหลดสลิปเพิ่ม, พิมพ์ใบเสร็จ, รับบัตรขันโตกแยก (`khantok_station_claimed_at`)
- มาร์ค received → enqueue Display 2 และ (headband-only) ปิด refund อัตโนมัติ

### Display screens

- **Display 1** (`/display1`, `display.html`) — จอที่จุดรับ staff คุมผ่าน `POST /display1/update` (state ต่อ username ในตาราง `display1_state`) รองรับ slideshow (`/display1/slides`)
- **Display 2** (`/display2`, `display2.html`) — จอคิว "หยิบของ" แยกตามสถานี (polo / jacket / headband / khantok ตาม `STATION_BY_SLUG`) `enqueue_display2()` แตกออเดอร์เป็น 1 แถวต่อ 1 ชิ้นใน `display2_picks` (idempotent ต่อ `order_internal_id`+`item_index`) staff กด "หยิบแล้ว" ผ่าน `POST /display2/pick`
- **Display 3** (`/dis3`, `display3.html`) — จอยอดขายสาธารณะ poll `/dis3/data` ทุก 3 วินาที

### Refund flow

- Statuses `refund` / `refunded` (payment_status `refund_pending` / `refunded`)
- **Headband-only order คืนเงินอัตโนมัติ** — ออเดอร์ที่มีแต่ `fresh-headband` ถูกตั้ง `status='refund'` ตั้งแต่ตอนสร้าง (audit `auto_refund_headband`) และปิดเป็น `refunded` เมื่อ claim station มาร์ค received (audit `refund_completed`)
- refund/refunded ถูก **กันออกจาก** ยอดขาย, quota, analytics แต่ยังนับแยกใน `refundedAmount` / `refundedCount`

### OCR ตรวจสลิป (`ocr.py` + ตาราง `slip_ocr_results`)

- ตอนอัปโหลดสลิป order-api เรียก `_run_ocr_for_slip()` **ใน background thread** → `ocr.extract_slip_data()` (Tesseract) ดึง amount / date / sender / bank / ref_number
- ตรวจ **สลิปซ้ำ** จาก `ref_number` ที่ชนกับออเดอร์อื่น; สลิป PDF ข้าม OCR (status `skipped`)

### Receipt SVG

- เทมเพลตใบเสร็จ serve ที่ `GET /admin/receipt-template` (ค่าคงที่ `RECEIPT_SVG`) ฟอนต์ไทย `SukhumvitSet.ttc` ที่ `/fonts/SukhumvitSet.ttc`
- admin และ claim station เติมข้อมูลลง SVG ฝั่ง client แล้ว `window.print()`

---

## Store v2 (`server/store/`) — ร้านค้าหลายสินค้า

ระบบขายของใหม่ แยกจาก FP28 แต่อยู่ใน `orders.db` ไฟล์เดียวกัน

- `store/db.py` — schema `store_*` + business logic (ไม่ import `order_api`), `store/api.py` — routes `/v2/*`
- `order_api.py` แค่ forward ทุก `path.startswith("/v2/")` ไป `store_api.handle(self, METHOD, sys.modules[__name__])` และเรียก `store_db.ensure_store_db()` ท้าย `ensure_db()`
- **ห้ามให้ v2 เขียนตาราง v1** (`orders`, `products`, `khantok_*`, `display2_*` …) — ข้อมูล FP28 ต้องอยู่เหมือนเดิม test `test_ensure_db_leaves_v1_orders_untouched` คุมไว้
  - ข้อยกเว้นเดียว: `update_settings()` เขียน `site_settings.site_closed` (สวิตช์เปิด/ปิดหน้าร้านที่ middleware ของ Next อ่าน และ admin FP28 ใช้ร่วมกัน) ค่าอื่นของร้าน v2 (บัญชีรับเงิน, ประกาศ) อยู่ใน `store_settings`
- ราคาและยอดรวมคำนวณจาก `store_variants` ฝั่ง server เสมอ client ส่งแค่ `variantId` + `quantity`
- ตัดสต็อกใน `BEGIN IMMEDIATE` เดียวกับการสร้างออเดอร์ (`create_order`) ยกเลิกออเดอร์ = คืนสต็อก และสถานะ `cancelled` เป็นสถานะสุดท้าย
- รหัสออเดอร์ `SU{YYMM}-{seq:04d}` จากตาราง `store_counters` เริ่มนับใหม่ทุกเดือน (เวลาไทย)
- Admin auth: `POST /v2/admin/login` (username/password ใน `admin_users`) คืน token ใช้เป็น `Authorization: Claim <token>` หรือใช้ `Bearer ORDER_API_TOKEN`
- ลบสินค้า/ตัวเลือกที่เคยถูกสั่งแล้ว → ระบบเปลี่ยนเป็น archived / inactive แทนการลบ
- รอบขายต่อสินค้า: `sale_starts_at` / `sale_ends_at` (+07:00 ISO, ว่าง = ไม่จำกัด) → `saleState` = `upcoming` / `open` / `ended` และ `create_order` ปฏิเสธ (409) ถ้าไม่ใช่ `open`
- `dashboard()` นับยอดขายเฉพาะสถานะ `paid` / `ready` / `completed` ใช้ `substr(created_at,1,10)` เป็นวันไทย (เพราะ `now_iso()` เขียน offset +07:00)
- หน้าแรก: `store_settings` key `home_draft` / `home_published` (JSON `{accent, blocks}`)
  - `validate_home()` คุมชนิดบล็อก, ลิงก์ปุ่ม (`/…` หรือ `https://` เท่านั้น), รูป (`/product-images/…` เท่านั้น) และสีที่ต้อง contrast กับตัวหนังสือขาว ≥ 4.5
  - ยังไม่เคยเผยแพร่ = `DEFAULT_HOME` (หน้าแรกแบบเดิม)
  - `GET /v2/home` คืนเฉพาะที่เผยแพร่แล้ว ผ่าน `resolve_home()` ซึ่งตัดบล็อกที่ซ่อน/ว่าง และสินค้าที่ไม่ได้เปิดขายออก
- Tests: `server/tests/test_store_v2.py` (มี HTTP round-trip จริงผ่าน `OrderRequestHandler`)
