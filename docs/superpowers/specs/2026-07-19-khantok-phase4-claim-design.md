# Phase-4 Khantok Ticket Claim at Claim Station — Design

วันที่: 2026-07-19 · Branch: `fix/khantok-station`

## ปัญหา / เป้าหมาย

ปัจจุบันคิวบัตรขันโตกขึ้นจอ KHANTOK STATION อัตโนมัติเมื่อ staff มาร์คออเดอร์เป็น
received (ผ่าน `enqueue_display2()` ใน `PATCH /claim-station/orders/{code}/received`)
สำหรับ **ออเดอร์ phase 4** ต้องการแยกการรับบัตรขันโตกออกจากการรับสินค้า:

- Staff ค้นหาออเดอร์ phase 4 ที่ได้บัตรขันโตก → เห็นแผงรับบัตรขันโตกพร้อมปุ่มแยก
- กดปุ่ม "รับบัตรขันโตก" → บัตรของออเดอร์นั้นเข้าสถานะ "รับแล้ว" → ส่งคิวไปจอ
  KHANTOK STATION ตามกลไกเดิม
- จำนวนบัตร (quota) **ต้องไม่ลด** จากการรับหน้างาน
- ปุ่ม "ยืนยันรับสินค้า" เดิมทำงานแยกกัน คนละปุ่ม กดสลับลำดับกันได้
- Phase 1–3 และออเดอร์ที่ไม่มีบัตร: พฤติกรรมเดิมทุกอย่าง

## การตัดสินใจหลัก

| เรื่อง | ตัดสินใจ |
|--------|----------|
| สถานะ "รับแล้ว" เก็บที่ไหน | คอลัมน์ใหม่ `orders.khantok_station_claimed_at` (TEXT, NULL) — เพิ่มด้วย additive migration ตาม pattern `PRAGMA table_info` เดิม |
| ปุ่มรับบัตร vs ปุ่มรับสินค้า | แยกกันคนละปุ่ม สถานะออเดอร์ไม่เปลี่ยนจากการรับบัตร |
| คิว khantok ของ phase 4 | ขึ้นจอเฉพาะตอนกดปุ่ม "รับบัตรขันโตก" เท่านั้น — ปุ่มรับสินค้าปกติจะ **ข้าม** แถว khantok |
| Quota | endpoint ใหม่ไม่เขียนตาราง `khantok_ticket_claims` เลย → quota ไม่ขยับ |
| ทางเลือกที่ตัดทิ้ง | order status ใหม่ (ปนสถานะบัตรกับออเดอร์ กระทบ analytics/filter), ตารางใหม่ (เกินจำเป็น), **reuse `khantok_ticket_claimed_at` (ตัดทิ้งภายหลัง — คอลัมน์นั้นถูก `reserve_khantok_ticket()` set เป็น timestamp ตอนออกบัตร/กิน quota ตั้งแต่สร้างออเดอร์ ไม่ได้แปลว่ารับบัตรที่หน้างาน)** |

## การเปลี่ยนแปลง

### 1. Backend — `server/order_api.py`

**Migration + serializer**
- `PRAGMA table_info(orders)` block: เพิ่ม `khantok_station_claimed_at TEXT` ถ้ายังไม่มี
- `serialize_order()`: เพิ่ม field `khantokStationClaimedAt` (guard ด้วย `in row_keys` ตาม pattern เดิม)

**Helper ใหม่ `enqueue_display2_khantok(connection, order_row, claim_user)`**
แยกบล็อก khantok (ส่วน `has_kt` / `item_index = -1`) ออกจาก `enqueue_display2()`
เป็นฟังก์ชันของตัวเอง แล้วให้ `enqueue_display2()` เรียกใช้ helper นี้
พฤติกรรม idempotent เดิมคงไว้ (unique ต่อ `order_internal_id` + `item_index = -1`)

**แก้ `enqueue_display2()`**
เรียก `enqueue_display2_khantok()` เฉพาะเมื่อ `round_number != 4`
(phase 4 รอปุ่มรับบัตรเท่านั้น; แถวสินค้า polo/jacket/headband enqueue ตามเดิมทุก phase)

**Core function ใหม่ `mark_khantok_station_claimed(connection, order_code, claim_user)`**
คืน `(http_status, body)` เพื่อให้ทดสอบได้โดยไม่ต้องยิง HTTP — guards ตามลำดับ:
  1. ไม่พบออเดอร์ → 404
  2. `khantok_ticket != 1` → 400 "ออเดอร์นี้ไม่มีบัตรขันโตก"
  3. สถานะอยู่ใน `pending_payment / waiting_confirm / cancelled / rejected` → 400
  4. `khantok_station_claimed_at` มีค่าแล้ว → 409 "รับบัตรขันโตกไปแล้ว" (+ ส่ง `claimedAt` เดิมกลับ)
