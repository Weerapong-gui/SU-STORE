# Categories + Multi-Design Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff-managed product categories with cover images, products that hold many designs (e.g. one keychain per school) with per-design name/code/image/stock, bilingual names end-to-end including order snapshots, and a storefront that works well on phones on every page.

**Architecture:** Backend stays in `server/store/`: shared helpers move to a new `common.py`, categories get their own module, designs reuse `store_variants` rows (new columns) so stock, cart and order items keep working unchanged. The storefront adds a category strip/covers on `/products`, a category page with client-side search, and a design picker on the product page. Admin gets a Categories section and a "designs" mode in the product editor. UI tasks implement the screens approved in Claude Design (Task 0).

**Tech Stack:** Python 3.11 raw-HTTP order-api + SQLite (WAL), pytest, ruff · Next.js 14 App Router, TypeScript, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-categories-and-designs-design.md`

## Global Constraints

- Follow `CLAUDE.md` §3.5 in full. Every task ends green on all of these: `ruff check server tests` · `npm run lint` · `npx tsc --noEmit` · `npm test` · `python3 -m pytest server/tests/` · `python3 -m pytest tests/` (env vars from `.github/workflows/ci.yml`; needs Python ≥ 3.11).
- Order data: schema changes are `ALTER TABLE … ADD COLUMN` only. Never UPDATE/DELETE existing `store_order_items` / `store_orders` rows. Production DB is backed up with `sqlite3 .backup()` before deploy.
- Server errors are `StoreError(status, ข้อความไทย)`; Python functions have type hints; TS has no `any`; payload types live in `src/types/store.ts`.
- Storefront colours via `apple-blue*` / CSS vars only, corners via `rounded-*` / `rounded-circle` only — no hex colours, no `rounded-[..]`.
- Storefront copy goes through `useStoreText()` (EN + TH); admin copy is Thai; admin confirms with `useConfirm()`, never `window.confirm`.
- Bilingual data falls back to the other language when the chosen one is empty: Thai name is required, English is optional.
- Files over ~400 lines / functions over ~50 lines get split. `server/store/db.py` is already 799 lines; nothing new goes into it except schema and the touched product/order functions.
- Hidden category = hidden from the category strip, covers and home block, plus 404 on its page. Its products stay listed under "ทั้งหมด" and stay purchasable. Stopping a product's sale still uses product status.
- The mobile sticky "ใส่ตะกร้า / ซื้อเลย" bar applies to **every** product page, shirts included.
- Deploy is `./deploy.sh` (both services). Only with the user's go-ahead, and only after the DB backup.

## Review Focus

1. **Old orders and old products after migration.** Pre-existing order items have NULL English columns and must still render in TH/EN (fallback to Thai). Pre-existing products are `optionKind: "options"`, `categoryId: null`, and still appear on `/products` and the home "all products" block. → tests in Task 2 and Task 5.
2. **Design codes typed with odd case, spacing or duplicates.** `" scs "` and `"SCS"` in one product must be rejected as duplicates. Search for `scs`, `Scs` or `cosmetic` must find the card. `?design=scs` must open the SCS design. → tests in Task 4 and Task 7.
3. **Switching a product between sizes/colours and designs once it has orders.** Old variants are deactivated, not deleted. Existing orders keep their labels. → test in Task 4.
4. **Deleting a category that still has products.** The products become uncategorized and nothing else changes. → test in Task 3.
5. **Narrow phones (320px) with long Thai/English names** (e.g. "School of Applied Digital Technology"). Nothing scrolls sideways, and the sticky buy bar never covers the last content or the footer. → checked in Task 14 and recorded in the audit file.

---

### Task 0: Design the new screens in Claude Design (main session, with the user)

Not a subagent task: the main session does this with the user before any UI task starts.

**Screens** (each at 375px mobile and at desktop width):
- `/products` with the category strip and covers
- the category page: cover hero, sticky search, design cards, and the "ไม่พบ" state
- a design product page: design picker and sticky buy bar
- a sizes/colours product page with the sticky buy bar
- admin "หมวดหมู่": list and edit form
- admin product editor step ③ in "หลายลาย" mode

**Inputs:** the spec's "ขั้นออกแบบ" section and the wireframes in `.superpowers/brainstorm/90887-1791988527/content/`. Use the store's real tokens: `--accent*`, `--radius-scale`, Sarabun/selected font, `bg-mist`, `text-ink`, `text-ink-soft`. Use the real product photos from production if they're available.

- [ ] **Step 1:** `Artifact` `action: "quickstart"`, `intent: "design"`; create the Design artifact from the returned type and lay out the screens above.
- [ ] **Step 2:** Share the link with the user, iterate on their comments until they approve.
- [ ] **Step 3:** Write the approved link under a new heading "แบบที่อนุมัติ" in the spec. Commit (`docs: approved Claude Design for categories`). Every UI task below (8–13) must match this design. Where the design and the plan disagree on looks, the design wins. Where they disagree on behaviour, the plan wins.

---

### Task 1: Extract shared helpers into `server/store/common.py` (refactor)

**Files:**
- Create: `server/store/common.py`
- Modify: `server/store/db.py` (helpers removed, re-imported), `CLAUDE.md` §3.5 rule 1 (helper location)

**Interfaces:**
- Produces: `common.StoreError`, `common.now_iso() -> str`, `common.TZ_BANGKOK`, `common.MAX_FIELD_LENGTH`, `common.clean_text(...)`, `common.as_int(...)` (was `_as_int`), `common.slugify(name: str, fallback: str = "product") -> str`, `common.unique_slug(connection, table: Literal["store_products", "store_categories"], base: str, exclude_id: int | None = None) -> str`, `common.clean_image_url(value: Any, field: str) -> str` (moved from `home._clean_image`, `""` allowed, otherwise must match `/product-images/[A-Za-z0-9._-]+`)
- `db.py` re-exports `StoreError, clean_text, now_iso, TZ_BANGKOK, slugify` so `db.StoreError` etc. keep working for `api.py` and tests.

- [ ] **Step 1:** Move the helpers and update `db.py` / `home.py` call sites (`_as_int` → `as_int`, `_unique_slug(conn, base, ex)` → `unique_slug(conn, "store_products", base, ex)`, `_clean_image` → `clean_image_url`). Don't change any behaviour.
- [ ] **Step 2:** Run the full pytest + ruff. Expected: all pass with **no test assertions edited**.
- [ ] **Step 3:** Update CLAUDE.md §3.5 rule 1 so the helper list points to `server/store/common.py`. Commit `refactor(store): shared helpers in store/common.py`.

---

### Task 2: Schema — categories table and new columns

**Files:**
- Modify: `server/store/db.py` (`ensure_store_db`)
- Test: `server/tests/test_store_categories.py` (new; reuse `_conn` / `_product` by importing from `test_store_v2`)

**Interfaces:**
- Produces these tables and columns:
  - `store_categories(id INTEGER PK, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '', tagline TEXT NOT NULL DEFAULT '', tagline_en TEXT NOT NULL DEFAULT '', cover_image TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  - `store_products` + `name_en TEXT NOT NULL DEFAULT ''`, `category_id INTEGER`, `option_kind TEXT NOT NULL DEFAULT 'options'`
  - `store_variants` + `design_name TEXT NOT NULL DEFAULT ''`, `design_name_en TEXT NOT NULL DEFAULT ''`, `design_code TEXT NOT NULL DEFAULT ''`, `image TEXT NOT NULL DEFAULT ''`
  - `store_order_items` + `product_name_en TEXT`, `variant_label_en TEXT` (nullable, no default)

- [ ] **Step 1: Failing test**

```python
def test_migration_adds_columns_and_keeps_old_rows():
    conn = _conn()
    product = _product(conn)
    order = db.create_order(conn, {"items": [{"variantId": product["variants"][0]["id"], "quantity": 1}], "customer": CUSTOMER})
    db.ensure_store_db(conn)  # idempotent second run
    row = conn.execute("SELECT product_name, variant_label, product_name_en, variant_label_en FROM store_order_items").fetchone()
    assert row["product_name"] == "SU Tote Bag"
    cols = {r[1] for r in conn.execute("PRAGMA table_info(store_products)")}
    assert {"name_en", "category_id", "option_kind"} <= cols
    assert db.get_product(conn, product["id"], public=True)["optionKind"] == "options"
```

Also add `test_migration_on_legacy_schema`: create the four tables with the exact pre-change DDL (copy it from `git show HEAD:server/store/db.py` lines 76–130 into the test), insert one order item, then call `db.ensure_store_db`. Assert the old row is unchanged and its new columns are NULL.

- [ ] **Step 2:** Run `python3 -m pytest server/tests/test_store_categories.py -v`. Expected: FAIL. The `optionKind` key and the new columns don't exist yet.
- [ ] **Step 3:** Add the `CREATE TABLE IF NOT EXISTS store_categories` and an index on `store_products(category_id)` in `ensure_store_db`. Add the new columns with the existing `PRAGMA table_info` + `ALTER TABLE … ADD COLUMN` pattern, done as a small loop per table. Expose `optionKind` in `_serialize_product` now. The rest of the serialization comes in Task 4.
- [ ] **Step 4:** Run the tests. Expected: PASS, and the whole suite stays green.
- [ ] **Step 5:** Commit `feat(store): schema for categories, designs and bilingual order items`.

---

### Task 3: Categories module, routes and generic image upload

**Files:**
- Create: `server/store/categories.py`
- Modify: `server/store/api.py` (routes), `server/store/db.py` (`_product_fields` accepts `categoryId`)
- Test: `server/tests/test_store_categories.py`

**Interfaces:**
- Consumes: `common.*` (Task 1), the table from Task 2
- Produces:
  - `categories.serialize(row, product_count: int) -> dict` with keys `id, slug, name, nameEn, tagline, taglineEn, coverImage, visible, sortOrder, productCount`
  - `list_categories(conn, *, public: bool) -> list[dict]`: public lists visible only. `productCount` counts **active** products when public and all products when admin.
  - `get_category(conn, key: int | str, *, public: bool) -> dict`: 404 `"ไม่พบหมวดหมู่"` when missing, or when hidden and `public`
  - `create_category(conn, payload) -> dict`: name required (max 60), nameEn/tagline/taglineEn optional (60/120), coverImage via `clean_image_url`. Slug comes from `payload["slug"]`, else `name_en`, else `name`, using `slugify(..., fallback="category")` + `unique_slug(conn, "store_categories", …)`. New categories go last in `sort_order`.
  - `update_category(conn, category_id: int, payload) -> dict`: slug is immutable, `visible: bool`
  - `delete_category(conn, category_id: int) -> dict` → `{"deleted": True, "unassigned": n}`. Sets `category_id = NULL` on its products.
  - `reorder_categories(conn, ids: list[int]) -> list[dict]`: `ids` must be exactly the set of existing ids, else 400
  - `category_products(conn, slug: str) -> dict` → `{"category": …, "products": [public active products in it]}`
- Routes:
  - Public:
    - `GET /v2/categories` → `{"categories": […]}`
    - `GET /v2/categories/<slug>` → `category_products`
  - Admin (each write calls `log_audit(conn, "-", "v2_category_<created|updated|deleted|reordered>", f"<slug> by {user}")`):
    - `GET /v2/admin/categories`
    - `POST /v2/admin/categories`
    - `GET|PUT|DELETE /v2/admin/categories/<id>`
    - `PUT /v2/admin/categories/order` body `{"ids": [...]}`
    - `POST /v2/admin/images`: multipart `image` → `{"url": "/product-images/…"}`. The existing `/v2/admin/home/images` handler becomes a call to the same helper `_save_admin_image(handler, prefix: str) -> str`. Keep the old path working because HomeEditor uses it.
- Product payload: `categoryId: int | null`. An unknown id → 400 `"ไม่พบหมวดหมู่ที่เลือก"`. `_product_fields` has no connection, so it only type-checks the value; `create_product` / `update_product` call `categories.ensure_exists(conn, category_id: int | None) -> None` before applying.

Tests (with these names):
- `test_create_category_slug_from_english_name`: `{"name": "พวงกุญแจ", "nameEn": "Keychain"}` → slug `"keychain"`. A second one with the same name → `"keychain-2"`. Thai-only name → `"category"`.
- `test_hidden_category_is_404_publicly_but_products_still_listed`: hide it → `get_category(public=True)` raises 404, `list_products(public=True)` still contains the product, and `create_order` for it succeeds.
- `test_delete_category_unassigns_products`: the product survives with `categoryId is None`, and the result is `{"deleted": True, "unassigned": 1}`.
- `test_reorder_requires_every_id`: a missing id raises `StoreError` 400.
- `test_cover_image_must_be_uploaded_path`: `"https://evil/x.png"` raises 400.
- `test_category_products_only_active`: a draft product in the category is excluded.
- An HTTP round-trip test in the style of `test_store_v2.py`'s server test: `GET /v2/categories` returns visible ones only, and admin `POST` without a token gets 401.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run them. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `categories.py`, the `_product_fields` `categoryId` handling and the routes. Keep handlers thin: no SQL in `api.py`.
- [ ] **Step 4:** Run the tests. Expected: PASS, full suite green.
- [ ] **Step 5:** Commit `feat(store): categories with cover images`.

---

### Task 4: Products — English name, option kind, designs

**Files:**
- Create: `server/store/designs.py` (design row validation + labels)
- Modify: `server/store/db.py` (`_serialize_variant`, `_serialize_product`, `_product_fields`, `replace_variants`)
- Test: `server/tests/test_store_designs.py`

**Interfaces:**
- Produces:
  - `designs.normalize_code(code: str) -> str`: strip and uppercase, max 12 chars, `[A-Z0-9-]+`. Otherwise 400 `"ตัวย่อใช้ได้เฉพาะ A-Z, 0-9 และ -"`.
  - `designs.design_label(code: str, name: str) -> str` → `f"{code} · {name}"`
  - `designs.clean_design(raw: dict, index: int) -> dict` → `{design_code, design_name, design_name_en, image}`. `design_name` is required (max 80), `design_name_en` optional (80), `image` via `clean_image_url`.
- Product payload / serialization:
  - New keys `nameEn` (max 120) and `optionKind` (`"options"` | `"designs"`).
  - In `"designs"` mode every variant must carry `designCode`, `designName`, `designNameEn?` and `image?`. `size`/`color` are forced to `""`, and all variants share the single `price` given per variant (the client sends the same price on each).
  - Duplicate check keys on `design_code` in designs mode (message `"ตัวย่อ {code} ซ้ำกัน"`) and on `(size, color)` in options mode, as today.
- Serialized variant adds `designCode, designName, designNameEn, image`, and `label` becomes `design_label(...)` for design variants.
- Serialized product adds `nameEn, categoryId, optionKind`.

Tests:
- `test_design_product_round_trip`: create with `optionKind: "designs"` and two designs (`"scs"`, `"AI"`). Assert codes `["SCS", "AI"]`, labels `"SCS · วิทยาศาสตร์เครื่องสำอาง"`, and `product["optionKind"] == "designs"`.
- `test_duplicate_design_code_rejected_case_insensitive`: `" scs "` + `"SCS"` → 400.
- `test_design_requires_thai_name`
- `test_switching_kind_deactivates_ordered_variants`: an options product with an order, then switched to designs → the old variant has `active == False`, the order's `variantLabel` is unchanged, and the new design variant is active.
- `test_options_product_unchanged`: the existing `_product` fixture still serializes `label == "Black"` and `designCode == ""`.

- [ ] **Step 1:** Write the tests. Run them, expect FAIL.
- [ ] **Step 2:** Implement `designs.py` and wire it into `replace_variants` (branch on the product's `option_kind`; the payload's `optionKind` is applied before variants are replaced) and into serialization.
- [ ] **Step 3:** Run the tests. Expected: PASS, full suite green.
- [ ] **Step 4:** Commit `feat(store): multi-design products with codes and per-design images`.

---

### Task 5: Bilingual order snapshot

**Files:**
- Modify: `server/store/db.py` (`create_order` item insert, `_serialize_order`)
- Test: `server/tests/test_store_designs.py`

**Interfaces:**
- `create_order` writes `product_name_en = product.name_en or NULL`. `variant_label_en` gets `design_label(code, design_name_en)` for design variants that have an English name, and NULL otherwise.
- Serialized order item adds `productNameEn: str | None`, `variantLabelEn: str | None`.
- `dashboard.py`, CSV and admin keep using the Thai columns. Don't change them.

Tests:
- `test_order_snapshots_both_languages`: a design product with nameEn `"Keychain"` and design EN `"Cosmetic Science"` → the item has `productNameEn == "Keychain"` and `variantLabelEn == "SCS · Cosmetic Science"`. Renaming the product afterwards does not change the order.
- `test_old_order_item_has_null_english`: an options product without nameEn → both English fields are `None`.

- [ ] **Step 1:** Tests → FAIL. **Step 2:** Implement. **Step 3:** PASS + full suite. **Step 4:** Commit `feat(store): orders keep English names too`.

---

### Task 6: Home "categories" block (server)

**Files:**
- Modify: `server/store/home.py` (`HOME_BLOCK_TYPES`, `validate_home`, `resolve_home`)
- Test: `server/tests/test_store_v2.py` (home section)

**Interfaces:**
- Block shape `{"id", "type": "categories", "hidden", "title": str(max 80), "categoryIds": list[int] (max 12, empty = all visible)}`.
- `resolve_home` attaches `"categories": [serialized visible categories in sort order, filtered by ids if any]` and drops the block when that list is empty.
- `HOME_BLOCK_TYPES` gets `"categories"`. Add a comment pointing at `src/components/admin/home/blocks.ts`.

Tests: `test_categories_block_resolves_visible_only`, `test_categories_block_dropped_when_none_visible`, `test_categories_block_rejects_non_int_ids`.

- [ ] Steps: tests → FAIL → implement → PASS → commit `feat(home): categories block`.

---

### Task 7: Frontend types, localisation and design-search helpers

**Files:**
- Modify: `src/types/store.ts`, `src/lib/storeApi.ts`
- Create: `src/lib/localized.ts`, `src/lib/designCards.ts`
- Test: `src/__tests__/localized.test.ts`, `src/__tests__/designCards.test.ts`

**Interfaces:**
- Types:
  - `StoreCategory = { id; slug; name; nameEn; tagline; taglineEn; coverImage; visible; sortOrder; productCount }`
  - `StoreProduct` adds `nameEn: string; categoryId: number | null; optionKind: "options" | "designs"`
  - `StoreVariant` adds `designCode: string; designName: string; designNameEn: string; image: string`
  - `StoreOrderItem` adds `productNameEn: string | null; variantLabelEn: string | null`
  - `HomeBlock` gets the `categories` variant `{ title; categoryIds: number[]; categories?: StoreCategory[] }`
- `localized(th: string, en: string | null | undefined, lang: Lang): string`: picks by lang and falls back to the non-empty one. Also `useLocalized(): (th, en) => string`.
- `designCards(products: StoreProduct[]): ProductCard[]`, where `ProductCard = { key: string; href: string; image: string; name: string; nameEn: string; code: string; productName: string; productNameEn: string; price: number | null; soldOut: boolean; saleState: SaleState; saleStartsAt: string | null }`.
  - Options products give one card: `href` `/products/<slug>` and the product's first image.
  - Design products give one card per active design: `href` `/products/<slug>?design=<code lowercased>`, the design image with the product image as fallback, and `soldOut` from the variant.
- `productCard(p: StoreProduct): ProductCard`: one card per product whatever its kind (used by `ProductGrid` on `/products` and in home blocks). `designCards` uses it for options products.
- `cardMatches(card: ProductCard, query: string): boolean`: trimmed, case-insensitive substring over `name`, `nameEn`, `code`, `productName` and `productNameEn`. An empty query matches everything.
- `storeApi`: `getStoreCategories(): Promise<StoreCategory[]>`, `getStoreCategory(slug: string): Promise<{ category: StoreCategory; products: StoreProduct[] } | null>`. Both `no-store`, with the same slug regex as `getStoreProduct`.

Tests:
- `localized("พวงกุญแจ", "", "en") === "พวงกุญแจ"`
- `localized("พวงกุญแจ", "Keychain", "en") === "Keychain"`
- a design product with 2 designs gives 2 cards, with `href` `/products/keychain?design=scs`
- `cardMatches(scsCard, "scs")` and `cardMatches(scsCard, " Cosmetic ")` are true
- `cardMatches(scsCard, "dent")` is false
- a sold-out design card has `soldOut: true`

- [ ] Steps: tests → FAIL → implement → PASS (`npm test`, `npx tsc --noEmit`) → commit `feat(store): category/design types and search helpers`.

---

### Task 8: Admin — Categories section

**Files:**
- Create: `src/app/admin/(panel)/categories/page.tsx` (list), `src/app/admin/(panel)/categories/[id]/page.tsx` (`id` or `new`), `src/components/admin/category/CategoryEditor.tsx`, `src/components/admin/category/CoverUpload.tsx`
- Modify: `src/components/admin/AdminNav.tsx` (insert `{ href: "/admin/categories", label: "หมวดหมู่" }` after สินค้า)
- Test: `src/__tests__/categoryOrder.test.ts` for any pure helper you add (reuse `move()` from `src/components/admin/home/blocks.ts`; don't write a new one)

**Interfaces:**
- Consumes the Task 3 routes through `adminFetch`, `StoreCategory` from Task 7, and `POST images` for covers.
- **List:** cover thumbnail, Thai name, `/products/c/<slug>`, product count, and a visible/hidden badge. Rows reorder by drag and by up/down buttons (for touch), and the order saves via `PUT categories/order`.
- **Editor fields:** ชื่อ (ไทย) *, ชื่อ (อังกฤษ), ชื่อในลิงก์ (new only, same hint style as products), ข้อความบนปก ไทย/อังกฤษ, รูปปก, แสดงบนหน้าร้าน.
- **Delete:** confirms through `useConfirm` with the message `"สินค้า {n} ชิ้นในหมวดนี้จะกลายเป็น 'ไม่มีหมวด' (สินค้าไม่ถูกลบ)"`.
- Matches the approved design (Task 0).

- [ ] Steps: build pages → `npm run lint && npx tsc --noEmit && npm test` → in `./dev.sh`, create/hide/reorder/delete a category and check `/products` → commit `feat(admin): categories section`.

---

### Task 9: Admin — product editor: English name, category, designs mode

**Files:**
- Modify: `src/components/admin/product/ProductEditor.tsx` (form fields + payload), `src/components/admin/product/VariantsCard.tsx` (becomes the "ไซซ์ / สี" branch only)
- Create: `src/components/admin/product/OptionsStep.tsx` (step ③ card with the "ไซซ์ / สี" | "หลายลาย" toggle), `src/components/admin/product/DesignsTable.tsx`, `src/components/admin/product/designRows.ts`
- Test: `src/__tests__/designRows.test.ts`

**Interfaces:**
- `DesignRow = { id?: number; designName: string; designNameEn: string; designCode: string; image: string; stock: string }`
- `designRowsFromProduct(p: StoreProduct): DesignRow[]`
- `designRowProblems(rows: DesignRow[], price: string): string[]`, Thai messages:
  - `"ยังไม่ได้ใส่ราคา"`
  - `"ลายแถวที่ {n} ยังไม่มีชื่อไทย"`
  - `"ลายแถวที่ {n} ยังไม่มีตัวย่อ"`
  - `"ตัวย่อ {code} ซ้ำกัน"` (case-insensitive)
- `designPayload(rows, price) -> variants[]`: sends `designCode` uppercased, the same `price` on every row, and `stock` null when blank.
- **Form:** adds `nameEn`, `categoryId: number | null` (dropdown from `GET categories` plus "ไม่มีหมวด") and `optionKind`. The Thai label "ชื่อสินค้า *" becomes "ชื่อสินค้า (ไทย) *".
- **Switching kind on a saved product:** `useConfirm` warns that the old variants will be closed (ordered ones are kept for order history).
- **Design image upload:** `POST images` per row, preview thumb, remove.
- **Mobile:** rows stack as cards (no horizontal table scroll).

Tests: each `designRowProblems` message above, and `designPayload` uppercases the code and copies the price.

- [ ] Steps: tests → FAIL → implement → PASS → manual check in dev: create the keychain with 3 designs, reload, edit, switch kinds → commit `feat(admin): designs mode in product editor`.

---

### Task 10: Storefront — `/products` with category strip and covers, and the category page

**Files:**
- Create: `src/components/store/CategoryStrip.tsx`, `src/components/store/CategoryCovers.tsx`, `src/components/store/CategoryView.tsx` (client: hero, sticky search, card grid, empty state), `src/components/store/ProductCardGrid.tsx` (renders `ProductCard[]`; replaces `ProductGrid`'s markup), `src/app/(main)/products/c/[category]/page.tsx`
- Modify: `src/app/(main)/products/page.tsx`, `src/components/store/ProductGrid.tsx` (maps products through `productCard` → `ProductCardGrid`, so home blocks, `/products` and category pages share one card component), `src/lib/storeI18n.ts` (search placeholder, no-results title/hint, "ทั้งหมด", design count) — EN+TH

**Interfaces:**
- Consumes `getStoreCategories`, `getStoreCategory`, `designCards`, `cardMatches` and `useLocalized` from Task 7.
- **`/products`:** strip (an "ทั้งหมด" item first, then visible categories, each with its cover thumbnail) → covers → the all-products grid with one card per product.
- **Category page:** `notFound()` when `getStoreCategory` returns null. `generateMetadata` title is the category name. Design products are exploded through `designCards`. The search input is a real `<input type="search">` with `text-base` (iOS no-zoom) and is sticky under the navbar.
- Matches the approved design. Mobile: the strip scrolls horizontally inside its own container (no page overflow), 2-column grid at <640px.

- [ ] Steps: implement → lint/tsc/test → in dev at 375px and desktop: strip, covers, search "scs"/"Cosmetic"/"zzz", hidden category 404 → commit `feat(store): category pages with search`.

---

### Task 11: Storefront — product page design picker and sticky mobile buy bar

**Files:**
- Create: `src/components/store/DesignPicker.tsx`, `src/components/store/BuyBar.tsx`
- Modify: `src/components/store/ProductDetail.tsx` (keep under ~200 lines by delegating), `src/app/(main)/products/[slug]/page.tsx` (pass `searchParams.design`; metadata title uses design name when present)

**Interfaces:**
- `DesignPicker({ designs: StoreVariant[]; selectedId: number | undefined; onSelect(v: StoreVariant): void })`: swatches use the design image or a code chip. Sold-out designs are dimmed and not selectable. It scrolls horizontally on mobile.
- `ProductDetail` gains the prop `initialDesign?: string`:
  - When the product is a designs product, the initial variant is the one whose code matches `initialDesign`, case-insensitive, else the first available design.
  - Selecting a design calls `router.replace(\`/products/${slug}?design=${code.toLowerCase()}\`, { scroll: false })`.
  - The main image is the design image, falling back to `product.images`.
  - Heading: design name (localized), with the product name small above it.
- `BuyBar({ canOrder: boolean; disabled: boolean; onBuy(): void; onAdd(): void })`:
  - Below `md` it's fixed to the bottom with a safe-area inset, and the page adds matching bottom padding so the footer isn't covered.
  - From `md` up it renders inline as today.
  - It's used for **all** products.
  - The preview-mode rule stays: `canOrder = saleOpen && !preview`.

Add a vitest + jsdom test `src/__tests__/designPicker.test.tsx`. Render `ProductDetail` with a 2-design product and `initialDesign="scs"`, then assert:
- the SCS heading is shown
- clicking the AI swatch calls the mocked `router.replace` with `/products/keychain?design=ai`
- a sold-out swatch is disabled

- [ ] Steps: test → FAIL → implement → PASS → dev check at 375px and desktop (shirt page too: bar present, nothing covered) → commit `feat(store): design picker and sticky buy bar`.

---

### Task 12: Storefront — bilingual names in cart, checkout, order and tracking pages

**Files:**
- Modify: `src/components/store/ProductDetail.tsx` (cart item `productName`/`variantLabel` from localized values), `src/components/store/CheckoutView.tsx` (live name/label via `useLocalized`; design label `code · name`), `src/components/store/OrderView.tsx` and `src/components/store/TrackOrder.tsx` (item name = `localized(productName, productNameEn, lang)`, label likewise)

**Interfaces:** consumes `localized` / `useLocalized` (Task 7) and the order fields (Task 5). Admin pages keep Thai and are untouched.

Add a test in `src/__tests__/localized.test.ts`: an order item with null English fields shows the Thai name under `lang="en"`.

- [ ] Steps: test → implement → lint/tsc/test → dev: place an order in EN, view `/order/<code>` in EN and TH → commit `feat(store): show order items in the chosen language`.

---

### Task 13: Home "categories" block (admin form and storefront)

**Files:**
- Modify: `src/components/admin/home/blocks.ts` (`BLOCK_INFO.categories` label "หมวดหมู่", lucide `Shapes` icon, description; `newBlock`; `summarize` → "ทุกหมวด" or "{n} หมวด"), `src/components/admin/home/BlockForms.tsx` (`CategoriesForm`: title + checkbox list of categories, none checked = all), `src/components/store/home/HomeBlocks.tsx` (render `CategoryCovers`)
- Test: `src/__tests__/homeBlocks.test.ts` (new): `newBlock("categories")` shape and `summarize` texts.

If `BlockForms.tsx` passes ~250 lines, move `CategoriesForm` to `src/components/admin/home/CategoriesForm.tsx`.

- [ ] Steps: test → FAIL → implement → PASS → dev: add the block, preview at `/admin/home/preview`, publish → commit `feat(home): categories block in editor and storefront`.

---

### Task 14: Mobile audit and fixes across the whole storefront

**Files:**
- Create: `docs/superpowers/specs/2026-10-14-mobile-audit.md`
- Modify: whatever the audit finds (storefront only)

**Pages:**
- home (all blocks)
- `/products`, a category page, a shirt product page, a design product page
- cart / `/checkout`
- `/order/[code]` (pending and with slip)
- `/check-order` and `/check-order/fp28`
- the `/maintenance` variants
- the preview bar, announcement bar, navbar menu and footer

**Pass criteria** (from the spec):
- no horizontal scroll at 375px or 320px
- tap targets ≥ 44px
- input font ≥ 16px
- sticky bars cover nothing
- long names wrap and don't overflow

- [ ] **Step 1:** Run `./dev.sh`. Seed the dev DB through the admin UI: a keychain with 14 designs using real-length English names, plus a shirt.
- [ ] **Step 2:** For each page at 320 and 375px (use the `run` skill or Chrome tools), record pass/fail per criterion in the audit file with a one-line note. Run `document.documentElement.scrollWidth > innerWidth` in the console as the overflow check.
- [ ] **Step 3:** Fix each failure in its page's own component. Re-check and update the audit file to "ผ่าน" with what changed.
- [ ] **Step 4:** Run lint/tsc/test. Commit `fix(store): mobile layout audit` with the audit file.

---

### Task 15: Docs, full verification, deploy readiness

**Files:**
- Modify: `CLAUDE.md` §1 (store v2 bullets: categories, designs, `/products/c/[slug]`, `?design=`, bilingual order items, `server/store/categories.py` / `designs.py` / `common.py`)

- [ ] **Step 1:** Update CLAUDE.md. Remove anything this work made stale.
- [ ] **Step 2:** Run every check in Global Constraints. Expected: all pass. Paste the summary lines into the PR or hand-off.
- [ ] **Step 3:** Commit `docs: categories and designs in project guide`.
- [ ] **Step 4:** Stop and hand off to the user.
  - Deploy needs their go-ahead.
  - The sequence is: `sqlite3` `.backup()` of production `orders.db` (per the `deploy` skill), then `./deploy.sh` while the store is closed, then a check of `/products`, a category page, a design page, a test order in preview mode (blocked) and the admin categories.
