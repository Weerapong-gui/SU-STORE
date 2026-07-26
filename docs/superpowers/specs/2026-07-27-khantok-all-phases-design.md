# รับบัตรขันโตกแยกได้ทุก phase

วันที่: 2026-07-27
สถานะ: design ผ่านการอนุมัติแล้ว รอเขียนแผน implement

---

## 1. ปัญหา

การ "รับบัตรขันโตก" ที่จุดรับของถูกแยกออกจากการ "รับของ" ตั้งแต่ commit `b75a06a` แต่เปิดใช้เฉพาะ **phase 4** เท่านั้น ด่านนี้อยู่ฝั่ง client ล้วน:

```js
// server/templates/claim_station.html:1355
if (Number(order.roundNumber) === 4 && !order.khantokStationClaimedAt) { ... }
```

ฝั่ง server `mark_khantok_station_claimed()` (`server/order_api.py:291`) ไม่เคยเช็ค phase เลย — ตรวจแค่ว่าออเดอร์มีบัตร (`khantok_ticket = 1`), สถานะไม่ใช่ `pending_payment`/`waiting_confirm`/`cancelled`/`rejected`, และยังไม่มี `khantok_station_claimed_at`

พร้อมกันนั้น หน้า admin ยังไม่มีตัวเลขบอกว่าแจกบัตรไปแล้วกี่ใบ และแถบ pagination อยู่ใต้ตารางที่ยาวมาก ต้องเลื่อนสุดหน้าถึงจะเปลี่ยนหน้าได้

## 2. เป้าหมาย

1. ปุ่ม "รับบัตรขันโตก" ใช้ได้ทุก phase
2. admin เห็น 2 ตัวเลข: บัตรที่แจกไปแล้วทั้งหมด และในนั้นมีกี่ออเดอร์ที่ยังไม่รับของ
3. Prev/Next + "Page x/y — n total orders" ย้ายไปอยู่เหนือตาราง

## 3. นอกขอบเขต

- ไอเดีย #2 (UI responsive + clone claim-station เป็น tab ของ admin) — spec แยก
- ไอเดีย #3 (ทำงาน offline แล้ว sync ตอนสัญญาณกลับมา) — spec แยก ควรทำหลัง #2
- ตัวกรอง/export สำหรับ "ออเดอร์ที่รับแต่บัตร" — ยังไม่ต้อง ยังไม่มีคนขอ

## 4. การตัดสินใจและเหตุผล

### 4.1 ตัวเลขใน admin นับ 2 ค่า ไม่ใช่ค่าเดียว

การ์ดโชว์ทั้ง "แจกบัตรไปแล้วกี่ใบ" และ "ในนั้นยังไม่รับของกี่ราย" — ค่าแรกเทียบกับโควตาที่แจกออกไปได้ ค่าหลังบอกว่ามีคนมารับแค่บัตรจริงๆ กี่คน

### 4.2 ออเดอร์เก่า: เตือน ไม่แตะข้อมูล

ออเดอร์ phase 1–3 ที่รับของไปนานแล้วไม่มี `khantok_station_claimed_at` เพราะฟีเจอร์เพิ่งมีตอน phase 4 พอเปิดทุก phase ปุ่มจะเด้งเหมือนยังไม่เคยรับบัตร ทั้งที่อาจรับไปพร้อมของแล้ว

เลือก**เตือนสีส้ม + ต้องยืนยันซ้ำ** แทนการ backfill `khantok_station_claimed_at = received_at` ให้ออเดอร์เก่า เพราะ backfill เขียนทับข้อมูลจริงหลายพันแถวโดยอาศัยการเดา ย้อนกลับยาก ส่วนคำเตือนไม่แตะ DB เลยและ staff ตัดสินใจได้เอง

### 4.3 กติกาคำเตือน: รับของคนละวันกับวันนี้

ถ้าเตือนทุกครั้งที่ "รับของแล้วแต่ยังไม่รับบัตร" จะเด้งทุกเคสปกติ เพราะ flow จริงคือ staff กดรับของก่อนแล้วกดรับบัตรต่อในนาทีเดียวกัน

ใช้ **วันตามเวลาไทย (+7)** เป็นเส้นแบ่ง — มาครั้งเดียวกันไม่เตือน กลับมาอีกวันเตือน ไม่ต้องมีค่าคงที่ cutoff หรือ config ให้ดูแล

### 4.4 กติกาอยู่ฝั่ง server ไม่ใช่ใน JS