สำเร็จ: set `khantok_station_claimed_at = now_iso()`,
`log_audit(..., "khantok_claimed", f"claimed by {user}")`,
เรียก `enqueue_display2_khantok()` → ตอบ 200 `{"order": serialize_order(...)}`
**ห้าม** แตะตาราง `khantok_ticket_claims`

**Endpoint ใหม่ `PATCH /claim-station/orders/{code}/khantok-claimed`**
- Auth: header `Authorization: Claim <token>` (เหมือน `/received`)
- Handler บาง: อ่าน payload (`claimedBy`), เรียก core function, commit เมื่อ 200,
  `cache_invalidate(f"cs_order:{code}")`, ส่ง response ตาม status ที่ core คืน

### 2. Claim Station — `server/templates/claim_station.html`

บน order card เมื่อ `order.roundNumber == 4 && order.khantokTicket`:

- ยังไม่รับ (`khantokStationClaimedAt` ว่าง): แผงเด่น "🎟 บัตรขันโตก ฿{value} — ยังไม่ได้รับ"
  พร้อมปุ่ม **"รับบัตรขันโตก"** — แยกจากปุ่ม "ยืนยันรับสินค้า" ชัดเจน
- กดปุ่ม → `PATCH /claim-station/orders/{code}/khantok-claimed` → สำเร็จ:
  อัปเดต card เป็น state เขียว "รับบัตรขันโตกแล้ว เมื่อ HH:MM", beep success
- 409 → dialog เตือน "รับบัตรไปแล้ว" (pattern เดียวกับรับสินค้าซ้ำ) แล้ว refresh card
- Badge "รับแล้ว" เดิม (ตาม `khantokTicketClaimedAt` = ตอนออกบัตร) คงไว้สำหรับ phase อื่น
- Phase อื่น / ไม่มีบัตร: หน้าตาเดิมทุกประการ

### 3. Admin — `server/templates/admin.html` + `update_order()`

- Edit form ส่วน KHANTOK TICKET เพิ่ม toggle ที่สาม: **"รับแล้ว (station)"**
  (`#oe_khantokStationClaimed`) — checked เมื่อ `khantokStationClaimedAt` มีค่า
- Save ส่ง field ใหม่ `khantokStationClaimed: bool` →
  `update_order_fields()`: `true` = set `khantok_station_claimed_at = now_iso()` เฉพาะเมื่อ
  ยังว่าง (ไม่ทับ timestamp เดิม), `false` = ล้างเป็น `NULL`
- การ set/ล้างนี้ **ไม่เขียน** `khantok_ticket_claims` (แยกขาดจาก logic Has ticket /
  Already claimed เดิมที่ sync claims เพื่อ quota)

### 4. Tests

**`tests/test_display2.py` (harness in-memory เดิม, เพิ่มคอลัมน์ khantok/round ใน schema จำลอง):**
1. Phase 4 + `enqueue_display2()` → **ไม่มี** แถว khantok (แถวสินค้ามีครบ)
2. Phase ≠ 4 + มีบัตร → มีแถว khantok เหมือนเดิม (กัน regression)
3. `enqueue_display2_khantok()` ตรง: insert แถว station=`khantok`, idempotent,
   คืน 0 เมื่อไม่มีบัตร

**`tests/test_khantok_claim.py` (ใหม่ — DB จริงผ่าน `ensure_db()` ใน tmp_path):**
4. `mark_khantok_station_claimed` สำเร็จ → 200, `khantok_station_claimed_at` ถูก set,
   มีแถว `display2_picks` station=`khantok`, `COUNT(khantok_ticket_claims)` ไม่เปลี่ยน
5. เรียกซ้ำ → 409
6. ออเดอร์ไม่มีบัตร → 400; สถานะ `pending_payment` → 400; ไม่พบออเดอร์ → 404
7. `update_order_fields` + `khantokStationClaimed` true/false → set/ล้าง, true ซ้ำ
   ไม่ทับ timestamp เดิม, quota นิ่ง

## ผลลัพธ์ที่คาดหวัง

- Staff phase 4: ค้นออเดอร์ → เห็นแผงบัตร → กดรับบัตร → คิวขึ้นจอ KHANTOK STATION
  ทันที → รับสินค้าแยกอิสระ
- จอ Display 2 / KHANTOK STATION: ไม่ต้องแก้โค้ด (อ่าน `display2_picks` เดิม)
- Admin: เห็น/แก้สถานะรับบัตรได้จาก Edit form; quota บัตรไม่ขยับจากการรับหน้างาน
- Deploy ด้วย `bash deploy-api.sh` (แก้เฉพาะฝั่ง order-api + templates)
