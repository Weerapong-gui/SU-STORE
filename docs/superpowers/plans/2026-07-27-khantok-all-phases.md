# Khantok Claim Across All Phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิดให้ "รับบัตรขันโตก" แยกจาก "รับของ" ได้ทุก phase พร้อมตัวนับใน admin และย้ายแถบ pagination ขึ้นเหนือตาราง

**Architecture:** ด่าน phase-4 เดิมอยู่ใน JavaScript ของ `claim_station.html` ล้วน ส่วน `mark_khantok_station_claimed()` ฝั่ง server ไม่เคยเช็ค phase อยู่แล้ว งานนี้จึงเป็นการ **ลบด่านฝั่ง client** แล้วเพิ่ม read-only field `khantokClaimWarning` ที่ server คำนวณให้ (กติกา: รับของไปคนละวันไทยกับวันนี้) เพื่อให้ทั้ง claim station ตอนนี้และ admin-embedded claim station ในอนาคตใช้กติกาเดียวกัน ไม่มี schema change ไม่มี write path ใหม่

**Tech Stack:** Python 3 stdlib (`http.server`, `sqlite3`, `datetime`), pytest, vanilla JS ใน `server/templates/*.html` (ไม่มี build step)

**Spec:** `docs/superpowers/specs/2026-07-27-khantok-all-phases-design.md`

## Global Constraints

- **ห้ามแตะข้อมูลออเดอร์** — ห้าม `INSERT`/`UPDATE`/`DELETE` ใหม่, ห้าม migration, ห้าม `ALTER TABLE` งานนี้เพิ่มเฉพาะการ **อ่าน**
- **ไม่แตะโควตา** `khantok_ticket_claims` — การรับบัตรที่หน้างานเป็นคนละเรื่องกับโควตาที่จองตอนสร้างออเดอร์
- **ไม่เพิ่ม dependency** — Python stdlib เท่านั้น, JS ต้องเป็น vanilla ES5-compatible แบบเดียวกับโค้ดรอบข้าง (`var`, ไม่ใช้ optional chaining)
- **Escape ก่อน `innerHTML` เสมอ** — ค่าที่มาจากผู้ใช้หรือ DB ต้องผ่าน `esc()` ก่อนต่อเป็น HTML string
- **Timezone** — เทียบวันด้วย `TZ_BANGKOK` (`timezone(timedelta(hours=7))`, `server/order_api.py:182`) เท่านั้น
- **Deploy** — แก้เฉพาะ `server/` → `bash deploy-api.sh` ห้ามใช้ `deploy.sh`
- **รันเทสต์** ต้องแยกสองคำสั่ง ห้ามรวมเป็นคำสั่งเดียว (`server/tests/` กับ `tests/` ต่างก็เป็น package ชื่อ `tests` → pytest collect ชนกัน):
  ```bash
  python3 -m pytest server/tests/ -v
  python3 -m pytest tests/ -v
  ```
  ต้องตั้ง env ก่อนเพราะ `order_api.py` สร้าง data dir ตอน import:
  ```bash
  export ORDER_API_DB_PATH=/tmp/su-order-api/orders.db \
         ORDER_API_SLIPS_DIR=/tmp/su-order-api/slips \
         ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides \
         ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets \
         PRODUCT_IMAGES_DIR=/tmp/su-order-api/product-images
  ```

## File Structure

| ไฟล์ | สถานะ | ความรับผิดชอบ |
|---|---|---|
| `server/order_api.py` | modify | เพิ่ม `_parse_stored_datetime()` + `khantok_claim_warning()`, ฟิลด์ใน `serialize_order()`, ตัวนับใน `create_orders_summary()` |
| `server/templates/claim_station.html` | modify | ปุ่มรับบัตรทุก phase + panel เตือนสีส้ม + dialog ยืนยัน + helper `_fmtBkkShort()` |
| `server/templates/admin.html` | modify | การ์ดสรุป 2 ใบ + ย้าย `#paginationBar` ขึ้นเหนือตาราง |
| `server/tests/test_order_api.py` | modify | เทสต์ pure logic + เทสต์ยืนยันเนื้อหา template (รันใน CI) |
| `tests/test_khantok_claim.py` | modify | เทสต์ตัวนับ summary ที่ต้องใช้ DB จริง (ใช้ fixture `temp_db` ที่มีอยู่) |
| `.github/workflows/ci.yml` | modify | เพิ่มการรัน `tests/` ซึ่งตอนนี้ CI ไม่ได้รันเลย |

