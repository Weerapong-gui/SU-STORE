# /display2 — Per-Station Fulfillment Display

**Status:** Design approved 2026-06-25
**Target service:** `su-order-api` (`server/order_api.py`)
**Public URL:** `https://admin.sumfu.xyz/display2`

## 1. Purpose

Internal fulfillment screen for the three product pickup stations (Polo / Jacket / Headband). When the claim-station admin marks an order received and prints its receipt, every item in that order is pushed to the queue of its corresponding product station. Workers at each station tap a check button to confirm they have handed the item to the customer.

Not customer-facing. Not a replacement for the existing `/display1` customer screen — they coexist.

## 2. Scope decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Station model | 3 fixed stations bound to `product_slug` (`single → polo`, `jacket → jacket`, `headband → headband`) |
| Multi-item order | Split per item — one queue entry per item per station |
| Auth | Reuse claim-station login; same Users tab adds/removes access |
| Queue sync | Shared queue per station, all workers see same view (poll every 2s) |
| Check action | Mark picked, remove from active queue, write audit log line |
| History | Per-station, today only, with search (order code / student code / nickname) and 1-hour undo window |
| Push trigger | On `POST /claim-station/orders/<code>/received` (server-side hook); receipt print is a client-side consequence of the same flow |
| Storage | DB-backed (new `display2_picks` table) — survives `deploy-api.sh` restart |
| Sync mechanism | HTTP polling every 2s (raw `http.server`, no SSE) |
| UX extras | Chime on new arrival (mute toggle in localStorage), queue counter, large size badges, student code + nickname displayed prominently |
| Student photo | Not available in DB — display student_code + nickname instead |

## 3. Architecture

```
[claim-station UI]                              [display2 UI]
   tap "ยืนยันรับสินค้า"                          polls 2s
        │                                            ▲
        ▼                                            │
  POST /claim-station/orders/<code>/received         │
        │                                            │
        ├─ existing: orders.status='received'        │
        └─ new hook: enqueue_display2(order)         │
                INSERT display2_picks per item ──────┘

   tap [✓ เช็ค]                       POST /display2/pick {pick_id}
                                          → UPDATE picked_at, picked_by
                                          → audit log
   tap [↶ undo] in history modal     POST /display2/undo {pick_id}
                                          → UPDATE undone_at, clear picked_at
                                          → audit log
```

## 4. Components

### 4.1 Frontend — `server/templates/display2.html`

Single-page app, three screens (login → station picker → queue view) styled to match `display.html` / `claim_station.html`.

```
Login screen
  Username + password → /claim-station/login (existing endpoint)
  Token saved to sessionStorage; auto-reused on refresh.

Station picker
  Three big tap targets: 🧥 POLO · 🧷 JACKET · 🎀 HEADBAND
  Selection saved to sessionStorage (key: display2Station)
  Logout button on footer.

Queue view (work screen)
  Header: station name, queue counter, today picked count, logout, fullscreen toggle.
  Body: FIFO list (oldest top), each card shows
    - Order code (FP28xxxx)
    - Large size badge (S/M/L/XL/XXL)
    - quantity
    - Student code (e.g. 6931501178)
    - Nickname (large)
    - [✓ เช็ค] button (full-width tap target)
  New arrivals: chime + slide-in animation.
  Empty: large logo-FP.png + station name + "รอออเดอร์..." with pulsing dot.
  Footer: [📜 ประวัติวันนี้] button, [🔇 mute] toggle (persisted in localStorage).

History modal
  Search bar (order code / student code / nickname).
  List of today's picks for this station, newest top:
    HH:MM · FP28xxxx · nickname · size · picked by <user>  [↶ undo]
  Undo button shown only when picked_at within last 1 hour.
```

Note for implementation: the emoji icons above are placeholders in this design only. Per project memory, the actual UI must use inline SVG icons, never emoji.

### 4.2 Backend endpoints (added to `server/order_api.py`)

All require `_has_claim_station_authorization()` except the page route.

