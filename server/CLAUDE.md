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