---

### Task 1: `khantok_claim_warning()` + ฟิลด์ใน `serialize_order()`

**Files:**
- Modify: `server/order_api.py` (เพิ่มฟังก์ชันใหม่ต่อจาก `now_iso()` ~บรรทัด 187, และเพิ่มคีย์ใน `serialize_order()` ~บรรทัด 1044)
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `TZ_BANGKOK` (`server/order_api.py:182`), `datetime` / `timezone` ที่ import อยู่แล้วที่หัวไฟล์
- Produces:
  - `_parse_stored_datetime(value: str | None) -> datetime | None`
  - `khantok_claim_warning(received_at: str | None, now: datetime | None = None) -> bool`
  - คีย์ JSON `"khantokClaimWarning": bool` ในทุก response ที่ผ่าน `serialize_order()`

**บริบทที่ต้องรู้:** timestamp ใน DB มีสองรูปแบบปนกัน แถวใหม่เขียนด้วย `now_iso()` ได้ `2026-07-26T12:08:10+07:00` (มี offset) ส่วนแถวเก่าบางส่วนเก็บเป็น UTC ลงท้าย `Z` หรือไม่มี suffix เลย ต้องรองรับทั้งสองแบบ ไม่งั้นวันจะเพี้ยน 7 ชั่วโมง

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มที่ท้าย `server/tests/test_order_api.py` และเพิ่ม `from datetime import datetime` ไว้ใต้ `import os` ที่หัวไฟล์:

```python
class TestKhantokClaimWarning:
    """รับของไปคนละวันไทยกับวันนี้ = เตือน staff ว่าอาจเคยได้บัตรไปพร้อมของแล้ว"""

    def _now(self):
        return datetime(2026, 7, 27, 9, 0, tzinfo=order_api.TZ_BANGKOK)

    def test_received_today_does_not_warn(self):
        # flow ปกติ: กดรับของแล้วกดรับบัตรต่อในนาทีเดียวกัน ต้องเงียบ
        now = datetime(2026, 7, 27, 14, 0, tzinfo=order_api.TZ_BANGKOK)
        assert order_api.khantok_claim_warning("2026-07-27T09:30:00+07:00", now) is False

    def test_received_yesterday_warns(self):
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", self._now()) is True

    def test_missing_value_does_not_warn(self):
        assert order_api.khantok_claim_warning(None, self._now()) is False
        assert order_api.khantok_claim_warning("", self._now()) is False

    def test_naive_utc_row_is_read_as_utc(self):
        # 2026-07-26T17:30Z == 2026-07-27T00:30 +07 -> วันไทยเดียวกับ now -> ไม่เตือน
        assert order_api.khantok_claim_warning("2026-07-26T17:30:00Z", self._now()) is False

    def test_space_separated_value_is_accepted(self):
        assert order_api.khantok_claim_warning("2026-07-26 18:00:00+07:00", self._now()) is True

    def test_unparseable_value_does_not_warn(self):
        assert order_api.khantok_claim_warning("not a date", self._now()) is False

    def test_naive_now_is_assumed_bangkok(self):
        naive_now = datetime(2026, 7, 27, 9, 0)
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", naive_now) is True
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestKhantokClaimWarning -v
```
Expected: FAIL — `AttributeError: module 'order_api' has no attribute 'khantok_claim_warning'`

- [ ] **Step 3: เขียน implementation ให้น้อยที่สุดที่ทำให้ผ่าน**

แทรกใน `server/order_api.py` ต่อจาก `now_iso()` (ก่อน `def log_audit`):

```python
def _parse_stored_datetime(value: str | None) -> datetime | None:
    """แปลงค่า timestamp ในคอลัมน์ให้เป็น datetime ที่มี timezone

    แถวใหม่เขียนด้วย now_iso() จึงมี offset +07:00 ติดมา ส่วนแถวเก่าเก็บเป็น UTC
    (บางแถวลงท้าย 'Z' บางแถวไม่มี suffix) ค่าที่ไม่มี offset จึงถือเป็น UTC
    ตรงกับที่ทุกหน้าจอแสดงผลกันอยู่ คืน None เมื่อ parse ไม่ได้ ไม่ raise
    """
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def khantok_claim_warning(received_at: str | None, now: datetime | None = None) -> bool:
    """True เมื่อออเดอร์รับของไปแล้วในวันไทยที่เก่ากว่าวันนี้

    ออเดอร์ที่รับของไปก่อนจะมีการรับบัตรแยก อาจได้บัตรขันโตกไปพร้อมของแล้ว
    claim station จึงเตือนก่อนแจกใบใหม่ ส่วนคนที่มารับวันเดียวกันต้องไม่เตือน
    เพราะ flow ปกติคือ staff กดรับของแล้วกดรับบัตรต่อห่างกันไม่กี่นาที
    """
    received = _parse_stored_datetime(received_at)
    if received is None:
        return False
    current = now or datetime.now(TZ_BANGKOK)
    if current.tzinfo is None:
        current = current.replace(tzinfo=TZ_BANGKOK)
    return received.astimezone(TZ_BANGKOK).date() < current.astimezone(TZ_BANGKOK).date()
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestKhantokClaimWarning -v
```
Expected: PASS ทั้ง 7 เคส