`serialize_order()` ส่ง `khantokClaimWarning` มาให้ client เรนเดอร์ตรงๆ เหตุผล: เทสต์ด้วย pytest ได้ และไอเดีย #2 จะ clone claim-station เข้า admin — ทั้งสองหน้ายิง API เดียวกัน กติกาจึงไม่ต้องเขียนซ้ำสองที่แล้วเพี้ยนกันภายหลัง

## 5. ฝั่ง server (`server/order_api.py`)

### 5.1 ฟังก์ชันใหม่

```python
def khantok_claim_warning(received_at: str | None, now: datetime | None = None) -> bool:
    """True เมื่อออเดอร์รับของไปแล้ว 'คนละวัน' กับวันนี้ (เวลาไทย)

    ใช้เตือน staff ว่าอาจเคยได้บัตรขันโตกไปพร้อมของตั้งแต่ก่อนมีการรับบัตรแยก
    """
```

- pure function รับ 2 ค่า ไม่แตะ DB
- เทียบวันด้วย `TZ_BANGKOK` ที่มีอยู่แล้ว
- `received_at` ว่าง/None/parse ไม่ได้ → `False` (ไม่ throw)

### 5.2 `serialize_order()`

เพิ่มคีย์ `"khantokClaimWarning"` เป็นฟิลด์ใหม่ล้วน ไม่แก้ของเดิม client ที่ไม่รู้จักฟิลด์นี้ไม่พัง

### 5.3 `create_orders_summary()`

เพิ่ม 2 คีย์:

| key | นับ |
|---|---|
| `khantokStationClaimed` | `khantok_station_claimed_at IS NOT NULL` |
| `khantokStationClaimedNotReceived` | เงื่อนไขข้างบน `AND received_at IS NULL` |

ทั้งคู่กรอง `status NOT IN ('rejected','cancelled','refund','refunded')` และรับ `round_filter` เหมือนตัวนับจำนวนสินค้าที่มีอยู่ เพื่อให้กดชิป PHASE แล้วเลขขยับตาม

หมายเหตุ: 1 ออเดอร์ได้บัตรไม่เกิน 1 ใบ ตัวเลข "จำนวนออเดอร์" กับ "จำนวนใบ" จึงเท่ากันเสมอ

### 5.4 สิ่งที่ไม่แตะ

- ไม่มี schema change ไม่มี migration
- ไม่มี write path ใหม่ — `khantok_station_claimed_at` ยังเขียนผ่าน `mark_khantok_station_claimed()` ทางเดียวเหมือนเดิม
- ไม่แตะโควตา `khantok_ticket_claims`
- การกดรับบัตรยัง enqueue คิว khantok ขึ้น Display 2 เหมือนเดิม ต่างแค่ตอนนี้ออเดอร์ phase อื่นเข้าคิวได้ด้วย

## 6. ฝั่ง UI

### 6.1 `claim_station.html` — ปุ่มรับบัตรทุก phase

แก้เงื่อนไขที่บรรทัด ~1355 ตัด `Number(order.roundNumber) === 4` ออกทั้งหมด เหลือ 3 สาขา:

| เงื่อนไข | แสดง |
|---|---|
| ยังไม่รับบัตร + `khantokClaimWarning` false | panel เขียว `--ok` + ปุ่ม "รับบัตรขันโตก" (เหมือนเดิม) |
| ยังไม่รับบัตร + `khantokClaimWarning` true | panel ส้ม `--warn` / `--warn-bg` + บรรทัด "รับของไปแล้วเมื่อ &lt;วัน เวลา&gt; — ตรวจสอบก่อนว่ายังไม่ได้รับบัตร" + ปุ่มเดียวกันแต่ต้องผ่าน dialog ยืนยัน |
| รับบัตรแล้ว | badge "รับบัตรแล้ว เมื่อ ..." (เหมือนเดิม) |

- `--warn` / `--warn-bg` มีอยู่แล้วในไฟล์ (บรรทัด 26) ครบทั้ง light/dark
- สาขา `else` ตัวสุดท้ายของเดิม (badge เฉยๆ สำหรับออเดอร์นอก phase 4) กลายเป็น dead code → ลบพร้อมตัวแปร `khantokClaimedLine` ที่ใช้เฉพาะสาขานั้น
- `doClaimKhantok(code)` เพิ่มพารามิเตอร์ที่สอง `needConfirm` เมื่อ true เรียก `showCsDialog({type:'confirm', icon:'warn', ...})` ที่มีอยู่แล้วก่อนยิง fetch ส่วน fetch/error handling เดิมไม่แตะ

