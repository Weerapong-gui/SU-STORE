# Phase-4 Khantok Ticket Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase-4 orders get a separate "รับบัตรขันโตก" button at the claim station that marks the ticket as station-claimed and enqueues the khantok queue row, independent of the merchandise receive flow, without touching the ticket quota.

**Architecture:** Add a nullable `khantok_station_claimed_at` column to `orders` (additive migration). Extract the khantok block of `enqueue_display2()` into `enqueue_display2_khantok()`; `enqueue_display2()` skips it for phase-4 orders. A new testable core function `mark_khantok_station_claimed()` backs a new `PATCH /claim-station/orders/{code}/khantok-claimed` endpoint. Claim-station UI shows a claim panel for phase-4 ticketed orders; admin edit form gets a third toggle mapped through `update_order_fields()`.

**Tech Stack:** Python raw `http.server` (`server/order_api.py`), SQLite, vanilla-JS HTML templates (`server/templates/*.html`), pytest/unittest.

**Spec:** `docs/superpowers/specs/2026-07-19-khantok-phase4-claim-design.md`

## Global Constraints

- Never write to `khantok_ticket_claims` from any new code path — quota must not change.
- Do not modify existing order-write SQL or existing schema columns; the only schema change is `ALTER TABLE orders ADD COLUMN khantok_station_claimed_at TEXT`.
- `khantok_ticket_claimed_at` (existing column) means "ticket issued / quota consumed" — never reuse it for station claiming.
- Phases 1–3 behavior must be byte-for-byte unchanged (khantok row still enqueued on normal receive).
- HTML/JS changes go in the template files, never in `order_api.py`.
- Every user-derived value concatenated into HTML must be wrapped in `esc()`.
- All timestamps stored via `now_iso()` (UTC); display side adds +7h.
- Run `python3 -c "import ast; ast.parse(open('server/order_api.py').read())"` before every commit that touches `order_api.py`.
- Test commands run from repo root: `/Users/park/SU-STORE`.
- Before any pytest run or local import of `order_api`, export `ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets` — importing `order_api` mkdirs those paths and the default `/var/data/...` hits PermissionError locally.
- Run repo tests and server tests as **separate** pytest invocations (`pytest tests/ -q` then `pytest server/tests/ -q`) — collecting both in one command fails with a `tests` module-name collision (pre-existing; CI also runs them separately).

---

### Task 1: DB migration + serializer field

**Files:**
- Modify: `server/order_api.py` (migration block near line 358-361; `serialize_order()` near line 983-989)
- Test: `tests/test_khantok_claim.py` (create)

**Interfaces:**
- Produces: `orders.khantok_station_claimed_at` (TEXT, NULL) column; `serialize_order()` output key `khantokStationClaimedAt` (string | null). Also produces the `temp_db` pytest fixture used by Tasks 3–4.

- [ ] **Step 1: Write the failing test**

Create `tests/test_khantok_claim.py`:

```python
"""Integration tests for the phase-4 khantok station-claim flow.

Uses a real schema via ensure_db() pointed at a pytest tmp_path.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

# Stub out OCR module so order_api imports cleanly even without Tesseract
from unittest.mock import MagicMock
sys.modules.setdefault("ocr", MagicMock())

import order_api


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(order_api, "DB_PATH", tmp_path / "orders.db")
    monkeypatch.setattr(order_api, "SLIPS_DIR", tmp_path / "slips")
    monkeypatch.setattr(order_api, "PRODUCT_IMAGES_DIR", tmp_path / "product-images")
    order_api.ensure_db()
    connection = order_api.open_db()
    yield connection
    connection.close()


class TestStationClaimedColumn:
    def test_column_exists_after_ensure_db(self, temp_db):
        columns = {
            row["name"]
            for row in temp_db.execute("PRAGMA table_info(orders)").fetchall()
        }
        assert "khantok_station_claimed_at" in columns

    def test_serializer_exposes_station_claimed_at(self, temp_db):
        temp_db.execute(
            "INSERT INTO orders (round_number, status, payment_status, created_at, updated_at,"
            " order_code, khantok_station_claimed_at)"
            " VALUES (4, 'paid', 'paid', '2026-07-19T00:00:00Z', '2026-07-19T00:00:00Z',"
            " 'FP2899994', '2026-07-19T05:00:00Z')"
        )
        row = order_api.fetch_order_by_code(temp_db, "FP2899994")
        data = order_api.serialize_order(row)
        assert data["khantokStationClaimedAt"] == "2026-07-19T05:00:00Z"
```