- [ ] **Step 5: เขียนเทสต์ของฟิลด์ใน serializer (ยังไม่ผ่าน)**

เพิ่มใน `tests/test_khantok_claim.py` ต่อจากคลาส `TestStationClaimedColumn`:

```python
class TestSerializerClaimWarning:
    def test_warning_true_for_order_received_on_an_earlier_day(self, temp_db):
        _insert_summary_order(
            temp_db, "FP2899881", status="received",
            station_claimed_at=None, received_at="2020-01-01T10:00:00+07:00",
        )
        row = order_api.fetch_order_by_code(temp_db, "FP2899881")
        assert order_api.serialize_order(row)["khantokClaimWarning"] is True

    def test_warning_false_when_never_received(self, temp_db):
        _insert_summary_order(
            temp_db, "FP2899882", status="shipped",
            station_claimed_at=None, received_at=None,
        )
        row = order_api.fetch_order_by_code(temp_db, "FP2899882")
        assert order_api.serialize_order(row)["khantokClaimWarning"] is False
```

และเพิ่ม helper นี้ไว้เหนือคลาส (Task 2 ใช้ตัวเดียวกันนี้ อย่าเขียนซ้ำ):

```python
def _insert_summary_order(connection, code, *, round_number=1, status="received",
                          station_claimed_at=None, received_at=None):
    connection.execute(
        "INSERT INTO orders ("
        "  round_number, status, payment_status, created_at, updated_at, order_code,"
        "  khantok_station_claimed_at, received_at,"
        "  product_slug, product_name, product_short_name, product_tagline,"
        "  product_price, product_image, product_category,"
        "  size, quantity, total_amount,"
        "  first_name, last_name, nickname, email, phone, school, access_token"
        ") VALUES (?, ?, 'paid', '2026-07-19T00:00:00Z', '2026-07-19T00:00:00Z', ?,"
        "  ?, ?,"
        "  'single-shirt', 'FRESHER POLO SHIRT', 'POLO', 'tagline',"
        "  399, '/p.png', 'single',"
        "  'M', 1, 399,"
        "  'John', 'Doe', 'nick', 'a@b.c', '0800000000', 'MFU', ?)",
        (round_number, status, code, station_claimed_at, received_at, "tok-" + code),
    )
```

- [ ] **Step 6: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest tests/test_khantok_claim.py::TestSerializerClaimWarning -v
```
Expected: FAIL — `KeyError: 'khantokClaimWarning'`

- [ ] **Step 7: เพิ่มฟิลด์ใน `serialize_order()`**

ใน `server/order_api.py` แทรกต่อจากบล็อก `"khantokStationClaimedAt": (...)` (~บรรทัด 1044):

```python
        "khantokClaimWarning": khantok_claim_warning(
            row["received_at"] if "received_at" in row_keys else None
        ),