| Method | Path | Body / Query | Response |
|--------|------|--------------|----------|
| GET | `/display2` | — | `DISPLAY2_HTML` |
| GET | `/display2/queue?station=polo\|jacket\|headband` | — | `{"items": [...]}` |
| GET | `/display2/history?station=X[&q=]` | optional search query | `{"items": [...]}` today only (Bangkok TZ) |
| POST | `/display2/pick` | `{"pick_id": <int>}` | `{"ok": true}` or `{"ok": false, "reason": "already_picked", "picked_by": "..."}` |
| POST | `/display2/undo` | `{"pick_id": <int>}` | `{"ok": true}` or `{"ok": false, "reason": "window_expired"}` |

Hook inside existing `POST /claim-station/orders/<code>/received` handler:
- After the existing UPDATE that flips `status='received'` succeeds, call `enqueue_display2(connection, order_row, claim_user)` within the same DB transaction.

### 4.3 Database — new table

```sql
CREATE TABLE IF NOT EXISTS display2_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_internal_id INTEGER NOT NULL,
    order_code TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    station TEXT NOT NULL,                 -- 'polo' | 'jacket' | 'headband'
    product_slug TEXT NOT NULL,
    product_name TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    student_code TEXT NOT NULL,
    nickname TEXT NOT NULL,
    full_name TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    queued_by TEXT NOT NULL,
    picked_at TEXT,
    picked_by TEXT,
    undone_at TEXT,
    FOREIGN KEY (order_internal_id) REFERENCES orders(internal_id)
);
CREATE INDEX IF NOT EXISTS idx_display2_picks_station_active
    ON display2_picks(station, picked_at, undone_at);
CREATE INDEX IF NOT EXISTS idx_display2_picks_order
    ON display2_picks(order_internal_id);
```

Station mapping (Python constant):
```python
STATION_BY_SLUG = {
    "single": "polo",
    "jacket": "jacket",
    "headband": "headband",
}
```

## 5. Data flow

### 5.1 Enqueue (`/received` hook)

```python
def enqueue_display2(connection, order_row, claim_user):
    items = json.loads(order_row["items_json"] or "[]")
    if not items:
        # legacy single-item fallback
        items = [{
            "slug": order_row["product_slug"],
            "name": order_row["product_name"],
            "size": order_row["size"],
            "quantity": order_row["quantity"],
        }]
    now = now_iso()
    for idx, item in enumerate(items):
        slug = (item.get("slug") or "").lower()
        station = STATION_BY_SLUG.get(slug)
        if not station:
            log_audit(connection, order_row["order_code"],
                      "display2_skipped", f"slug={slug}")
            continue
        exists = connection.execute(
            "SELECT 1 FROM display2_picks WHERE order_internal_id=? AND item_index=?",
            (order_row["internal_id"], idx),
        ).fetchone()
        if exists:
            continue
        connection.execute(
            """INSERT INTO display2_picks
               (order_internal_id, order_code, item_index, station,
                product_slug, product_name, size, quantity,
                student_code, nickname, full_name, queued_at, queued_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (order_row["internal_id"], order_row["order_code"], idx, station,
             slug, item.get("name", ""), item.get("size", ""), int(item.get("quantity", 1)),
             order_row["student_code"], order_row["nickname"], order_row["full_name"],
             now, claim_user),
        )
        log_audit(connection, order_row["order_code"],
                  "display2_enqueued", f"station={station} item={idx}")
```

### 5.2 Queue read

```sql
SELECT id, order_code, size, quantity, student_code, nickname,
       queued_at, undone_at
  FROM display2_picks
 WHERE station = ?
   AND picked_at IS NULL
 ORDER BY queued_at ASC
 LIMIT 50;
```

"Active in queue" is defined solely as `picked_at IS NULL`. A row that was picked and then undone returns to this set because undo clears `picked_at` while leaving `undone_at` set as a forensic marker. The UI shows a small "↺ undo" badge when `undone_at IS NOT NULL`, so workers know the item was reopened.

