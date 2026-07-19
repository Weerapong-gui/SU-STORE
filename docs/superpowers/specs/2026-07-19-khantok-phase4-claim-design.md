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
| สถานะ "รับแล้ว" เก็บที่ไหน | ใช้คอลัมน์เดิม `orders.khantok_ticket_claimed_at` (มีอยู่แล้ว ไม่แก้ schema) |
| ปุ่มรับบัตร vs ปุ่มรับสินค้า | แยกกันคนละปุ่ม สถานะออเดอร์ไม่เปลี่ยนจากการรับบัตร |
| คิว khantok ของ phase 4 | ขึ้นจอเฉพาะตอนกดปุ่ม "รับบัตรขันโตก" เท่านั้น — ปุ่มรับสินค้าปกติจะ **ข้าม** แถว khantok |
| Quota | endpoint ใหม่ไม่เขียนตาราง `khantok_ticket_claims` เลย → quota ไม่ขยับ |
| ทางเลือกที่ตัดทิ้ง | order status ใหม่ (ปนสถานะบัตรกับออเดอร์ กระทบ analytics/filter), ตารางใหม่ (ซ้ำซ้อนกับคอลัมน์เดิม) |

## การเปลี่ยนแปลง

### 1. Backend — `server/order_api.py`

**Helper ใหม่ `enqueue_display2_khantok(connection, order_row, claim_user)`**
แยกบล็อก khantok (ส่วน `has_kt` / `item_index = -1`) ออกจาก `enqueue_display2()`
เป็นฟังก์ชันของตัวเอง แล้วให้ `enqueue_display2()` เรียกใช้ helper นี้
พฤติกรรม idempotent เดิมคงไว้ (unique ต่อ `order_internal_id` + `item_index = -1`)

**แก้ `enqueue_display2()`**
เรียก `enqueue_display2_khantok()` เฉพาะเมื่อ `round_number != 4`
(phase 4 รอปุ่มรับบัตรเท่านั้น; แถวสินค้า polo/jacket/headband enqueue ตามเดิมทุก phase)

**Endpoint ใหม่ `PATCH /claim-station/orders/{code}/khantok-claimed`**
- Auth: header `Authorization: Claim <token>` (เหมือน `/received`)
- Guards ตามลำดับ:
  1. ไม่พบออเดอร์ → 404
  2. `khantok_ticket != 1` → 400 "ออเดอร์นี้ไม่มีบัตรขันโตก"
  3. สถานะอยู่ใน `pending_payment / waiting_confirm / cancelled / rejected` → 400
  4. `khantok_ticket_claimed_at` มีค่าแล้ว → 409 "รับบัตรขันโตกไปแล้ว" (+ ส่ง `claimedAt` เดิมกลับ)
- ทำงาน (transaction เดียว): set `khantok_ticket_claimed_at = now_iso()`,
  `log_audit(..., "khantok_claimed", f"claimed by {user}")`,
  เรียก `enqueue_display2_khantok()`, `cache_invalidate(f"cs_order:{code}")`
- ตอบ 200 `{"order": serialize_order(...)}`
- **ห้าม** แตะตาราง `khantok_ticket_claims`

### 2. Claim Station — `server/templates/claim_station.html`

บน order card เมื่อ `order.roundNumber == 4 && order.khantokTicket`:

- ยังไม่รับ (`khantokTicketClaimedAt` ว่าง): แผงเด่น "🎟 รับบัตรขันโตก ฿{value}"
  พร้อมปุ่ม **"รับบัตรขันโตก"** — แยกจากปุ่ม "ยืนยันรับสินค้า" ชัดเจน
- กดปุ่ม → `PATCH /claim-station/orders/{code}/khantok-claimed` → สำเร็จ:
  อัปเดต card เป็น state เขียว "รับบัตรแล้ว เมื่อ HH:MM", ปุ่ม disabled, beep success
- 409 → dialog เตือน "รับบัตรไปแล้ว" (pattern เดียวกับรับสินค้าซ้ำ) + แสดง state รับแล้ว
- Badge "รับแล้ว" ที่มีอยู่แล้ว (บรรทัด ~1343) แสดงตาม `khantokTicketClaimedAt` ตามเดิม
- Phase อื่น / ไม่มีบัตร: หน้าตาเดิมทุกประการ

### 3. Admin — `server/templates/admin.html` + `update_order()`

- Edit form ส่วน KHANTOK TICKET เพิ่ม toggle ที่สาม: **"รับแล้ว (claimed)"**
  (`#oe_khantokClaimedAt`) — checked เมื่อ `khantokTicketClaimedAt` มีค่า
- Save ส่ง field ใหม่ `khantokTicketClaimed: bool` →
  `update_order()`: `true` = set `khantok_ticket_claimed_at = now_iso()` เฉพาะเมื่อยังว่าง
  (ไม่ทับ timestamp เดิม), `false` = ล้างเป็น `NULL`
- การ set/ล้างนี้ **ไม่เขียน** `khantok_ticket_claims` (แยกขาดจาก logic Has ticket /
  Already claimed เดิมที่ sync claims เพื่อ quota)

### 4. Tests — `server/tests/test_order_api.py`

1. PATCH khantok-claimed สำเร็จ → `claimed_at` ถูก set, มีแถว `display2_picks`
   station=`khantok`, `COUNT(khantok_ticket_claims)` ไม่เปลี่ยน
2. กดซ้ำ → 409
3. ออเดอร์ไม่มีบัตร → 400; สถานะ `pending_payment` → 400; ไม่ auth → 401
4. Phase 4 + มาร์ค received ปกติ → **ไม่มี** แถว khantok ใน `display2_picks`
   (แถวสินค้ามีครบ)
5. Phase ≠ 4 + มาร์ค received → มีแถว khantok เหมือนเดิม
6. Admin PUT `khantokTicketClaimed` true/false → set/ล้าง `claimed_at`, quota นิ่ง,
   true ซ้ำไม่ทับ timestamp เดิม

## ผลลัพธ์ที่คาดหวัง

- Staff phase 4: ค้นออเดอร์ → เห็นแผงบัตร → กดรับบัตร → คิวขึ้นจอ KHANTOK STATION
  ทันที → รับสินค้าแยกอิสระ
- จอ Display 2 / KHANTOK STATION: ไม่ต้องแก้โค้ด (อ่าน `display2_picks` เดิม)
- Admin: เห็น/แก้สถานะรับบัตรได้จาก Edit form; quota บัตรไม่ขยับจากการรับหน้างาน
- Deploy ด้วย `bash deploy-api.sh` (แก้เฉพาะฝั่ง order-api + templates)