```

- [ ] **Step 8: รันเทสต์ทั้งสองชุดให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด ไม่มีเทสต์เดิมพัง

- [ ] **Step 9: Commit**

```bash
git add server/order_api.py server/tests/test_order_api.py tests/test_khantok_claim.py
git commit -m "feat(khantok): server-side khantokClaimWarning flag on serialized orders"
```

---

### Task 2: ตัวนับ `khantokStationClaimed` / `khantokStationClaimedNotReceived`

**Files:**
- Modify: `server/order_api.py` — `create_orders_summary()` (~บรรทัด 1337–1403)
- Modify: `.github/workflows/ci.yml` (~บรรทัด 64)
- Test: `tests/test_khantok_claim.py`

**Interfaces:**
- Consumes: helper `_insert_summary_order()` จาก Task 1, fixture `temp_db` (`tests/test_khantok_claim.py:27`)
- Produces: คีย์ `"khantokStationClaimed": int` และ `"khantokStationClaimedNotReceived": int` ใน dict ที่ `create_orders_summary()` คืน — Task 4 ใช้สองคีย์นี้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มใน `tests/test_khantok_claim.py`:

```python
class TestKhantokStationSummaryCounts:
    def test_counts_claimed_and_claimed_but_not_received(self, temp_db):
        _insert_summary_order(temp_db, "FP2890001", status="received",
                              station_claimed_at="2026-07-26T10:00:00+07:00",
                              received_at="2026-07-26T10:00:00+07:00")
        _insert_summary_order(temp_db, "FP2890002", status="shipped",
                              station_claimed_at="2026-07-26T11:00:00+07:00",
                              received_at=None)
        _insert_summary_order(temp_db, "FP2890003", status="received",
                              station_claimed_at=None,
                              received_at="2026-07-26T12:00:00+07:00")
        _insert_summary_order(temp_db, "FP2890004", status="rejected",
                              station_claimed_at="2026-07-26T13:00:00+07:00",
                              received_at=None)
        summary = order_api.create_orders_summary(temp_db)
        assert summary["khantokStationClaimed"] == 2
        assert summary["khantokStationClaimedNotReceived"] == 1

    def test_counts_are_zero_on_empty_db(self, temp_db):
        summary = order_api.create_orders_summary(temp_db)
        assert summary["khantokStationClaimed"] == 0
        assert summary["khantokStationClaimedNotReceived"] == 0

    def test_round_filter_scopes_the_counts(self, temp_db):
        _insert_summary_order(temp_db, "FP2890011", round_number=1, status="shipped",
                              station_claimed_at="2026-07-26T10:00:00+07:00",
                              received_at=None)
        _insert_summary_order(temp_db, "FP2890012", round_number=4, status="shipped",
                              station_claimed_at="2026-07-26T10:00:00+07:00",
                              received_at=None)
        assert order_api.create_orders_summary(temp_db, round_filter=4)["khantokStationClaimed"] == 1
        assert order_api.create_orders_summary(temp_db)["khantokStationClaimed"] == 2
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest tests/test_khantok_claim.py::TestKhantokStationSummaryCounts -v
```
Expected: FAIL — `KeyError: 'khantokStationClaimed'`

- [ ] **Step 3: เพิ่ม query ใน `create_orders_summary()`**

แทรกต่อจากบล็อก `total_row = connection.execute(...)` และก่อนคอมเมนต์ `# Count per-category qty from items_json`:

```python
    khantok_station_row = connection.execute(
        f"""
        SELECT
            COUNT(*) AS claimed,
            SUM(CASE WHEN received_at IS NULL OR received_at = '' THEN 1 ELSE 0 END) AS not_received
        FROM orders
        WHERE khantok_station_claimed_at IS NOT NULL
          AND khantok_station_claimed_at != ''
          AND status NOT IN ('rejected','cancelled','refund','refunded')
          {round_where}
        """,
        round_params,
    ).fetchone()
```

แล้วเพิ่มสองคีย์นี้ใน dict ที่ return (วางถัดจาก `"khantokTicket50Remaining"`):

```python
        "khantokStationClaimed": int(khantok_station_row["claimed"] or 0),
        "khantokStationClaimedNotReceived": int(khantok_station_row["not_received"] or 0),
```

> `round_where` เป็นสตริง `"AND round_number = ?"` หรือ `""` และ `round_params` เป็น list ที่คู่กัน — ทั้งคู่ถูกสร้างไว้แล้วที่ต้นฟังก์ชัน ห้ามต่อค่าจากผู้ใช้เข้า SQL เอง

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest tests/test_khantok_claim.py::TestKhantokStationSummaryCounts -v
python3 -m pytest server/tests/ -v
```
Expected: PASS ทั้งหมด

- [ ] **Step 5: ให้ CI รันโฟลเดอร์ `tests/` ด้วย**

`tests/` ไม่เคยถูกรันใน CI เลย — เทสต์ของ Task 1 และ 2 อยู่ในนั้น แก้ `.github/workflows/ci.yml` บรรทัด ~64 จาก:

```yaml
        run: python3 -m pytest server/tests/ -v
```

เป็น:

```yaml
        # แยกสองคำสั่ง: server/tests กับ tests ต่างก็เป็น package ชื่อ "tests"
        # รวมใน invocation เดียวแล้ว pytest collect ชนกัน
        run: |
          python3 -m pytest server/tests/ -v
          python3 -m pytest tests/ -v