Note: if the bare `INSERT INTO orders` in the second test fails with `NOT NULL constraint failed` on some column, add that column with an empty-string/zero value to the INSERT until it passes — do NOT touch the real schema. (`open_db()` must return connections with `row_factory = sqlite3.Row`; it already does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: both tests FAIL — first with `assert 'khantok_station_claimed_at' in {...}`, second with `KeyError` / missing column.

- [ ] **Step 3: Add the migration**

In `server/order_api.py`, find this block inside `ensure_db()` (near line 358):

```python
      if "khantok_ticket_already_claimed" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_already_claimed INTEGER NOT NULL DEFAULT 0")
      if "khantok_ticket_value" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_value INTEGER")
```

Add directly after it:

```python
      if "khantok_station_claimed_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_station_claimed_at TEXT")
```

(Match the indentation of the neighboring `if` blocks exactly.)

- [ ] **Step 4: Add the serializer field**

In `serialize_order()` (near line 988), find:

```python
        "khantokTicketAlreadyClaimed": bool(row["khantok_ticket_already_claimed"]) if "khantok_ticket_already_claimed" in row_keys else False,
```

Add directly after it:

```python
        "khantokStationClaimedAt": (
            row["khantok_station_claimed_at"]
            if "khantok_station_claimed_at" in row_keys
            else None
        ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: 2 PASS

- [ ] **Step 6: Syntax check + full suite**

Run: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())" && export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q`
Expected: no syntax error, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/order_api.py tests/test_khantok_claim.py
git commit -m "feat(khantok): add khantok_station_claimed_at column + serializer field"
```

---

### Task 2: Extract `enqueue_display2_khantok()` + phase-4 skip

**Files:**
- Modify: `server/order_api.py:196-275` (`enqueue_display2`)
- Test: `tests/test_display2.py` (extend)

**Interfaces:**
- Produces: `enqueue_display2_khantok(connection, order_row, claim_user) -> int` (1 if the khantok row was inserted, else 0). `enqueue_display2()` keeps its signature and return type but no longer inserts the khantok row when `order_row["round_number"] == 4`.

- [ ] **Step 1: Extend the fake schema in `tests/test_display2.py`**

In `_make_conn()`, replace:

```python
            student_code TEXT NOT NULL DEFAULT '',
            nickname TEXT NOT NULL DEFAULT '',
            full_name TEXT NOT NULL DEFAULT ''
        );
```

with:

```python
            student_code TEXT NOT NULL DEFAULT '',
            nickname TEXT NOT NULL DEFAULT '',
            full_name TEXT NOT NULL DEFAULT '',
            khantok_ticket INTEGER NOT NULL DEFAULT 0,
            khantok_ticket_value INTEGER,
            round_number INTEGER NOT NULL DEFAULT 1
        );
