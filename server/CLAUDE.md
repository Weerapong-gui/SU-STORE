# server/ — order-api

โหลดเมื่อทำงานกับไฟล์ใน `server/` ภาพรวมระบบและกฎที่ห้ามพลาดอยู่ใน `CLAUDE.md` ที่ราก repo

---

## โครงสร้าง backend

Python HTTP server แบบ raw `http.server` (`ThreadingHTTPServer`) ไม่ใช้ Flask/FastAPI

| ไฟล์ | หน้าที่ |
|---|---|
| `order_api.py` | entrypoint เท่านั้น: `ensure_db()`, fork worker (`ORDER_API_WORKERS`, `SO_REUSEPORT`), thread backup รายวัน |
| `fp28/config.py` | env และค่าคงที่ (`ORDER_PREFIX`, quota ขันโตก, `ORDER_STATUSES`, `STATION_BY_SLUG`, path ของ slips/slides/assets) |
| `fp28/database.py` | schema (`ensure_db`), connection pool (`open_db`), read cache สั้นๆ, `log_audit` |
| `fp28/orders.py` | ออเดอร์ FP28: validate, create, update, serialize, `mark_khantok_station_claimed` |
| `fp28/khantok.py`, `display.py`, `slips.py`, `sheets.py` | quota ขันโตก · Display 1/2 · ไฟล์สลิป + OCR · sync Google Sheets |
| `fp28/stats.py`, `products.py`, `site.py`, `backups.py` | summary/analytics/CSV · สินค้า v1 · ตั้งค่าเว็บ + รอบขาย · backup |
| `fp28/auth.py`, `timeutil.py`, `pages.py` | token ต่างๆ · เวลาไทย · โหลด HTML template |
| `fp28/web/handler.py` | `OrderRequestHandler`: helper ส่ง/อ่าน request (`send_json`, `read_json`, …), เช็ก auth และ dispatch |
| `fp28/web/routes.py` | **ตาราง route ทั้งหมด** ไล่จากบนลงล่าง route แรกที่ match ชนะ |
| `fp28/web/routes_*.py` | ฟังก์ชันต่อ route `handle_<method>_<path>(h, path, match)` แยก public / admin / claim_station / display |
| `store/` | ร้านค้า v2 (`/v2/*`) ดูหัวข้อด้านล่าง |

**เพิ่ม route ใหม่:**
1. เขียนฟังก์ชัน `handle_…` ใน `routes_*.py` ของหมวดนั้น
2. เพิ่ม `Route(...)` ใน `routes.py` ระวังลำดับ ถ้า pattern ทับกันให้ตัวที่เฉพาะกว่าอยู่ก่อน
3. ให้ handler อ่าน request → เรียกฟังก์ชันใน `fp28/*.py` → ส่ง response

**ค่าที่ test สลับได้** (`DB_PATH`, `SLIPS_DIR`, `ORDER_API_TOKEN`, quota, `trigger_ocr_async`, …) ต้องอ่านผ่านโมดูลเสมอ เช่น `config.DB_PATH` ห้าม `from fp28.config import DB_PATH` (`tests/test_module_layout.py` คุมไว้)

**`server/tests/test_fp28_routes_snapshot.py`** ยิงทุก route ของ FP28 แล้วเทียบกับ snapshot
- refactor แล้วต้องผ่านโดยไม่แก้ snapshot
- ถ้าตั้งใจเปลี่ยนพฤติกรรม รัน `UPDATE_SNAPSHOT=1 pytest …` แล้ว review diff ของ `snapshots/fp28_routes.json` ก่อน commit

> **HTML/CSS/JS อยู่ใน `server/templates/*.html`** (โหลดโดย `fp28/pages.py`) แก้หน้าไหนให้แก้ที่ template ของหน้านั้น

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

- ไฟล์ในแพ็กเกจ (ใช้ DB pool, audit และที่เก็บไฟล์จาก `fp28` ไม่ import `order_api`)
  - `store/db.py`: schema `store_*`, สินค้า, ออเดอร์, settings และ helper กลาง (`StoreError`, `clean_text`, `_as_int`)
  - `store/home.py`: หน้าแรก
  - `store/dashboard.py`: ยอดขาย
  - `store/meta.py`: ข้อมูลที่หน้าร้านและหลังร้านโหลดครั้งเดียว
  - `store/api.py`: routes `/v2/*`
- `fp28/web/handler.py` forward ทุก `path.startswith("/v2/")` ไป `store_api.handle(self, METHOD)` และ `fp28/database.ensure_db()` เรียก `store_db.ensure_store_db()` ตอนท้าย
- **ห้ามให้ v2 เขียนตาราง v1** (`orders`, `products`, `khantok_*`, `display2_*` …) — ข้อมูล FP28 ต้องอยู่เหมือนเดิม test `test_ensure_db_leaves_v1_orders_untouched` คุมไว้
  - ข้อยกเว้นเดียว: `update_settings()` เขียน `site_settings.site_closed` (สวิตช์เปิด/ปิดหน้าร้านที่ middleware ของ Next อ่าน และ admin FP28 ใช้ร่วมกัน) ค่าอื่นของร้าน v2 (บัญชีรับเงิน, ประกาศ) อยู่ใน `store_settings`