```

- [ ] **Step 6: ตรวจว่าคำสั่งแบบเดียวกับ CI ผ่านในเครื่อง**

```bash
python3 -m pytest server/tests/ -v && python3 -m pytest tests/ -v
```
Expected: PASS ทั้งสองคำสั่ง

- [ ] **Step 7: Commit**

```bash
git add server/order_api.py tests/test_khantok_claim.py .github/workflows/ci.yml
git commit -m "feat(khantok): admin summary counters for tickets handed out at the station"
```

---

### Task 3: `claim_station.html` — ปุ่มรับบัตรทุก phase + เตือนสีส้ม

**Files:**
- Modify: `server/templates/claim_station.html` (~บรรทัด 1342–1373 บล็อก khantok, และ `doClaimKhantok()` ~บรรทัด 1571)
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `order.khantokClaimWarning`, `order.receivedAt`, `order.khantokStationClaimedAt` จาก `serialize_order()` (Task 1); helper ที่มีอยู่แล้วในไฟล์ — `esc()`, `IC_TICKET`, `showCsDialog()`, `beepWarn()`
- Produces: `_fmtBkkShort(iso) -> string` — helper แปลง timestamp เป็น `26/7 14:48` ตามเวลาไทย, `doClaimKhantok(code, needConfirm)`

**บั๊กที่ต้องแก้ไปพร้อมกัน:** โค้ดเดิมฟอร์แมตเวลาด้วย `new Date(new Date(iso).getTime() + 7*3600000)` แล้วอ่านด้วย `.getDate()` / `.getHours()` ซึ่งเป็นเวลา local ของ browser — เครื่อง staff อยู่ไทย (UTC+7) จึงบวก 7 ชั่วโมงซ้ำสองรอบ เวลาที่โชว์เพี้ยนไป 7 ชั่วโมง helper ตัวใหม่อ่านด้วย `getUTC*` หลังบวก offset จึงถูกต้องไม่ว่า browser จะอยู่ timezone ไหน

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มใน `server/tests/test_order_api.py` (template ถูกอ่านเข้าตัวแปรตอน import จึงยืนยันเนื้อหาได้):

```python
class TestClaimStationTemplate:
    def test_phase_four_gate_is_removed(self):
        # ด่านเดิมคือ Number(order.roundNumber) === 4 ต้องไม่เหลืออยู่
        assert "roundNumber) === 4" not in order_api.CLAIM_STATION_HTML

    def test_claim_button_passes_the_warning_flag(self):
        assert "khantokClaimWarning" in order_api.CLAIM_STATION_HTML
        assert "doClaimKhantok(code, needConfirm)" in order_api.CLAIM_STATION_HTML

    def test_warning_panel_uses_the_existing_warn_palette(self):
        assert "var(--warn-bg)" in order_api.CLAIM_STATION_HTML

    def test_timestamp_helper_reads_utc_getters(self):
        # กันการกลับไปใช้ .getHours() ซึ่งบวก offset ซ้ำบนเครื่องที่ตั้งเวลาไทย
        assert "function _fmtBkkShort(" in order_api.CLAIM_STATION_HTML
        assert "getUTCHours()" in order_api.CLAIM_STATION_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestClaimStationTemplate -v
```
Expected: FAIL — 4 เคสตกทั้งหมด

- [ ] **Step 3: เพิ่ม helper `_fmtBkkShort()`**

แทรกใน `<script>` ของ `claim_station.html` ก่อนฟังก์ชันที่เรนเดอร์การ์ดออเดอร์:

```javascript
    function _fmtBkkShort(iso) {
      if (!iso) return '';
      try {
        var s = String(iso).replace(' ', 'T');
        if (!s.endsWith('Z') && !/[+-]\d\d:\d\d$/.test(s)) s += 'Z';
        var d = new Date(s);
        if (isNaN(d.getTime())) return '';
        var b = new Date(d.getTime() + 7 * 3600000);
        return b.getUTCDate() + '/' + (b.getUTCMonth() + 1) + ' ' +
               String(b.getUTCHours()).padStart(2, '0') + ':' +
               String(b.getUTCMinutes()).padStart(2, '0');
      } catch (e) { return ''; }
    }
