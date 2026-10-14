# Store v2 Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can issue, reprint and cancel receipts for paid `SU…` orders from the new admin. Receipt numbers come from the server (`SU-R2569-0001`…). Admins position every field on a live preview that renders exactly like the print.

**Architecture:**
- Backend: a new `server/store/receipts.py` owns the numbering, snapshots and receipt settings. It has its own table plus a `store_counters` row, and never touches order rows.
- Shared renderer: one pure TS module (`src/lib/receipt/`) builds the receipt SVG from `(template, layout, snapshot)`. The print page and the settings preview both call it, so preview equals print.
- Template: the store v2 template is a copy of `receipt_template.svg` with the baked-in payee name and signature removed.

**Tech Stack:** Python 3.11 raw-HTTP order-api + SQLite (WAL), pytest, ruff · Next.js 14 App Router, TypeScript, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-store-receipts-design.md`

**Who implements:** the user asked to split work with Codex. Codex (`codex exec`) does Tasks 1–3: backend and the pure TS renderer. Claude subagents do Tasks 4–7: UI, print and docs. Every task gets a Claude review.

## Global Constraints

- Follow CLAUDE.md §3.5. Every task ends green on all of these: `ruff check server tests`, `pytest server/tests`, `pytest tests`, `npm run lint` (in a worktree, set `COOKIE_SECRET=<32+ chars>`), `npx tsc --noEmit`, `npm test`.
- Never UPDATE or DELETE `store_orders` / `store_order_items`. Add only new tables. Back up the production DB with `sqlite3 .backup()` before deploy.
- Receipt numbers: `<prefix><seq:04d>`. The default prefix is `SU-R2569-` and the first number is `SU-R2569-0001`. There is one store-wide sequence that never resets, has no gaps and has no duplicates, even when two receipts are issued at the same time.
- Issue only for orders in status `paid`, `ready` or `completed`. Otherwise fail with `StoreError(400, "ออกใบเสร็จได้เฉพาะออเดอร์ที่ชำระเงินแล้ว")`.
- One active (non-cancelled) receipt per order. A reprint returns the same receipt and prints "สำเนา / COPY". Cancelling requires a reason.
- Permissions: any logged-in staff may issue and reprint. Cancelling and saving receipt settings require `is_superadmin`. The global `ORDER_API_TOKEN` also counts as superadmin.
- The snapshot is frozen at issue time: date (Bangkok), number, customer name, student code, school (as confirmed or typed by staff in the issue dialog), lines, total, total in Thai words, payee name, signature URL. A reprint uses the snapshot and the current layout.
- The staff-entered customer fields go into the snapshot only. Never write them back to `customer_json`.
- Timestamps are stored in UTC and displayed at +7 hours (CLAUDE.md §3 rule 2).
- Admin copy is Thai. Every control is ≥44px. Confirmations use `useConfirm`, never `window.confirm`. TypeScript has no `any`. Payload types live in `src/types/store.ts`.
- FP28 receipts (`claim_station.html`, `admin.html`, `server/templates/receipt_template.svg`) stay untouched.
- Deploy with `./deploy.sh` (full), and only with the user's go-ahead.

## Review Focus

1. **Two staff issue receipts at the same moment** (two tabs or two machines). Each gets a distinct consecutive number. A double click on one order returns the same receipt instead of creating two. Covered by Task 1 tests.
2. **A long design name** (e.g. "พวงกุญแจสำนักวิชา · ADT · เทคโนโลยีดิจิทัลประยุกต์") or **many lines** must wrap inside the name column and paginate onto page 2 with the same number. Totals appear on the last page only. Covered by Task 3 tests.
3. **The order is cancelled after a receipt was issued.** A warning shows on the order page and in the order list, and nothing is auto-cancelled. Covered by Task 2 test and Task 4.
4. **A receipt is reprinted after the order or the settings changed** (renamed product, new payee). The reprint shows the original snapshot values. Covered by Task 1 test.
5. **Printing from a browser with default margins or scaling.** The printed fields must land where the preview shows them: the print page sets `@page { size; margin: 0 }` and renders at the SVG's own size. Checked manually in Task 6.

---

### Task 1: Receipts backend core (Codex)

**Files:**
- Create: `server/store/receipts.py`
- Modify: `server/store/db.py` (`ensure_store_db`: new table + index only)
- Test: `server/tests/test_store_receipts.py` (fixtures via `from .test_store_v2 import _conn, _product, CUSTOMER`)

**Interfaces:**
- Produces, in table `store_receipts`:
  - Columns: `id INTEGER PK`, `receipt_no TEXT UNIQUE NOT NULL`, `seq INTEGER NOT NULL`, `order_id INTEGER NOT NULL REFERENCES store_orders(id)`, `issued_at TEXT NOT NULL` (UTC ISO), `issued_by TEXT NOT NULL`, `snapshot_json TEXT NOT NULL`, `cancelled_at TEXT`, `cancelled_by TEXT`, `cancel_reason TEXT`.
  - A partial unique index on `order_id` `WHERE cancelled_at IS NULL`.
- The counter is the `store_counters` row with `period = 'receipt'`. It works the same way as `next_order_code`.
- `receipts.py` imports only from `.common` and must not import `db` (same rule as categories.py). It reads order rows through SQL on `store_orders`/`store_order_items`. It never writes to them.
- `RECEIPT_ISSUABLE_STATUSES = ("paid", "ready", "completed")`
- `DEFAULT_RECEIPT_SETTINGS: dict`:
  - `{"payeeName": "", "signatureUrl": "", "prefix": "SU-R2569-", "layout": DEFAULT_LAYOUT}`
  - `DEFAULT_LAYOUT` is defined in Task 3 and must stay in sync with it. Copy it from the brief of Task 3: same keys, same numbers. Add a comment pointing at `src/lib/receipt/layout.ts`.
- `get_receipt_settings(conn) -> dict`
- `save_receipt_settings(conn, payload: Any) -> dict`
  - Validates:
    - `payeeName` with `clean_text`, max 80 characters.
    - `signatureUrl` with `clean_image_url`.
    - `prefix` with `clean_text`, max 20 characters, matching `[A-Za-z0-9-]*`.
    - Every layout number is a finite number within 0–1000. Font sizes are within 4–30.
  - Stores the result under the `store_settings` key `receipt`.
- `issue_receipt(conn, order_code: str, *, issued_by: str, customer: dict) -> dict`
  - If the order already has an active receipt, return it unchanged (idempotent).
  - Otherwise validate the status, `BEGIN IMMEDIATE`, bump the counter and insert the snapshot. `customer` is `{name, studentCode, school}` (each passes through `clean_text`, max 120).
  - Returns the serialized receipt.
- Snapshot keys:
  - `{receiptNo, issuedAt, customer: {name, studentCode, school}, lines: [{no, name, quantity, unitPrice, amount}], total, totalText, payeeName, signatureUrl}`
  - Line name is `product_name` + (`" · " + variant_label` if `variant_label` is not "-").
  - `totalText` comes from `baht_text(total)`.
- `baht_text(amount: int) -> str`
  - The Thai-words algorithm, ported exactly from `toBahtText` in `server/templates/claim_station.html` (lines ~1773-1794).
  - Examples: `baht_text(158) == "หนึ่งร้อยห้าสิบแปดบาทถ้วน"`, `baht_text(0) == "ศูนย์บาทถ้วน"`, `baht_text(21) == "ยี่สิบเอ็ดบาทถ้วน"`, `baht_text(1000000) == "หนึ่งล้านบาทถ้วน"`.
- `cancel_receipt(conn, receipt_id: int, *, cancelled_by: str, reason: str) -> dict`
  - The reason is required (`clean_text` with `required=True`, max 200).
  - Cancelling an already cancelled receipt raises 400 `"ใบเสร็จนี้ถูกยกเลิกแล้ว"`.
- `list_order_receipts(conn, order_code: str) -> list[dict]`: newest first.
- `receipt_warning(conn, order_code: str) -> str | None`
  - Returns `"ออเดอร์นี้ไม่ได้อยู่ในสถานะชำระแล้ว แต่ใบเสร็จ {no} ยังใช้งานอยู่"` when the order status is not issuable and an active receipt exists.
  - Returns `None` otherwise.
- `next_receipt_no(conn) -> str`: a preview that does not bump the counter.
- Serialized receipt: `{id, receiptNo, orderCode, issuedAt, issuedBy, snapshot, cancelledAt, cancelledBy, cancelReason}`.

Tests (names and key assertions):
- `test_first_receipt_number`: a paid order's first receipt is `"SU-R2569-0001"` and the next order's is `"SU-R2569-0002"`.
- `test_issue_is_idempotent_per_order`: issuing twice gives the same `receiptNo` and only 1 row.
- `test_concurrent_issue_no_duplicates`: 8 threads on 8 paid orders, each with its own file-DB connection (pattern from `test_concurrent_buyers_do_not_oversell`). The sorted numbers equal `0001..0008`.
- `test_unpaid_order_rejected`: `pending_payment`, `waiting_confirm` and `cancelled` each raise 400 with the exact message.
- `test_snapshot_frozen`: after issuing, change the product name, then change `payeeName` in settings. `list_order_receipts(...)[0]["snapshot"]` is unchanged.
- `test_staff_customer_fields_not_written_to_order`: issue with `studentCode="6931501178"` on an order without one. The snapshot has it and `customer_json` still doesn't.
- `test_cancel_then_reissue_next_number`: cancel with a reason, reissue, get the next number. Cancelling without a reason gives 400.
- `test_warning_when_order_cancelled_after_receipt`: issue, then set the order status to `cancelled` via `db.update_order`. `receipt_warning` returns the message.
- `test_baht_text_examples`: the four examples above.
- `test_settings_defaults_and_validation`: defaults come back. A bad prefix `"SU R"`, an outside URL for the signature and a font size of 99 each give 400.
- `test_prefix_change_only_affects_new_receipts`

- [ ] **Step 1:** Write the tests and run `.venv/bin/python -m pytest server/tests/test_store_receipts.py`. Expected: FAIL (module missing).
- [ ] **Step 2:** Implement the table, `receipts.py` and all the functions above.
- [ ] **Step 3:** Run the tests again, then run the full suite. Expected: PASS.
- [ ] **Step 4:** The controller commits with `feat(store): receipts core — numbering, snapshots, settings`.

---

### Task 2: Receipt routes, superadmin flag and v2 template (Codex)

**Files:**
- Modify: `server/store/api.py` (thin handlers only), `server/store/db.py` (`_serialize_order` gains `receiptWarning` only if cheap; otherwise the route adds it, implementer's choice, with no extra queries per row in lists beyond one batched query)
- Create: `server/templates/receipt_template_v2.svg`
- Test: `server/tests/test_store_receipts.py` (HTTP round-trip)

**Interfaces:**
- Consumes everything from Task 1.
- Produces these routes. All sit under the existing `/v2/admin` auth gate. The 403 for non-superadmins says `"เฉพาะผู้ดูแลระบบหลัก"`.

  | Route | Response | Who |
  |---|---|---|
  | `GET /v2/admin/me` | adds `isSuperadmin: bool` (looked up in `admin_users` for the claim user; the global token counts as true) | staff |
  | `GET /v2/admin/receipt-settings` | settings + `nextReceiptNo` | staff (read) |
  | `PUT /v2/admin/receipt-settings` | saved settings | superadmin; audit `v2_receipt_settings_changed` |
  | `GET /v2/admin/orders/<code>/receipts` | `{receipts, warning}` | staff |
  | `POST /v2/admin/orders/<code>/receipt` | receipt; body `{customer: {name, studentCode, school}}` | staff; audit `v2_receipt_issued` (only when newly issued) |
  | `POST /v2/admin/receipts/<id>/cancel` | receipt; body `{reason}` | superadmin; audit `v2_receipt_cancelled` |
  | `GET /v2/admin/receipt-template` | `image/svg+xml` body of `receipt_template_v2.svg` | staff |
- The order list `GET /v2/admin/orders` adds `receiptWarning: bool` per order. Compute it with one batched query.
- `receipt_template_v2.svg`:
  - Copy `receipt_template.svg`.
  - Remove only the payee name text "(นาย บัลลังก์ วงศ์ษารัตน์)" and the drawn signature (the path or group above the payee dotted line) from **both** copies. Keep the dotted line and the "ผู้รับเงิน / payee" labels.
  - Do not touch the original file.

Tests:
- `test_receipt_http_flow`: the full HTTP flow. A staff token issues a receipt (201/200 with a number), reissuing gives the same number, and the receipts list contains it. A staff token cancelling gets 403. The global token cancels with a reason and gets 200.
- `test_settings_put_requires_superadmin`
- `test_me_reports_superadmin`
- `test_template_v2_has_no_baked_payee`: the body contains "ผู้รับเงิน" and does not contain "บัลลังก์".
- `test_order_list_flags_receipt_warning`

- [ ] **Step 1:** Write the tests. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run all tests. Expected: PASS. Socket tests are run by the controller.
- [ ] **Step 4:** The controller commits with `feat(store): receipt routes and v2 template`.

---

### Task 3: Shared receipt renderer, pure TS (Codex)

**Files:**
- Create: `src/lib/receipt/layout.ts`, `src/lib/receipt/paginate.ts`, `src/lib/receipt/render.ts`
- Modify: `src/types/store.ts` (types below)
- Test: `src/__tests__/receiptRender.test.ts`, `src/__tests__/receiptPaginate.test.ts`

**Interfaces:**

Types:
- `ReceiptField = { x: number; y: number; size: number; anchor: "start" | "middle" | "end" }`
- `ReceiptColumn = { x: number; width: number; anchor: "start" | "middle" | "end" }`
- `ReceiptLayout`:
  ```
  {
    rightCopyOffset: number;
    fields: Record<"date" | "receiptNo" | "customer" | "studentId" | "school" | "subtotal" | "total" | "words" | "payeeName" | "pageNo", ReceiptField>;
    signature: { x: number; y: number; width: number };
    table: {
      firstY: number;
      rowSpacing: number;
      size: number;
      bottomY: number;
      cols: Record<"no" | "name" | "qty" | "price" | "amount", ReceiptColumn>;
    };
  }
  ```
- `ReceiptSnapshot` and `StoreReceipt` match Task 1's serialized shapes.
- `ReceiptSettings = { payeeName: string; signatureUrl: string; prefix: string; layout: ReceiptLayout; nextReceiptNo?: string }`

`DEFAULT_LAYOUT` lives in `layout.ts`, with a comment pointing at Python's `DEFAULT_LAYOUT` in `server/store/receipts.py`. Its values are in SVG viewBox units (812.98 × 597.12) and come from the FP28 `RCPT_DEFAULTS`, which already fit:
- `rightCopyOffset: 421.19`
- date `{384, 35, 9.5, end}`, receiptNo `{384, 56, 9.5, end}`
- customer `{247.5, 93, 8, start}`, studentId `{247.5, 112, 8, start}`, school `{247.5, 131, 8, start}`
- subtotal `{374, 399, 9, end}`, total `{374, 429, 9, end}`, words `{128, 399, 7, middle}`
- payeeName `{61, 535, 8, middle}`, pageNo `{384, 20, 7, end}`
- signature `{x: 30, y: 500, width: 62}`
- table: `firstY 197`, `rowSpacing 25`, `size 7.5`, `bottomY 385`
- table cols:
  - no `{x: 11, width: 18, anchor: "middle"}`
  - name `{x: 40, width: 225, anchor: "start"}`
  - qty `{x: 290, width: 30, anchor: "end"}`
  - price `{x: 343, width: 40, anchor: "end"}`
  - amount `{x: 396, width: 45, anchor: "end"}`

Check the payee, signature and column x values visually against the template in Task 5 and adjust them there. Tests pin only the structure, not these numbers.

Functions:
- `paginate(lines: ReceiptSnapshot["lines"], layout: ReceiptLayout, measure: (text: string, size: number) => number): ReceiptPage[]`
  - `ReceiptPage = { rows: { line: Line; nameLines: string[] }[]; pageNo: number; pageCount: number; isLast: boolean }`
  - Names wrap by `measure` within `cols.name.width`. Wrap Thai text with `Intl.Segmenter` (word granularity) when it's available; otherwise wrap by characters.
  - A row's height is `rowSpacing × nameLines.length`.
  - A page holds rows while `firstY + usedHeight ≤ bottomY`.
- `renderReceiptSvg(templateSvg: string, layout: ReceiptLayout, snapshot: ReceiptSnapshot, opts: { copy: boolean; sample: boolean; page: ReceiptPage; dateText: string }): string`
  - Returns a full SVG string with both copies (left, plus right at `rightCopyOffset`).
  - Field text is escaped with no `innerHTML` (CLAUDE.md pitfall). All SVG attributes are quoted.
  - Totals and words appear only when `page.isLast`.
  - Adds "สำเนา / COPY" when `copy`. Adds a large faint "ตัวอย่าง" watermark when `sample`.
  - The signature is an `<image href>` when `signatureUrl` is set.
- `formatReceiptDate(iso: string): string`: Bangkok date as `dd/mm/BBBB` (Buddhist year), matching `fmtReceiptDate` in claim_station.
- `SAMPLE_SNAPSHOT: ReceiptSnapshot`: fake data with 3 lines, one of them a long design name. The settings preview and the test print use it.

Tests:
- Pagination:
  - 3 short lines → 1 page, `isLast`.
  - 30 lines → more than one page; every page except the last has `isLast` false, and `pageCount` is consistent.
  - A long name wraps into ≥2 `nameLines` with a fake `measure` (`text.length * size * 0.5`).
- Rendering:
  - The SVG contains the receipt number twice (both copies).
  - It contains "สำเนา" only when `copy`.
  - It contains the total only on the last page.
  - A name containing `<script>` comes out escaped.
- Dates: `formatReceiptDate("2026-10-14T19:00:00Z") === "15/10/2569"`.

- [ ] Steps: tests → FAIL → implement → PASS (`npm test`, `npx tsc --noEmit`, lint). The controller commits with `feat(admin): shared receipt renderer`.

---

### Task 4: Issue, reprint and cancel in the order page (Claude)

**Files:**
- Modify: `src/app/admin/(panel)/orders/[code]/page.tsx`, `src/app/admin/(panel)/orders/page.tsx` (warning badge)
- Create: `src/components/admin/receipt/ReceiptPanel.tsx`, `src/components/admin/receipt/IssueReceiptDialog.tsx`
- Test: `src/__tests__/receiptPanel.test.tsx`

**Interfaces:**
- Consumes the Task 2 routes and the Task 3 types.
- Exposes `openReceiptPrint(receiptId: number, opts: { copy: boolean })`, which Task 6 implements. Until then, link to `/admin/receipts/<id>/print?copy=0|1`.

Behaviour:
- **The panel** shows the active receipt (number and Bangkok issue date), the cancelled history, and the warning banner from `warning`.
- **"ออกใบเสร็จ"** shows only for issuable statuses and opens the dialog:
  - It is prefilled from the order customer: `name`, `studentCode`, `school`.
  - The school field is a select from `SCHOOL_OPTIONS` (`src/lib/checkoutOptions.ts`) plus free text.
  - It shows a warning line when the student code or school is empty: `"ช่องว่างอาจทำให้ใช้ใบเสร็จเบิกเงินไม่ได้"`.
  - Confirm → POST → open print.
- **"พิมพ์ซ้ำ (สำเนา)"** opens print with `copy=1`.
- **"ยกเลิกใบเสร็จ"** shows only when `/me` says `isSuperadmin`. It uses `useConfirm` with a required reason input. If the confirm dialog can't take an input, use a small dialog built on the same styles.
- **The order list** shows a red badge "ใบเสร็จค้าง" when `receiptWarning`.

Tests:
- The issue button is hidden for `pending_payment`.
- The empty-student-code warning appears.
- The cancel button is hidden when not superadmin.

- [ ] Steps: tests → FAIL → implement → PASS → controller commits.

---

### Task 5: Receipt settings editor, drag on the live preview (Claude)

**Files:**
- Create: `src/app/admin/(panel)/settings/receipt/page.tsx`, `src/components/admin/receipt/ReceiptEditor.tsx`, `src/components/admin/receipt/FieldHandles.tsx`, `src/components/admin/receipt/ColumnHandles.tsx`
- Modify: `src/app/admin/(panel)/settings/page.tsx` (link card "ตั้งค่าใบเสร็จ")
- Test: `src/__tests__/receiptEditor.test.ts` (pure helpers: px↔viewBox conversion, nudge step, clamp)

**Behaviour:** match the mockup `.superpowers/brainstorm/92577-1792008291/content/receipt-settings-v2.html`.
- **Preview:** the left copy, rendered with `renderReceiptSvg(template, layout, SAMPLE_SNAPSHOT, {sample: true, …})`. This is the same function the print page uses.
- **Handles:** overlaid in viewBox coordinates. Dragging a field moves `x`/`y`. Arrow buttons (≥44px) and keyboard arrows move it by 0.5 units. A− and A+ change the size.
- **Columns:** each has a vertical handle. The 0.5-unit nudges move the first row and the row spacing. The panel shows "ใบหนึ่งใส่ได้ N แถว" from `paginate`.
- **Payee:** a name input, plus a signature upload through `POST /v2/admin/images` (PNG) with a remove button.
- **Prefix:** a prefix input that shows `nextReceiptNo`.
- **Buttons:**
  - "บันทึก" (PUT). Disabled for non-superadmins, with the hint "เฉพาะผู้ดูแลระบบหลักแก้ได้".
  - "พิมพ์ทดสอบ" opens print with sample data and the watermark.
  - "คืนค่าเริ่มต้น" (`useConfirm`) resets to `DEFAULT_LAYOUT`.
- **Fit:** check `DEFAULT_LAYOUT` against the template visually. Adjust payee, signature and column defaults in **both** `layout.ts` and `receipts.py` if they don't land in their boxes, and say so in the report.

- [ ] Steps: helper tests → implement → manual check in dev (drag, save, reload, values persist, a second browser sees them) → controller commits.

---

### Task 6: Print page (Claude)

**Files:**
- Create: `src/app/admin/receipts/[id]/print/page.tsx` (outside the `(panel)` layout so there is no nav), plus a sample route `src/app/admin/receipts/sample/print/page.tsx`
- Add font serving for SukhumvitSet if the admin can't already load `/fonts/SukhumvitSet.ttc` through Next. Proxy it from order-api `/fonts/...` or copy the file to `public/fonts/`. Implementer's choice, stated in the report.

**Behaviour:**
- Loads the receipt and the current layout, and renders each page from `paginate` using `renderReceiptSvg`.
- `@page { size: 812.98pt 597.12pt; margin: 0 }`. Each page is `break-after: page`. The SVG is set to its viewBox size, with no scaling and no browser header or footer.
- Waits for the template, the fonts and the signature image to load, then calls `window.print()` once.
- `?copy=1` adds "สำเนา / COPY".
- Manual check: print to PDF from Chrome or Brave. Compare the PDF with the settings preview for field positions and the page break with 20+ lines. Record the result in the report.

- [ ] Steps: implement → dev check (PDF) → lint/tsc/test → controller commits.

---

### Task 7: Docs and full verification (Claude)

- [ ] Update CLAUDE.md and AGENTS.md (mirrored). Add a store v2 receipts bullet: module, routes, numbering rule, superadmin rule, template v2. Update server/CLAUDE.md's "Receipt SVG" section to say FP28 uses the old template and store v2 uses v2.
- [ ] Run every check in Global Constraints. Expected: all green. Commit `docs: store receipts in project guide`.
- [ ] Hand off: deploy needs the user's go-ahead, a DB backup first, then `./deploy.sh` while the store is closed.