- ราคาและยอดรวมคำนวณจาก `store_variants` ฝั่ง server เสมอ client ส่งแค่ `variantId` + `quantity`
- `create_order` รับ `checkoutId` (สุ่มต่อหนึ่งตะกร้า) ถ้าซ้ำจะคืนออเดอร์เดิมแทนการสร้างใหม่ กันออเดอร์ซ้ำจากเน็ตหลุดหรือเปิดหลายแท็บ (unique index `store_orders.checkout_id`)
  - `expectedTotal` คือยอดที่ลูกค้าเห็น ถ้าราคาเปลี่ยนจนไม่ตรงจะได้ 409 ไม่ตัดสต็อก
  - ทั้งสองค่าเป็น optional client เก่าที่ไม่ส่งมายังสั่งได้
- เปลี่ยนสถานะออเดอร์ใช้ `UPDATE ... WHERE status = <สถานะที่อ่านมา>` ถ้ามีคนแก้ก่อนจะได้ 409 กันการคืนสต็อกซ้ำตอนยกเลิกพร้อมกัน
- แก้บัญชีรับเงินหรือประกาศ → audit `v2_payment_changed` (เก็บค่าเดิม -> ค่าใหม่ + ชื่อผู้แก้) / `v2_announcement_changed`
- CSV export ผ่าน `_csv_safe()` ใส่ `'` หน้าข้อความที่ขึ้นต้นด้วย `= + - @` กัน formula injection ใน Excel
- `_json_body` ปฏิเสธ body > 512KB และ route สลิปเช็ก Content-Length ก่อนอ่าน (raw `http.server` อ่านทั้งก้อนเข้า RAM)
- ตัดสต็อกใน `BEGIN IMMEDIATE` เดียวกับการสร้างออเดอร์ (`create_order`) ยกเลิกออเดอร์ = คืนสต็อก และสถานะ `cancelled` เป็นสถานะสุดท้าย
- รหัสออเดอร์ `SU{YYMM}-{seq:04d}` จากตาราง `store_counters` เริ่มนับใหม่ทุกเดือน (เวลาไทย)
- Admin auth: `POST /v2/admin/login` (username/password ใน `admin_users`) คืน token ใช้เป็น `Authorization: Claim <token>` หรือใช้ `Bearer ORDER_API_TOKEN`
- ลบสินค้า/ตัวเลือกที่เคยถูกสั่งแล้ว → ระบบเปลี่ยนเป็น archived / inactive แทนการลบ
- รอบขายต่อสินค้า: `sale_starts_at` / `sale_ends_at` (+07:00 ISO, ว่าง = ไม่จำกัด) → `saleState` = `upcoming` / `open` / `ended` และ `create_order` ปฏิเสธ (409) ถ้าไม่ใช่ `open`
- `dashboard()` (`store/dashboard.py`) นับยอดขายเฉพาะสถานะ `paid` / `ready` / `completed` ใช้ `substr(created_at,1,10)` เป็นวันไทย (เพราะ `now_iso()` เขียน offset +07:00)
- หน้าแรก (`store/home.py`): `store_settings` key `home_draft` / `home_published` (JSON `{accent, blocks}`)
  - `validate_home()` คุมชนิดบล็อก, ลิงก์ปุ่ม (`/…` หรือ `https://` เท่านั้น), รูป (`/product-images/…` เท่านั้น) และสีที่ต้อง contrast กับตัวหนังสือขาว ≥ 4.5
  - ยังไม่เคยเผยแพร่ = `DEFAULT_HOME` (หน้าแรกแบบเดิม)
  - `GET /v2/home` คืนเฉพาะที่เผยแพร่แล้ว ผ่าน `resolve_home()` ซึ่งตัดบล็อกที่ซ่อน/ว่าง และสินค้าที่ไม่ได้เปิดขายออก
- Tests: `server/tests/test_store_v2.py` (มี HTTP round-trip จริงผ่าน `OrderRequestHandler`)

---

## Clean code ฝั่ง server

กฎเต็มอยู่ใน `CLAUDE.md` หมวด 3.5 ส่วนนี้คือสิ่งที่ต้องระวังเฉพาะ Python
- `ruff check server tests` ต้องผ่าน กฎอยู่ใน `ruff.toml` ที่ราก repo และ CI ใช้ไฟล์เดียวกัน
- **`sqlite3.Row` ใช้ `"col" in row.keys()`** ห้ามแก้เป็น `"col" in row` เพราะ `in` บน Row จะเช็กค่า ไม่ใช่ชื่อคอลัมน์ บรรทัดพวกนี้มี `# noqa: SIM118` กำกับไว้
- `noqa` ทุกตัวต้องมีเหตุผลต่อท้ายในวงเล็บ
- handler อ่าน request → เรียกฟังก์ชันใน `store/*.py` → ส่ง response เท่านั้น ห้ามเขียน SQL ใน handler (ยกเว้นโค้ด FP28 เดิมที่ยังไม่ได้ย้าย)