### 6.2 `admin.html` — การ์ดสรุป

เพิ่ม 2 การ์ดต่อท้าย `row1` (~บรรทัด 1538–1546) ถัดจากวงกลมโควตา ฿100/฿50:

```
บัตรขันโตกที่แจกแล้ว   1,240      ยังไม่รับของ   37
   #statKhantokClaimed        #statKhantokOnly
```

ต้องเพิ่ม `id` ทั้งสองใน **`updateOrderStats()`** (~บรรทัด 1432) ด้วย ไม่ใช่แค่ `renderOrderStats()` — คนละฟังก์ชันกัน อันแรกใช้ตอน SSE ส่งค่าใหม่ อันหลังใช้ตอน render ครั้งแรก ถ้าเพิ่มที่เดียวตัวเลขจะนิ่งไม่อัปเดตสด

### 6.3 `admin.html` — pagination ขึ้นบน

- ย้าย `<div id="paginationBar">` จาก ~บรรทัด 266 (ใต้ `</table>`) ขึ้นไปคั่นระหว่าง `.toolbar` กับ `<div class="table-wrap">`
- `renderPagination()` (~บรรทัด 2094) ใส่ข้อความกลางแถบ: `← Prev` · `Page 1/20 — 986 total orders` · `Next →`
- ลบ `setOrdersNotice("Page " + ...)` (~บรรทัด 2137) ให้ `#ordersNotice` เหลือหน้าที่เดียวคือแสดง error/สถานะการบันทึก
- แถบว่างตอนมีหน้าเดียวไม่กินที่ เพราะ `renderPagination()` เคลียร์ `innerHTML` อยู่แล้ว

## 7. Error handling

- **server ปฏิเสธ** — 400 (ไม่มีบัตร / สถานะยังไม่พร้อม) และ 409 (รับไปแล้ว) ใช้ทางเดิมจาก commit `1e32a38`: เปิดปุ่มคืน + `refreshCurrentOrder()` ไม่ต้องแก้
- **คำเตือนไม่บล็อก** — เป็น UI ล้วน คนตัดสินสุดท้ายว่ารับซ้ำได้ไหมคือ server (มี `khantok_station_claimed_at` แล้ว = 409) ไม่ว่า client จะเตือนหรือไม่
- **ฟิลด์หาย** — `khantokClaimWarning` ไม่มีในผลลัพธ์ (response ค้างใน cache) → ถือเป็น false ไม่เตือน ไม่ throw
- **rollback** — ไม่มี migration ไม่มี write ใหม่ ย้อนด้วย `git revert` + `bash deploy-api.sh`

## 8. เทสต์

### pytest — `server/tests/test_order_api.py` (pure logic ตามแนวไฟล์เดิม)

`khantok_claim_warning`:

| เคส | คาดหวัง |
|---|---|
| `received_at` = วันนี้ (เวลาไทย) | False |
| `received_at` = เมื่อวาน | True |
| `received_at` = None / `""` | False |
| `received_at` = `2026-07-26T17:30Z`, now = 27 ก.ค. เวลาไทย | False — UTC 17:30 คือ 00:30 ของวันที่ 27 แล้ว เคสข้ามเที่ยงคืนต้องไม่เตือนผิด |
| `received_at` รูปแบบพัง | False (ไม่ throw) |

### pytest — summary counts (ใช้ `temp_db` fixture ที่มีอยู่)

ใส่ออเดอร์ 4 แบบ: claimed + received / claimed ไม่ received / ไม่ claimed / claimed แต่ status `rejected`
คาดหวัง `khantokStationClaimed = 2`, `khantokStationClaimedNotReceived = 1` (ออเดอร์ rejected ไม่ถูกนับ) แล้วเช็ค `round_filter` แยกอีกรอบ

### manual หลัง deploy

1. claim station หาออเดอร์ phase 1 ที่มีบัตรและรับของไปนานแล้ว → เห็น panel ส้ม + ต้องยืนยัน 2 ชั้น
2. กดรับ → คิว khantok ขึ้น Display 2 หนึ่งแถว
3. กดซ้ำ → 409 "รับบัตรไปแล้ว"
4. ออเดอร์ที่เพิ่งกดรับของเมื่อครู่ → **ต้องไม่มี**คำเตือน
5. admin กดชิป PHASE → เลข 2 ตัวใหม่ขยับตาม phase

## 9. Deploy

แก้เฉพาะ `server/` → `bash deploy-api.sh` (order-api restart ~3-5 วินาที, Next.js ไม่ถูกแตะ)