```

Existing tests keep passing: default `khantok_ticket=0` reproduces the old "no khantok columns" behavior.

- [ ] **Step 2: Write the failing tests**

Append to `tests/test_display2.py` (before the `if __name__ == "__main__":` block):

```python
class KhantokEnqueueTest(unittest.TestCase):
    ITEMS = [{"slug": "single", "size": "M", "quantity": 1}]

    def test_phase4_receive_skips_khantok_row(self):
        conn = _make_conn()
        row = _insert_order(conn, "FP280014", self.ITEMS,
                            khantok_ticket=1, khantok_ticket_value=100, round_number=4)
        order_api.enqueue_display2(conn, row, "staff1")
        stations = [r["station"] for r in conn.execute(
            "SELECT station FROM display2_picks WHERE order_code=?", ("FP280014",)
        ).fetchall()]
        self.assertEqual(stations, ["polo"])  # product row only, no khantok

    def test_other_phase_receive_still_enqueues_khantok(self):
        conn = _make_conn()
        row = _insert_order(conn, "FP280013", self.ITEMS,
                            khantok_ticket=1, khantok_ticket_value=50, round_number=3)
        order_api.enqueue_display2(conn, row, "staff1")
        stations = sorted(r["station"] for r in conn.execute(
            "SELECT station FROM display2_picks WHERE order_code=?", ("FP280013",)
        ).fetchall())
        self.assertEqual(stations, ["khantok", "polo"])

    def test_helper_inserts_khantok_row_idempotently(self):
        conn = _make_conn()
        row = _insert_order(conn, "FP280015", self.ITEMS,
                            khantok_ticket=1, khantok_ticket_value=100, round_number=4)
        first = order_api.enqueue_display2_khantok(conn, row, "staff1")
        second = order_api.enqueue_display2_khantok(conn, row, "staff1")
        self.assertEqual((first, second), (1, 0))
        picked = conn.execute(
            "SELECT station, item_index, size FROM display2_picks WHERE order_code=?",
            ("FP280015",),
        ).fetchall()
        self.assertEqual(len(picked), 1)
        self.assertEqual(picked[0]["station"], "khantok")
        self.assertEqual(picked[0]["item_index"], -1)
        self.assertEqual(picked[0]["size"], "฿100")

    def test_helper_returns_zero_without_ticket(self):
        conn = _make_conn()
        row = _insert_order(conn, "FP280016", self.ITEMS,
                            khantok_ticket=0, round_number=4)
        self.assertEqual(order_api.enqueue_display2_khantok(conn, row, "staff1"), 0)
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `python3 -m pytest tests/test_display2.py -v`
Expected: `test_phase4_receive_skips_khantok_row` FAILS (khantok row present), `test_helper_*` FAIL with `AttributeError: ... has no attribute 'enqueue_display2_khantok'`. All pre-existing tests PASS.

- [ ] **Step 4: Implement the split**

In `server/order_api.py`, replace the tail of `enqueue_display2()` — this exact block (lines ~248-275):

```python
    row_keys = order_row.keys() if hasattr(order_row, "keys") else []
    has_kt = "khantok_ticket" in row_keys and int(order_row["khantok_ticket"] or 0) == 1
    if has_kt:
        kt_idx = -1
        exists_kt = connection.execute(
            "SELECT 1 FROM display2_picks WHERE order_internal_id=? AND item_index=?",
            (order_row["internal_id"], kt_idx),
        ).fetchone()
        if not exists_kt:
            kt_value = 0
            if "khantok_ticket_value" in row_keys:
                kt_value = int(order_row["khantok_ticket_value"] or 0)
            kt_size = f"฿{kt_value}" if kt_value else "บัตร"
            connection.execute(
                """INSERT INTO display2_picks
                   (order_internal_id, order_code, item_index, station,
                    product_slug, product_name, size, quantity,
                    student_code, nickname, full_name, queued_at, queued_by)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (order_row["internal_id"], order_row["order_code"], kt_idx, "khantok",
                 "khantok", "บัตรขันโตก", kt_size, 1,
                 order_row["student_code"], order_row["nickname"], order_row["full_name"],
                 now, claim_user),
            )
            inserted += 1
            log_audit(connection, order_row["order_code"],
                      "display2_enqueued", f"station=khantok value={kt_value}")
    return inserted
```

with:

```python
    row_keys = order_row.keys() if hasattr(order_row, "keys") else []
    round_number = int(order_row["round_number"] or 0) if "round_number" in row_keys else 0
    if round_number != 4:
        # Phase 4 hands out the khantok ticket via its own claim-station button;
        # every other phase keeps enqueueing it together with the merchandise.
        inserted += enqueue_display2_khantok(connection, order_row, claim_user)
    return inserted


def enqueue_display2_khantok(connection, order_row, claim_user) -> int:
    """Insert the khantok-station pick row (item_index -1) for a ticketed order.
    Idempotent on (order_internal_id, -1). Returns 1 if a row was inserted, else 0."""
    row_keys = order_row.keys() if hasattr(order_row, "keys") else []
    has_kt = "khantok_ticket" in row_keys and int(order_row["khantok_ticket"] or 0) == 1
    if not has_kt:
        return 0
    kt_idx = -1
    exists_kt = connection.execute(
        "SELECT 1 FROM display2_picks WHERE order_internal_id=? AND item_index=?",
        (order_row["internal_id"], kt_idx),
    ).fetchone()
    if exists_kt:
        return 0
    kt_value = 0
    if "khantok_ticket_value" in row_keys:
        kt_value = int(order_row["khantok_ticket_value"] or 0)
    kt_size = f"฿{kt_value}" if kt_value else "บัตร"
    connection.execute(
        """INSERT INTO display2_picks
           (order_internal_id, order_code, item_index, station,
            product_slug, product_name, size, quantity,
            student_code, nickname, full_name, queued_at, queued_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (order_row["internal_id"], order_row["order_code"], kt_idx, "khantok",
         "khantok", "บัตรขันโตก", kt_size, 1,
         order_row["student_code"], order_row["nickname"], order_row["full_name"],
         now_iso(), claim_user),
    )
    log_audit(connection, order_row["order_code"],
              "display2_enqueued", f"station=khantok value={kt_value}")
    return 1
```