Client diffs by `id` to detect new arrivals → trigger chime + slide-in animation.

### 5.3 Pick

```sql
UPDATE display2_picks
   SET picked_at = ?, picked_by = ?
 WHERE id = ? AND picked_at IS NULL;
```

If rowcount == 0, fetch and return `picked_by` for the conflict toast.

### 5.4 Undo

```sql
UPDATE display2_picks
   SET undone_at = ?, picked_at = NULL, picked_by = NULL
 WHERE id = ?
   AND picked_at IS NOT NULL
   AND picked_at >= datetime('now', '-1 hour');
```

The row becomes active again because `picked_at` is now NULL. `undone_at` is kept as forensic evidence (visible in admin Audit Log).

### 5.5 History

```sql
SELECT id, order_code, size, nickname, student_code,
       picked_at, picked_by, undone_at
  FROM display2_picks
 WHERE station = ?
   AND DATE(picked_at, '+7 hours') = DATE('now', '+7 hours')
   AND (
        ? = ''
     OR order_code LIKE ?
     OR student_code LIKE ?
     OR nickname LIKE ?
   )
 ORDER BY picked_at DESC
 LIMIT 200;
```

Search input is trimmed; `%` wildcards bound on both sides server-side.

## 6. Error handling

| Failure | Behavior |
|---------|----------|
| Network drop during poll | Red banner "ขาดการเชื่อมต่อ..."; preserve last queue render; exponential backoff (2 → 4 → 8 s cap) |
| 401 from any endpoint | Drop token, redirect to login; sessionStorage station survives so re-login lands back on same queue |
| Pick conflict (rowcount 0) | Yellow toast "หยิบไปแล้วโดย <picked_by>"; immediate refresh |
| Unknown station in URL | Force back to station picker |
| `slug` not in `STATION_BY_SLUG` (e.g. future product) | Skip silently in enqueue loop; write `display2_skipped` audit row |
| DB write fails inside enqueue | Caught and logged (`display2_enqueue_failed` audit); `/received` still succeeds so claim-station is not blocked |
| Empty `items_json` (legacy row) | Synthesize one item from `product_slug + size + quantity` |
| Browser blocks autoplay chime | Audio unlocked on first user gesture (station tap); chimes silent until then |
| Undo window expired | 422 + message "เกินเวลา undo (1 ชม)" |

## 7. Testing

Manual checklist — no automated suite exists.

1. Login → station picker shows 3 cards.
2. Pick Polo, refresh page → still on Polo queue view.
3. From claim-station, mark received an order containing polo+jacket+headband → all 3 stations show 1 entry each within 2 s.
4. Polo-only order → only Polo station populates.
5. Two browsers on Polo: A picks an item → B's queue removes it within 2 s.
6. Pick → open history → undo → item reappears in active queue.
7. Two tabs tap the check on same item: only one succeeds, the other shows the conflict toast.
8. Disconnect wifi for 10 s → banner appears, queue stays; reconnect → recovers silently.
9. History search by order code prefix, by student code "693…", by nickname substring.
10. Chime fires only for new `id`s, not on every poll. Mute toggle persists across refresh.
11. Restart `order-api` container mid-shift via `bash deploy-api.sh`: display2 page reloads, queue intact.
12. Admin Audit Log tab shows `display2_enqueued`, `display2_picked`, `display2_undone`, `display2_skipped` entries.

Pre-deploy Python parse check:
```
python3 -c "import ast; ast.parse(open('server/order_api.py').read())"
```

Deploy script: `bash deploy-api.sh` (`order-api` only — no `su-store` rebuild).

## 8. Out of scope

- Per-worker assignment / "owned by" UI.
- Multi-day history (today only; older entries discoverable via admin Audit Log).
- Push notifications, SSE, or WebSocket. Polling at 2 s is sufficient for the expected ≤10 concurrent workers.
- Display2 user management UI separate from claim-station Users tab.
- Reprint receipt from display2 (still done from claim-station).