```

- [ ] **Step 4: แทนบล็อก khantok ทั้งก้อน**

แทนที่ตั้งแต่ `if (order.khantokTicket) {` จนจบ `}` ของบล็อกนั้น (รวมสาขา `else` ตัวสุดท้ายที่กลายเป็น dead code) ด้วย:

```javascript
      if (order.khantokTicket) {
        var ktLabel = ' บัตรขันโตก' + (order.khantokTicketValue ? ' ฿' + order.khantokTicketValue : '');
        if (!order.khantokStationClaimedAt) {
          var warn = !!order.khantokClaimWarning;
          var accent = warn ? 'var(--warn)' : 'var(--ok)';
          var accentBg = warn ? 'var(--warn-bg)' : 'var(--ok-bg)';
          var warnLine = '';
          if (warn) {
            var rcvWhen = _fmtBkkShort(order.receivedAt);
            warnLine = '<div style="font-size:12.5px;font-weight:600;margin-bottom:10px;line-height:1.5">' +
              'รับของไปแล้ว' + (rcvWhen ? 'เมื่อ ' + esc(rcvWhen) : '') +
              ' — ตรวจสอบก่อนว่ายังไม่ได้รับบัตร</div>';
          }
          khantok = '<div class="khantok-claim-panel" style="margin:8px 14px;padding:14px;border-radius:12px;background:' + accentBg + ';border:1.5px solid ' + accent + '">' +
            '<div style="display:flex;align-items:center;gap:6px;font-weight:800;color:' + accent + ';margin-bottom:10px">' + IC_TICKET + ktLabel + ' — ยังไม่ได้รับ</div>' +
            warnLine +
            '<button id="khantokClaimBtn" class="btn-confirm" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px" onclick="doClaimKhantok(\'' + esc(order.id || '') + '\', ' + (warn ? 'true' : 'false') + ')">' + IC_TICKET + ' รับบัตรขันโตก</button></div>';
        } else {
          var ktWhen = _fmtBkkShort(order.khantokStationClaimedAt);
          khantok = '<div class="khantok-badge" style="display:flex;align-items:center;gap:4px">' + IC_TICKET + ktLabel + ' — รับบัตรแล้ว' + (ktWhen ? ' เมื่อ ' + esc(ktWhen) : '') + '</div>';
        }
      }