Note the helper uses `now_iso()` directly (the `now` local from `enqueue_display2` is not in scope).

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_display2.py -v`
Expected: all PASS (old + 4 new).

- [ ] **Step 6: Syntax check + full suite**

Run: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())" && export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/order_api.py tests/test_display2.py
git commit -m "feat(khantok): split khantok enqueue helper, skip on phase-4 receive"
```

---

### Task 3: `mark_khantok_station_claimed()` core + PATCH endpoint

**Files:**
- Modify: `server/order_api.py` (new function after `enqueue_display2_khantok`; new route in `do_PATCH` after the `/received` block near line 4040)
- Test: `tests/test_khantok_claim.py` (extend)

**Interfaces:**
- Consumes: `enqueue_display2_khantok()` (Task 2), `khantok_station_claimed_at` column (Task 1).
- Produces: `mark_khantok_station_claimed(connection, order_code, claim_user) -> tuple[int, dict]` returning `(http_status, response_body)`; route `PATCH /claim-station/orders/{code}/khantok-claimed` with `Authorization: Claim <token>`, body `{"claimedBy": "..."}`, responses 200 `{"order": {...}}` / 400 / 404 / 409 `{"message", "claimedAt", "alreadyClaimed"}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_khantok_claim.py`:

```python
def _order_payload(student_code="6935001234", slug="single"):
    product = {
        "slug": slug, "name": "FRESHER POLO SHIRT", "shortName": "POLO",
        "tagline": "x", "price": 399, "image": "/p.png", "category": "shirt",
    }
    return {
        "product": product,
        "customer": {
            "studentCode": student_code, "email": "a@b.c", "fullName": "Test User",
            "phone": "0800000000", "school": "MFU", "parentPhone": "0811111111",
        },
        "size": "M", "quantity": 1, "totalAmount": 399,
        "items": [{"product": product, "size": "M", "quantity": 1,
                   "unitPrice": 399, "totalAmount": 399}],
    }


def _create_phase4_order(connection, student_code="6935001234", status="paid"):
    connection.execute(
        "INSERT OR REPLACE INTO site_settings (key, value) VALUES ('phase_override', '4')"
    )
    validated, error = order_api.validate_order_payload(_order_payload(student_code))
    assert error is None, error
    order = order_api.create_order(connection, validated)
    connection.execute(
        "UPDATE orders SET status=?, payment_status='paid' WHERE order_code=?",
        (status, order["id"]),
    )
    connection.commit()
    return order["id"]


def _quota_count(connection):
    return connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims"
    ).fetchone()["c"]


class TestMarkKhantokStationClaimed:
    def test_success_sets_timestamp_enqueues_and_keeps_quota(self, temp_db):
        code = _create_phase4_order(temp_db)
        quota_before = _quota_count(temp_db)
        status, body = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        temp_db.commit()
        assert status == 200
        assert body["order"]["khantokStationClaimedAt"]
        picks = temp_db.execute(
            "SELECT station, item_index FROM display2_picks WHERE order_code=?", (code,)
        ).fetchall()
        assert [(p["station"], p["item_index"]) for p in picks] == [("khantok", -1)]
        assert _quota_count(temp_db) == quota_before

    def test_double_claim_returns_409(self, temp_db):
        code = _create_phase4_order(temp_db)
        order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        status, body = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 409
        assert body["claimedAt"]

    def test_order_without_ticket_returns_400(self, temp_db):
        # student code without the 693 prefix -> no ticket reserved
        code = _create_phase4_order(temp_db, student_code="6805001234")
        status, _ = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 400

    def test_unpaid_order_returns_400(self, temp_db):
        code = _create_phase4_order(temp_db, status="pending_payment")
        status, _ = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 400

    def test_unknown_order_returns_404(self, temp_db):
        status, _ = order_api.mark_khantok_station_claimed(temp_db, "FP2800000", "staff1")
        assert status == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: new tests FAIL with `AttributeError: ... has no attribute 'mark_khantok_station_claimed'`; Task-1 tests still PASS.

- [ ] **Step 3: Implement the core function**

In `server/order_api.py`, add directly after `enqueue_display2_khantok()`:

```python
def mark_khantok_station_claimed(
    connection: sqlite3.Connection, order_code: str, claim_user: str
) -> tuple[int, dict[str, Any]]:
    """Mark a ticketed order's khantok ticket as claimed at the claim station and
    enqueue its khantok pick row. Never touches khantok_ticket_claims (quota).
    Returns (http_status, response_body). Does not commit."""
    existing = fetch_order_by_code(connection, order_code)
    if existing is None:
        return HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"}
    row_keys = existing.keys()
    has_ticket = "khantok_ticket" in row_keys and int(existing["khantok_ticket"] or 0) == 1
    if not has_ticket:
        return HTTPStatus.BAD_REQUEST, {"message": "ออเดอร์นี้ไม่มีบัตรขันโตก"}
    if existing["status"] in ("pending_payment", "waiting_confirm", "cancelled", "rejected"):
        return HTTPStatus.BAD_REQUEST, {
            "message": f"ออเดอร์มีสถานะ '{existing['status']}' ยังไม่พร้อมรับบัตร"
        }
    already = (
        existing["khantok_station_claimed_at"]
        if "khantok_station_claimed_at" in row_keys else None
    )
    if already:
        return HTTPStatus.CONFLICT, {
            "message": "รับบัตรขันโตกไปแล้ว", "claimedAt": already, "alreadyClaimed": True,
        }
    ts = now_iso()
    connection.execute(
        "UPDATE orders SET khantok_station_claimed_at=?, updated_at=? WHERE order_code=?",
        (ts, ts, order_code),
    )
    log_audit(connection, order_code, "khantok_claimed", f"claimed by {claim_user}")
    updated_row = fetch_order_by_code(connection, order_code)
    try:
        enqueue_display2_khantok(connection, updated_row, claim_user)
    except Exception as exc:
        log_audit(connection, order_code,
                  "display2_enqueue_failed", f"{type(exc).__name__}: {exc}")
    return HTTPStatus.OK, {"order": serialize_order(updated_row)}
```

(`HTTPStatus` members compare equal to their int codes, so `status == 200` in tests works.)

- [ ] **Step 4: Wire the route**

In `do_PATCH` (near line 4040), directly after the `/received` block's `return` and before `claim_name_match = ...`, add:

```python
        khantok_claim_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)/khantok-claimed", path)
        if khantok_claim_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            order_code = khantok_claim_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                payload = {}
            claimed_by = (payload or {}).get("claimedBy", "") if isinstance(payload, dict) else ""
            with open_db() as connection:
                claim_user = self._get_claim_station_user() or claimed_by or "staff"
                status_code, body = mark_khantok_station_claimed(connection, order_code, claim_user)
                if status_code == HTTPStatus.OK:
                    connection.commit()
            cache_invalidate(f"cs_order:{order_code}")
            self._send_json(status_code, body)
            return
```

(Match the indentation of the neighboring route blocks in `do_PATCH`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: all PASS.

- [ ] **Step 6: Syntax check + full suite**

Run: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())" && export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/order_api.py tests/test_khantok_claim.py
git commit -m "feat(khantok): station-claim core function + PATCH endpoint"
```

---

### Task 4: Admin toggle backend — `update_order_fields()`

**Files:**
- Modify: `server/order_api.py:1411-1453` (`update_order_fields`, khantok block)
- Test: `tests/test_khantok_claim.py` (extend)