```

จากนั้นลบตัวแปร `khantokClaimedLine` กับบล็อก `try { ... }` ที่คำนวณมัน (~บรรทัด 1342–1352) ทิ้ง เพราะไม่มีใครใช้แล้ว

- [ ] **Step 5: ให้ `doClaimKhantok` รับ flag แล้วถามยืนยัน**

แก้บรรทัดแรกของ `doClaimKhantok` จาก `async function doClaimKhantok(code) {` เป็น:

```javascript
    async function doClaimKhantok(code, needConfirm) {
      if (needConfirm) {
        beepWarn();
        var ok = await showCsDialog({
          type: 'confirm', icon: 'warn',
          title: 'ออเดอร์นี้รับของไปแล้ว',
          message: 'ตรวจสอบให้แน่ใจว่ายังไม่เคยได้รับบัตรขันโตก แล้วจึงกดยืนยัน',
          confirmText: 'ยืนยัน แจกบัตร'
        });
        if (!ok) return;
      }
      var btn = document.getElementById('khantokClaimBtn');
```

โค้ดที่เหลือของฟังก์ชัน (fetch, 401, 409, error handling) **ไม่ต้องแตะ**

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด

- [ ] **Step 7: Commit**

```bash
git add server/templates/claim_station.html server/tests/test_order_api.py
git commit -m "feat(khantok): claim-station ticket button on every phase with stale-pickup warning"
```

---

### Task 4: `admin.html` — การ์ดสรุป 2 ใบ

**Files:**
- Modify: `server/templates/admin.html` — `renderOrderStats()` `row1` (~บรรทัด 1538–1546) และ `updateOrderStats()` (~บรรทัด 1429–1440)
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `summary.khantokStationClaimed`, `summary.khantokStationClaimedNotReceived` (Task 2)
- Produces: element `#statKhantokClaimed`, `#statKhantokOnly`

**กับดัก:** ตัวเลขในการ์ดถูกเขียนจาก **สองฟังก์ชัน** — `renderOrderStats()` ตอนโหลดหน้าแรก และ `updateOrderStats()` ตอน `/admin/stats-stream` ส่งค่าใหม่มา ถ้าเพิ่มแค่ที่แรก ตัวเลขจะค้างไม่อัปเดตสด

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminKhantokStationCards:
    def test_both_cards_are_rendered(self):
        assert 'id="statKhantokClaimed"' in order_api.ADMIN_HTML
        assert 'id="statKhantokOnly"' in order_api.ADMIN_HTML

    def test_both_cards_are_wired_for_live_updates(self):
        # setOdom ถูกนิยามเฉพาะใน updateOrderStats() การเจอคู่นี้จึงพิสูจน์ว่า
        # การ์ดอัปเดตตอน stats-stream ส่งค่าใหม่ ไม่ใช่แค่ตอน render ครั้งแรก
        assert "setOdom('statKhantokClaimed'" in order_api.ADMIN_HTML
        assert "setOdom('statKhantokOnly'" in order_api.ADMIN_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminKhantokStationCards -v
```
Expected: FAIL ทั้ง 2 เคส

- [ ] **Step 3: เพิ่มการ์ดใน `renderOrderStats()`**

ใน array `row1` เพิ่มสองรายการนี้ต่อจาก `khantokStatHtml("บัตรขันโตก ฿50", k50Used, k50Quota),`:

```javascript
        '<div class="stat"><span>บัตรขันโตกที่แจกแล้ว</span><strong id="statKhantokClaimed">' + esc(summary.khantokStationClaimed || 0) + '</strong></div>',
        '<div class="stat"><span>รับบัตร ยังไม่รับของ</span><strong id="statKhantokOnly">' + esc(summary.khantokStationClaimedNotReceived || 0) + '</strong></div>',
```

- [ ] **Step 4: ต่อสายให้อัปเดตสดใน `updateOrderStats()`**

เพิ่มสองบรรทัดนี้ต่อจาก `setOdom('statRejected', n(summary.rejected));`:

```javascript
      setOdom('statKhantokClaimed', n(summary.khantokStationClaimed));
      setOdom('statKhantokOnly', n(summary.khantokStationClaimedNotReceived));
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): summary cards for khantok tickets handed out at the station"
```

---

### Task 5: `admin.html` — ย้าย pagination ขึ้นเหนือตาราง

**Files:**
- Modify: `server/templates/admin.html` — ย้าย `<div id="paginationBar">` (บรรทัด ~266), แก้ `renderPagination()` (~บรรทัด 2093–2103), ลบข้อความซ้ำใน `loadOrders()` (~บรรทัด 2137)
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: ตัวแปร global `currentPage`, `totalPages`, `totalOrders` ที่มีอยู่แล้ว
- Produces: ไม่มี interface ใหม่ให้ task อื่นใช้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminPaginationPlacement:
    def test_pagination_bar_sits_above_the_orders_table(self):
        html = order_api.ADMIN_HTML
        assert html.index('id="paginationBar"') < html.index('id="ordersBody"')

    def test_page_info_is_not_duplicated_in_the_notice_line(self):
        assert 'setOrdersNotice("Page "' not in order_api.ADMIN_HTML

    def test_pagination_bar_uses_the_new_label_format(self):
        # ต้องเป็นรูปแบบใหม่ที่ renderPagination ประกอบเอง ไม่ใช่ '(n orders)' แบบเดิม
        assert "'/' + totalPages + ' — ' + totalOrders + ' total orders'" in order_api.ADMIN_HTML
        assert "' (' + totalOrders + ' orders)'" not in order_api.ADMIN_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminPaginationPlacement -v
```
Expected: FAIL — เคสแรกและเคสที่สองตก (ตอนนี้แถบอยู่ใต้ตาราง และ notice ยังพิมพ์ page ซ้ำ)

- [ ] **Step 3: ย้าย element**

ลบบรรทัดนี้ที่อยู่ใต้ `</table>` / `</div>` (บรรทัด ~266):

```html
      <div id="paginationBar" style="display:flex;gap:12px;align-items:center;padding:12px 0;justify-content:center"></div>
```

แล้วแทรกกลับเข้าไปใหม่ **เหนือ** `<div class="table-card">` (บรรทัด ~248 คือบรรทัดถัดจาก `</div>` ที่ปิดแถบ bulk actions) ด้วย style ที่ชิดขอบทั้งสองข้าง:

```html
      <div id="paginationBar" style="display:flex;gap:12px;align-items:center;padding:4px 0 12px;justify-content:space-between;flex-wrap:wrap"></div>
```

- [ ] **Step 4: แก้ข้อความในแถบ**

ใน `renderPagination()` เปลี่ยน `<span>` ตรงกลางจาก `'Page ' + currentPage + ' / ' + totalPages + ' (' + totalOrders + ' orders)'` เป็น:

```javascript
        '<span style="font-size:13px;color:var(--muted)">Page ' + currentPage + '/' + totalPages + ' — ' + totalOrders + ' total orders' + '</span>' +
```

- [ ] **Step 5: ลบข้อความซ้ำใน `loadOrders()`**

ลบบรรทัดนี้ทิ้ง (~บรรทัด 2137) เพื่อให้ `#ordersNotice` เหลือหน้าที่เดียวคือแสดง error/สถานะการบันทึก:

```javascript
        setOrdersNotice("Page " + currentPage + "/" + totalPages + " — " + totalOrders + " total orders");
```

แทนที่ด้วยการล้างข้อความ "Loading..." ที่ตั้งไว้ตอนต้นฟังก์ชัน:

```javascript
        setOrdersNotice("");
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด

- [ ] **Step 7: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): move orders pagination bar above the table"
```

---

### Task 6: Deploy และตรวจจริงที่หน้างาน

> **ห้ามมอบ task นี้ให้ subagent** — แตะ production (deploy จริง + SSH) ต้องรันจาก session หลักและถามเจ้าของก่อนยิง `deploy-api.sh` ทุกครั้ง

**Files:** ไม่มีการแก้ไฟล์ — เป็นขั้นตรวจรับ

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า

- [ ] **Step 1: ตรวจ syntax และเทสต์ครบก่อน deploy**

```bash
python3 -c "import ast; ast.parse(open('server/order_api.py').read()); print('order_api.py OK')"
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: OK + PASS ทั้งสองชุด

- [ ] **Step 2: Deploy เฉพาะ order-api**

```bash
bash deploy-api.sh
```
Expected: จบด้วย `✓ Done! order-api redeployed.` (order-api restart ~3-5 วินาที su-store ไม่ถูกแตะ)

- [ ] **Step 3: ตรวจว่าเซิร์ฟเวอร์ตอบปกติ**

```bash
ssh park@arch.sumfu.xyz 'docker exec su-order-api python3 -c "
import urllib.request
print(urllib.request.urlopen(\"http://127.0.0.1:10000/health\", timeout=10).read())
"'
```
Expected: `b'{\"status\": \"ok\"}'`

- [ ] **Step 4: ตรวจด้วยมือทั้ง 5 ข้อ**

1. claim station เปิดออเดอร์ phase 1 ที่มีบัตรและรับของไปนานแล้ว → เห็น panel **สีส้ม** + บรรทัด "รับของไปแล้วเมื่อ ..." + กดปุ่มแล้วต้องมี dialog ยืนยัน
2. กดยืนยัน → สำเร็จ แล้วเช็คว่าคิว khantok ขึ้นที่ `/display2` หนึ่งแถว
3. กดรับบัตรออเดอร์เดิมซ้ำ → ขึ้น "รับบัตรไปแล้ว" (409) ปุ่มกลับมากดได้
4. ออเดอร์ที่เพิ่งกดรับของเมื่อครู่ (วันนี้) → panel เป็น**สีเขียว** ไม่มีคำเตือน ไม่ต้องยืนยันสองชั้น
5. admin กดชิป PHASE สลับไปมา → การ์ด "บัตรขันโตกที่แจกแล้ว" กับ "รับบัตร ยังไม่รับของ" ขยับตาม phase และแถบ Prev/Next อยู่เหนือตาราง

- [ ] **Step 5: Push**

```bash
git push origin $(git rev-parse --abbrev-ref HEAD)
```

---

## หมายเหตุที่เจอระหว่างวางแผน (ไม่อยู่ในขอบเขต)

- `CLAUDE.md` ระบุว่า `created_at` เก็บเป็น UTC เสมอ แต่ข้อมูลจริงในตารางเป็น `2026-07-07T19:48:02+07:00` (มี offset) เพราะ `now_iso()` คืนเวลาแบบ Bangkok-aware ส่วนแถวยุคเก่ากับ fixture ในเทสต์เป็น `Z` — ควรตามไปแก้เอกสารและตรวจจุดที่บวก +7 ซ้ำในหน้าอื่น แยกเป็นงานต่างหาก
- โค้ดฟอร์แมตเวลาแบบบวก 7 ชั่วโมงแล้วอ่านด้วย getter ของ local time ยังมีอยู่ในไฟล์ template อื่น — Task 3 แก้เฉพาะใน `claim_station.html` เท่านั้น