**Interfaces:**
- Consumes: `khantok_station_claimed_at` column (Task 1), `temp_db` fixture / `_create_phase4_order` helper (Tasks 1, 3).
- Produces: `update_order_fields()` accepts payload key `khantokStationClaimed: bool` — `true` sets `khantok_station_claimed_at = now_iso()` only when currently empty; `false` clears it to `NULL`; never writes `khantok_ticket_claims`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_khantok_claim.py`:

```python
class TestAdminStationClaimedToggle:
    def test_true_sets_timestamp_and_quota_unchanged(self, temp_db):
        code = _create_phase4_order(temp_db)
        quota_before = _quota_count(temp_db)
        result = order_api.update_order_fields(
            temp_db, code, {"khantokStationClaimed": True}
        )
        temp_db.commit()
        assert result not in (None, False)
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"]
        assert _quota_count(temp_db) == quota_before

    def test_true_again_does_not_overwrite_timestamp(self, temp_db):
        code = _create_phase4_order(temp_db)
        temp_db.execute(
            "UPDATE orders SET khantok_station_claimed_at='2026-07-01T00:00:00Z'"
            " WHERE order_code=?", (code,),
        )
        order_api.update_order_fields(temp_db, code, {"khantokStationClaimed": True})
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"] == "2026-07-01T00:00:00Z"

    def test_false_clears_timestamp(self, temp_db):
        code = _create_phase4_order(temp_db)
        temp_db.execute(
            "UPDATE orders SET khantok_station_claimed_at='2026-07-01T00:00:00Z'"
            " WHERE order_code=?", (code,),
        )
        order_api.update_order_fields(temp_db, code, {"khantokStationClaimed": False})
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: the 3 new tests FAIL (timestamp not set / not cleared); earlier tests PASS.

- [ ] **Step 3: Implement**

In `update_order_fields()`, find the end of the khantok block (near line 1453):

```python
        elif old_has_ticket and new_has_ticket and value_changed:
            # Ticket stays but value changed: update the claim record's ticket_value
            raw_val = fields["khantokTicketValue"]
            new_value = int(raw_val) if isinstance(raw_val, (int, float)) and raw_val is not None else None
            if new_value is not None:
                connection.execute(
                    "UPDATE khantok_ticket_claims SET ticket_value = ? WHERE order_id = ?",
                    (new_value, order_id),
                )
            allowed["khantok_ticket_value"] = new_value
```

Add directly after it (dedented to the same level as `if khantok_changed or value_changed or claimed_changed:`):

```python
    # Station claim state — independent of quota; never touches khantok_ticket_claims
    if "khantokStationClaimed" in fields and isinstance(fields["khantokStationClaimed"], bool):
        existing_station_claimed = (
            existing["khantok_station_claimed_at"]
            if "khantok_station_claimed_at" in existing.keys() else None
        )
        if fields["khantokStationClaimed"]:
            if not existing_station_claimed:
                allowed["khantok_station_claimed_at"] = now_iso()
        else:
            allowed["khantok_station_claimed_at"] = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_khantok_claim.py -v`
Expected: all PASS.

- [ ] **Step 5: Syntax check + full suite**

Run: `python3 -c "import ast; ast.parse(open('server/order_api.py').read())" && export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/order_api.py tests/test_khantok_claim.py
git commit -m "feat(khantok): admin khantokStationClaimed field in update_order_fields"
```

---

### Task 5: Claim-station UI — claim panel + `doClaimKhantok()`

**Files:**
- Modify: `server/templates/claim_station.html` (khantok badge block near line 1353-1355; new function next to `doReceive`)

**Interfaces:**
- Consumes: `PATCH /claim-station/orders/{code}/khantok-claimed` (Task 3); order JSON fields `roundNumber`, `khantokTicket`, `khantokTicketValue`, `khantokStationClaimedAt` (Task 1). Existing template helpers used as-is: `esc()`, `showOrderCard(order, opts)`, `refreshCurrentOrder()`, `setScanStatus(msg, cls)`, `showCsDialog(opts)`, `beepSuccess()`, `beepWarn()`, `beepError()`, `vibrate(ms)`, `doLogout()`, globals `currentToken`, `currentUser`, `currentStation`, icon string `IC_TICKET`.
- Produces: `doClaimKhantok(code)` global function; claim panel markup with button id `khantokClaimBtn`.

- [ ] **Step 1: Replace the khantok badge block**

In `server/templates/claim_station.html`, find (near line 1353):

```javascript
      if (order.khantokTicket) {
        khantok = '<div class="khantok-badge" style="display:flex;align-items:center;gap:4px">' + IC_TICKET + ' บัตรขันโตก' + (order.khantokTicketValue ? ' ฿' + order.khantokTicketValue : '') + khantokClaimedLine + '</div>';
      }
```

Replace with:

```javascript
      if (order.khantokTicket) {
        var ktLabel = ' บัตรขันโตก' + (order.khantokTicketValue ? ' ฿' + order.khantokTicketValue : '');
        if (Number(order.roundNumber) === 4 && !order.khantokStationClaimedAt) {
          khantok = '<div class="khantok-claim-panel" style="margin:8px 14px;padding:14px;border-radius:12px;background:var(--ok-bg);border:1.5px solid var(--ok)">' +
            '<div style="display:flex;align-items:center;gap:6px;font-weight:800;color:var(--ok);margin-bottom:10px">' + IC_TICKET + ktLabel + ' — ยังไม่ได้รับ</div>' +
            '<button id="khantokClaimBtn" class="btn-confirm" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px" onclick="doClaimKhantok(\'' + esc(order.id || '') + '\')">' + IC_TICKET + ' รับบัตรขันโตก</button></div>';
        } else if (Number(order.roundNumber) === 4 && order.khantokStationClaimedAt) {
          var ktWhen = '';
          try {
            var _kc = String(order.khantokStationClaimedAt).replace(' ', 'T');
            if (!_kc.endsWith('Z') && !_kc.includes('+')) _kc += 'Z';
            var kcd = new Date(new Date(_kc).getTime() + 7*3600000);
            if (!isNaN(kcd.getTime())) {
              ktWhen = ' เมื่อ ' + kcd.getDate() + '/' + (kcd.getMonth()+1) + ' ' + String(kcd.getHours()).padStart(2,'0') + ':' + String(kcd.getMinutes()).padStart(2,'0');
            }
          } catch(e) {}
          khantok = '<div class="khantok-badge" style="display:flex;align-items:center;gap:4px">' + IC_TICKET + ktLabel + ' — รับบัตรแล้ว' + ktWhen + '</div>';
        } else {
          khantok = '<div class="khantok-badge" style="display:flex;align-items:center;gap:4px">' + IC_TICKET + ktLabel + khantokClaimedLine + '</div>';
        }
      }
```

(Non-phase-4 branch is byte-identical to the old markup, `khantokClaimedLine` included.)

- [ ] **Step 2: Add `doClaimKhantok()`**

Directly after the closing `}` of the `doReceive` function (near line 1551), add:

```javascript
    async function doClaimKhantok(code) {
      var btn = document.getElementById('khantokClaimBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
      try {
        var r = await fetch('/claim-station/orders/' + encodeURIComponent(code) + '/khantok-claimed', {
          method: 'PATCH',
          headers: {'Authorization':'Claim ' + currentToken, 'Content-Type':'application/json'},
          body: JSON.stringify({claimedBy: (currentStation ? currentUser + ' (' + currentStation + ')' : currentUser)})
        });
        if (r.status === 401) { doLogout(); return; }
        var d = await r.json();
        if (!r.ok) {
          if (r.status === 409) {
            beepWarn();
            await showCsDialog({type:'alert',icon:'warn',title:'รับบัตรไปแล้ว',message:d.message || 'ออเดอร์นี้รับบัตรขันโตกไปแล้ว'});
            refreshCurrentOrder();
          } else {
            beepError();
            await showCsDialog({type:'alert',icon:'danger',title:'เกิดข้อผิดพลาด',message:d.message||'เกิดข้อผิดพลาด'});
            if (btn) { btn.disabled = false; btn.innerHTML = IC_TICKET + ' รับบัตรขันโตก'; }
          }
          return;
        }
        beepSuccess(); vibrate(80);
        showOrderCard(d.order, {silent: true});
        setScanStatus('รับบัตรขันโตกแล้ว — พร้อมสแกนต่อ', 'success');
      } catch(e) {
        beepError();
        await showCsDialog({type:'alert',icon:'danger',title:'เชื่อมต่อไม่ได้',message:'ไม่สามารถเชื่อมต่อได้'});
        if (btn) { btn.disabled = false; btn.innerHTML = IC_TICKET + ' รับบัตรขันโตก'; }
      }
    }
```

- [ ] **Step 3: Sanity checks**

Run:

```bash
grep -c "doClaimKhantok" server/templates/claim_station.html
grep -c "khantokStationClaimedAt" server/templates/claim_station.html
```

Expected: `doClaimKhantok` ≥ 2 (definition + onclick), `khantokStationClaimedAt` ≥ 2. Then extract and syntax-check the page's inline JS:

```bash
python3 - <<'EOF'
import re, subprocess, tempfile
html = open('server/templates/claim_station.html', encoding='utf-8').read()
scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
js = '\n'.join(scripts)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
    f.write(js); path = f.name
print(subprocess.run(['node', '--check', path], capture_output=True, text=True))
EOF
```

Expected: `returncode=0` (no `SyntaxError`). If `node` is unavailable, skip this sub-check.

- [ ] **Step 4: Run full test suite (regression)**

Run: `export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q`
Expected: all pass (template change shouldn't affect them; template must still load — `python3 -c "import sys; sys.path.insert(0,'server'); from unittest.mock import MagicMock; sys.modules['ocr']=MagicMock(); import order_api"` exits 0).

- [ ] **Step 5: Commit**

```bash
git add server/templates/claim_station.html
git commit -m "feat(khantok): claim-station phase-4 ticket claim panel + doClaimKhantok"
```

---

### Task 6: Admin UI — third toggle "รับแล้ว (station)"

**Files:**
- Modify: `server/templates/admin.html` (edit-form markup near line 762-769; populate near line 1776-1778; save payload near line 2048-2050)

**Interfaces:**
- Consumes: order JSON field `khantokStationClaimedAt` (Task 1); `update_order_fields()` payload key `khantokStationClaimed` (Task 4).
- Produces: checkbox `#oe_khantokStationClaimed` in the KHANTOK TICKET section.

- [ ] **Step 1: Add the toggle markup**

In `server/templates/admin.html`, find (near line 762):

```html
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:14px;font-weight:600;color:var(--text)">Already claimed</label>
          <label class="toggle">
            <input type="checkbox" id="oe_khantokClaimed" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
```

Add directly after that `</div>`:

```html
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:14px;font-weight:600;color:var(--text)">รับแล้ว (station)</label>
          <label class="toggle">
            <input type="checkbox" id="oe_khantokStationClaimed" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
```

- [ ] **Step 2: Populate on edit-form open**

Find (near line 1777):

```javascript
      document.querySelector("#oe_khantokClaimed").checked = !!order.khantokTicketAlreadyClaimed;
```

Add directly after it:

```javascript
      document.querySelector("#oe_khantokStationClaimed").checked = !!order.khantokStationClaimedAt;
```

- [ ] **Step 3: Send on save**

Find (near line 2049):

```javascript
        khantokTicketAlreadyClaimed: document.querySelector("#oe_khantokClaimed").checked,
```

Add directly after it:

```javascript
        khantokStationClaimed: document.querySelector("#oe_khantokStationClaimed").checked,
```

- [ ] **Step 4: Sanity check**

Run: `grep -c "oe_khantokStationClaimed" server/templates/admin.html`
Expected: `3` (markup + populate + save). Template still loads: `python3 -c "import sys; sys.path.insert(0,'server'); from unittest.mock import MagicMock; sys.modules['ocr']=MagicMock(); import order_api"` exits 0.

- [ ] **Step 5: Commit**

```bash
git add server/templates/admin.html
git commit -m "feat(khantok): admin edit-form station-claimed toggle"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + syntax**

```bash
python3 -c "import ast; ast.parse(open('server/order_api.py').read())"
export ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets; python3 -m pytest tests/ -q && python3 -m pytest server/tests/ -q
```

Expected: all pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin fix/khantok-station
```

- [ ] **Step 3: Deploy note (manual, when ready)**

Only `server/` changed → deploy with `bash deploy-api.sh` (order-api restart ~3-5 s, su-store untouched). After ~30 s verify: search a phase-4 ticketed order at `/claim-station` → claim panel shows; press รับบัตรขันโตก → row appears on `/display2` khantok station; quota numbers in admin Analytics unchanged.
