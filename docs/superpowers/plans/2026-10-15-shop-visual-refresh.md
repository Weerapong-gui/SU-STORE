# Shop Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** การ์ดหมวดแบบแถบเบลอ, หัวหน้าหมวดเป็นรูปปกไล่เฉด (มือถือมี "‹ Shop" บน navbar), ลบคำโปรยหน้า `/products`, และลายสินค้ามีได้หลายรูปเลื่อนดูได้

**Architecture:** server เก็บรูปหลักใน `store_variants.image` เดิม และรูปที่เหลือในคอลัมน์ใหม่ `extra_images_json` แล้วส่ง `images: string[]` ใน payload ของ variant หน้าร้านมี `ProductGallery` ตัวเดียว (แบบ B: ลูกศรตอน hover, จุดบอกตำแหน่ง, ปัดนิ้วบนมือถือ) งานหน้าตาที่เหลือแก้ใน component เดิม

**Tech Stack:** Next.js 14 + Tailwind, Python order-api (raw HTTP + SQLite), Vitest (jsdom), pytest

**Spec:** `docs/superpowers/specs/2026-10-15-shop-visual-refresh-design.md`

## Global Constraints

- ต่อยอดบน branch `feat/locale-routing` → สร้าง branch ใหม่ `feat/shop-visual-refresh` จาก HEAD ของ branch นั้น
- `CLAUDE.md` §3.5: ห้าม `any`, ห้าม hardcode `#0071e3` (ใช้ `apple-blue*`), มุมโค้งใช้ `rounded-*` ห้าม `rounded-[..]`, จุด/วงกลมใช้ `rounded-circle`, ข้อความหน้าร้านผ่าน `useStoreText()`, ลิงก์ภายในผ่าน `useLocalePath()`, ไม่มีโค้ดตาย, ฟังก์ชัน Python ใหม่มี type hint, server error = `StoreError(status, ข้อความไทย)`
- `MAX_DESIGN_IMAGES = 8`; ข้อความเกิน: `"รูปลายใส่ได้ไม่เกิน 8 รูป"`
- คอลัมน์ใหม่: `store_variants.extra_images_json TEXT NOT NULL DEFAULT '[]'` (เพิ่มอย่างเดียว ห้ามแตะตารางออเดอร์)
- hero gradient: `linear-gradient(to right, rgba(0,0,0,.65), rgba(0,0,0,.35) 45%, rgba(0,0,0,.05) 80%)`; ความสูงประมาณ 220px มือถือ / 320px คอม
- Codex เขียนไฟล์ได้แต่ commit ไม่ได้ (sandbox) และ bind localhost ไม่ได้ → controller รัน test ที่ใช้ socket และ commit ให้ด้วย trailer `Co-Authored-By: Codex <noreply@openai.com>`
- ก่อนจบ: `ruff check server tests` · `npm run lint` · `npx tsc --noEmit` · `npm test` · pytest `server/tests` และ `tests/`
- deploy (ไม่อยู่ในแผนนี้): backup DB ด้วย `sqlite3 .backup()` แล้ว `./deploy.sh`

## Review Focus

1. **variant เดิมที่มีรูปเดียวหรือไม่มีรูป:** `images` ต้องเป็น `[image]` หรือ `[]` (ห้ามมี `""`) และหน้าสินค้าหน้าตาเหมือนเดิม (ไม่มีลูกศร/จุด) → Task 2 `test_variant_images_from_legacy_row`, Task 4 `single image shows no controls`
2. **admin แท็บเก่าที่ยังเปิดอยู่ตอน deploy ส่งแค่ `image`:** ต้องบันทึกได้และไม่ลบรูปเพิ่มเติมที่มีอยู่ → Task 2 `test_image_only_payload_keeps_extra_images`
3. **ใส่รูปเกิน 8 / URL ที่ไม่ใช่ `/product-images/...`:** ตอบ 400 ภาษาไทย ไม่บันทึกครึ่งๆ กลางๆ → Task 2 `test_too_many_design_images_rejected`, `test_bad_design_image_url_rejected`
4. **เปลี่ยนลายตอนอยู่รูปที่ 3:** ต้องกลับไปรูปแรกของลายใหม่ ไม่ค้าง index เกินจำนวนรูป → Task 4 `resets to the first image when images change`
5. **ปัดรูปบนมือถือแล้วทั้งหน้าเลื่อนแนวนอน / hero ตัวขาวบนรูปสว่าง:** แถบปัดต้องอยู่ใน `overflow-hidden` และตัวหนังสือ hero มี gradient รองรับเสมอ → Task 4 test `swipe track is clipped`, Task 6 test `renders the cover hero with shade`

---

### Task 1: ลบคำโปรยหน้า `/products` — **ผู้ทำ: agy**

**Files:** Modify `src/app/(main)/products/page.tsx` (ลบ `<SectionSubtitle textKey="shopSubtitle" />` และ import ที่ไม่ใช้แล้ว), `src/lib/storeI18n.ts` (ลบ key `shopSubtitle` ทั้ง EN บรรทัด ~15 และ TH บรรทัด ~108)

**Interfaces:** ไม่มี

- [ ] **Step 1:** ลบตามรายการ Files; ถ้า `SectionSubtitle` ไม่มีที่อื่นใช้แล้วให้ลบ component/ไฟล์นั้นด้วย (`grep -rn SectionSubtitle src`)
- [ ] **Step 2: Verify** `grep -rn shopSubtitle src` → ไม่มีผล; `npx tsc --noEmit` และ `npm run lint` ผ่าน; `npx vitest run` ผ่าน
- [ ] **Step 3: Commit** (controller) `chore(store): drop the shop subtitle`

---

### Task 2: รูปหลายรูปต่อลาย — server — **ผู้ทำ: Codex**

**Files:**
- Modify: `server/store/designs.py` (`clean_design`, ค่าคงที่ `MAX_DESIGN_IMAGES = 8`)
- Modify: `server/store/db.py` (รายการ migrate คอลัมน์ ~บรรทัด 174-179, payload variant ~บรรทัด 250-265, `replace_variants` INSERT/UPDATE ~บรรทัด 450-482)
- Test: `server/tests/test_store_designs.py`

**Interfaces:**
- Produces (JSON ของ variant ทุกที่ที่ส่ง variant ออกไป ทั้ง public และ admin): เพิ่ม `"images": list[str]` = `[image, *extra]` ที่ไม่ว่าง; `"image"` คงเดิม
- Consumes (admin payload ของแถวลาย): `images: list[str]` (optional) — ถ้ามี: `image = images[0] if images else ""`, `extra = images[1:]`; ถ้าไม่มี `images` แต่มี `image`: ใช้ `image` และ **คง** `extra_images_json` เดิมของ variant นั้น (variant ใหม่ = `[]`)
- `clean_design(raw: dict, index: int) -> dict[str, str]` คืน key เพิ่ม `"extra_images_json"` (string JSON) หรือ sentinel ที่บอกว่า "ไม่ได้ส่งมา" — ผู้ทำเลือกวิธี แต่ต้องไม่ทำให้ variant แบบไซซ์/สีมีค่าผิด (ของ options ใช้ `'[]'`)

- [ ] **Step 1: Write failing tests** ใน `server/tests/test_store_designs.py` (ใช้ fixture/สไตล์ที่ไฟล์นี้ใช้อยู่)

```python
def test_design_images_round_trip(): ...
    # save a designs product with variants [{"designCode":"AGRO", "designName":"เกษตร", "images":[A, B, C], "price":49}]
    # public product payload: variant["image"] == A and variant["images"] == [A, B, C]

def test_variant_images_from_legacy_row(): ...
    # a variant saved with only "image": A  → images == [A]; with image "" → images == []

def test_image_only_payload_keeps_extra_images(): ...
    # save images [A, B]; save again same id with {"image": C} (no "images") → images == [C, B]

def test_too_many_design_images_rejected(): ...
    # 9 URLs → StoreError 400 "รูปลายใส่ได้ไม่เกิน 8 รูป"; product variants unchanged afterwards

def test_bad_design_image_url_rejected(): ...
    # images ["https://evil.example/x.png"] → StoreError 400 (message from clean_image_url)

def test_migration_adds_extra_images_column(): ...
    # fresh/old schema DB after migrate → PRAGMA table_info(store_variants) contains extra_images_json, default '[]'
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest server/tests/test_store_designs.py -q` — Expected: FAIL (new tests)
- [ ] **Step 3: Implement** ตาม Interfaces (ตรวจ URL ทุกตัวด้วย `clean_image_url(value, f"รูปลาย ({index + 1})")`; ห้ามเกิน `MAX_DESIGN_IMAGES` รวมรูปแรก)
- [ ] **Step 4: Run** `.venv/bin/python -m pytest server/tests -q` และ `.venv/bin/ruff check server tests` — Expected: PASS (ยกเว้น test ที่ต้อง bind socket ซึ่ง sandbox ทำไม่ได้ ให้ระบุชื่อใน report; controller รันให้)
- [ ] **Step 5:** ไม่ commit — controller รัน `pytest server/tests tests/` เต็มแล้ว commit `feat(store): several images per design (server)` + Codex trailer

---

### Task 3: หลังร้าน — แถวรูปของแต่ละลาย — **ผู้ทำ: Claude subagent**

**Files:**
- Modify: `src/types/store.ts` (`StoreVariant` เพิ่ม `images: string[]`)
- Modify: `src/components/admin/product/designRows.ts` (`DesignRow.image: string` → `images: string[]`; `newDesignRow`, `designRowsFromProduct` (ใช้ `v.images`), `designPayload` ส่ง `images`)
- Modify: `src/components/admin/product/DesignsTable.tsx` (ช่องรูป → แถวรูปเล็ก) — ถ้าไฟล์เกิน ~400 บรรทัดให้แยก `DesignImagesCell.tsx`
- Test: `src/__tests__/designRows.test.ts` (มีอยู่แล้ว; แก้ assertion ที่อ้าง `image` เป็น `images` เพราะเป็นการเปลี่ยน logic), `src/__tests__/designImagesCell.test.tsx` (ใหม่ ถ้าแยก component)

**Interfaces:**
- Consumes: Task 2 payload (`variant.images`), endpoint อัปโหลดเดิม `adminFetch<{ url: string }>("images", { method: "POST", body: form })`
- Produces: `DesignRow = { key; id?; designName; designNameEn; designCode; images: string[]; stock }`; `MAX_DESIGN_IMAGES = 8` ใน `designRows.ts` พร้อมคอมเมนต์ชี้ `server/store/designs.py`
- helpers ใน `designRows.ts`: `moveImage(images: string[], from: number, to: number): string[]`, `removeImage(images: string[], index: number): string[]`

UI: รูปเล็ก (ขนาดเดิมของช่องรูป) เรียงแนวนอน รูปแรกมีป้าย "รูปหลัก"; แต่ละรูปมีปุ่ม "‹" "›" (ซ่อนที่ปลาย) และ "ลบ" (ยืนยันด้วย `useConfirm()`); ปุ่ม `+` (aria-label "เพิ่มรูป") ซ่อนเมื่อครบ 8; ใช้ `Button`/`useToast` จาก `src/components/admin/ui.tsx` ตามแบบไฟล์เดิม

- [ ] **Step 1: Write failing tests**

```ts
it("moves and removes images", () => {
  expect(moveImage(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  expect(removeImage(["a", "b", "c"], 1)).toEqual(["a", "c"]);
});
it("builds rows and payload with images", () => {
  // designRowsFromProduct(product with variant images ["a","b"]) → row.images == ["a","b"]
  // designPayload(rows, "49")[0].images == ["a","b"]
});
it("hides the add button at 8 images", () => { /* render cell with 8 images → no button[aria-label="เพิ่มรูป"] */ });
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/designRows.test.ts src/__tests__/designImagesCell.test.tsx` — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` — PASS
- [ ] **Step 5: Commit** `feat(admin): several images per design`

---

### Task 4: `ProductGallery` แบบ B — **ผู้ทำ: Claude subagent**

**Files:**
- Modify: `src/components/store/ProductGallery.tsx`
- Modify: `src/components/store/ProductDetail.tsx` (`images={variant ? variant.images : product.images}` เมื่อ `isDesigns`; สินค้าไซซ์/สีใช้ `product.images`; `key` ของ gallery = รายการรูป join เพื่อรีเซ็ต index)
- Modify: `src/lib/storeI18n.ts` (key ใหม่: `previousImage` "Previous image"/"รูปก่อนหน้า", `nextImage` "Next image"/"รูปถัดไป", `imageCount(i, n)` → `"1 / 3"` ทั้งสองภาษา)
- Test: `src/__tests__/productGallery.test.tsx` (ใหม่)

**Interfaces:**
- Consumes: `StoreVariant.images` (Task 3 เพิ่ม type)
- Produces: `ProductGallery({ images, alt, fallback }: { images: string[]; alt: string; fallback?: string })` (props เดิม)

พฤติกรรม: กรอบ `aspect-square rounded-3xl bg-mist overflow-hidden` เดิม; ภายในเป็นแถบรูปแนวนอน `flex snap-x snap-mandatory overflow-x-auto` (ซ่อน scrollbar) แต่ละรูปกว้างเต็มกรอบ; index ปัจจุบันคำนวณจาก `scrollLeft` (หรือ IntersectionObserver); ลูกศร ‹ › แสดงเฉพาะ `md:` ตอน `group-hover`/`focus-visible` เลื่อนด้วย `scrollTo({ left, behavior: "smooth" })`; จุดใต้กรอบ (`rounded-circle`, จุดปัจจุบันกว้างกว่า, สี `bg-ink` / `bg-zinc-300`) กดได้; ป้าย `imageCount` มุมล่างขวาเฉพาะมือถือ (`md:hidden`); `images.length <= 1` → ไม่มีลูกศร/จุด/ป้าย; ไม่มีรูป → fallback เดิม; ลบแถวรูปย่อเดิม

- [ ] **Step 1: Write failing tests** (mock `scrollTo` บน element)

```ts
it("single image shows no controls", () => { /* images=["a"] → no button[aria-label="Next image"], no dots */ });
it("next button scrolls to the second image and updates the dots", () => { /* images a,b,c → click next → scrollTo called with left = width; after scroll event aria-current dot index 1 */ });
it("resets to the first image when images change", () => { /* render key=a|b|c at index 2 → re-render with new key x|y → first dot current */ });
it("swipe track is clipped", () => { /* outer frame has class overflow-hidden */ });
it("shows the fallback when there is no image", () => { /* images=[] fallback="AGRO" → text AGRO */ });
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/productGallery.test.tsx` — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` — PASS
- [ ] **Step 5: ตรวจมือ** `./dev.sh` ที่กว้าง 375px และ 1280px: ปัดได้ หน้าไม่เลื่อนแนวนอน, ลายรูปเดียวหน้าตาเหมือนเดิม
- [ ] **Step 6: Commit** `feat(store): swipeable design gallery`

---

### Task 5: การ์ดหมวดแถบเบลอ — **ผู้ทำ: agy**

**Files:** Modify `src/components/store/CategoryCovers.tsx`

แถบชื่อ (div ที่มี `<h3>`) เป็น `relative overflow-hidden`; ถ้า `c.coverImage` มี: ใส่ `<img alt="" aria-hidden="true" src={c.coverImage}>` class `absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-110` (scale กันขอบเบลอโปร่ง), ตัวหนังสืออยู่ `relative`; ลบ `bg-mist` ออกจาก `<Link>` เฉพาะเมื่อมีรูป (ไม่มีรูป → `bg-mist` เดิม); รูปคมด้านล่างคงเดิม

- [ ] **Step 1:** แก้ตามข้างบน (ไม่มี test เดิมของไฟล์นี้; เพิ่ม `src/__tests__/categoryCovers.test.tsx`: มีรูป → มี `img[aria-hidden="true"]` ที่ class มี `blur-2xl`; ไม่มีรูป → ลิงก์มี class `bg-mist`)
- [ ] **Step 2: Verify** `npx vitest run src/__tests__/categoryCovers.test.tsx`, `npx tsc --noEmit`, `npm run lint` — PASS
- [ ] **Step 3: Commit** (controller) `feat(store): blurred category card band`

---

### Task 6: หัวหน้าหมวดเป็นรูปปก + "‹ Shop" บน navbar มือถือ — **ผู้ทำ: Claude subagent**

**Files:**
- Modify: `src/components/store/CategoryView.tsx` — แยก hero เป็น `src/components/store/CategoryHero.tsx`
- Modify: `src/app/(main)/products/c/[category]/page.tsx` ถ้า Container ห่ออยู่ที่ page (hero ต้องอยู่นอก Container เพื่อเต็มความกว้าง)
- Modify: `src/components/Navbar.tsx`
- Create: `src/lib/storePaths.ts` — `isCategoryPath(path: string): boolean` (`/^\/products\/c\/[^/]+\/?$/`)
- Test: `src/__tests__/categoryView.test.tsx` (เพิ่ม test ไม่แก้ assertion เดิม), `src/__tests__/storePaths.test.ts`

**Interfaces:**
- Consumes: `useLocalePath()`, `stripLocale` (Navbar มี `pathname` ที่ strip แล้ว), `t.backToShop`, `t.designTotal(n)`
- Produces: `CategoryHero({ category, designCount }: { category: StoreCategory; designCount: number })`

พฤติกรรม:
- มีรูปปก: `<section>` เต็มความกว้าง สูง ~220px / `md:` ~320px, `<img>` `absolute inset-0 object-cover`, ชั้น gradient ตาม Global Constraints (inline style หรือ class ใน `globals.css` ชื่อ `category-hero-shade`), เนื้อหาใน `Container`: "‹ {backToShop}" สีขาว `hidden md:inline-flex` มุมบนซ้าย, ชื่อ `h1` ตัวขาวชิดล่าง, บรรทัดรอง = tagline หรือ `designTotal(designCount)`
- ไม่มีรูปปก: หัวข้อแบบเดิม (ลิงก์ "‹ Shop" น้ำเงิน + `h1` ดำ + tagline) ทุกขนาดจอ
- ลบรูปปกเดิมทางขวา (`hidden md:block` aspect-[2/1]) ออก
- Navbar: ถ้า `isCategoryPath(pathname)` → มือถือแสดงลิงก์ `‹ {backToShop}` (`text-apple-blue`, `min-h-11`, href `localePath("/products")`, `md:hidden`) แทนโลโก้ และโลโก้เป็น `hidden md:inline-flex`; หน้าอื่นเหมือนเดิม — ข้อความผ่าน `useStoreText()`
- sticky ช่องค้นหา (`top-16`) คงเดิม

- [ ] **Step 1: Write failing tests**

```ts
// storePaths.test.ts
expect(isCategoryPath("/products/c/accessories")).toBe(true);
expect(isCategoryPath("/products/c/accessories/")).toBe(true);
expect(isCategoryPath("/products/keychain")).toBe(false);
expect(isCategoryPath("/products/c")).toBe(false);

// categoryView.test.tsx
it("renders the cover hero with shade", () => { /* category.coverImage="/product-images/c.png" → section img[src="/product-images/c.png"], an element with the shade class/style, h1 "Keychain" */ });
it("keeps the plain header without a cover", () => { /* coverImage="" → no hero img; link text "‹" + backToShop present */ });
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/storePaths.test.ts src/__tests__/categoryView.test.tsx` — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` — PASS
- [ ] **Step 5: ตรวจมือ** `./dev.sh` 375px และ 1280px ที่ `/products/c/<slug>` และ `/th/products/c/<slug>`
- [ ] **Step 6: Commit** `feat(store): category cover hero and mobile back link`

---

### Task 7: ตรวจรวมก่อนจบ — **ผู้ทำ: controller**

- [ ] `ruff check server tests` · `npm run lint` · `npx tsc --noEmit` · `npm test` · pytest `server/tests` และ `tests/` (env ตาม `.github/workflows/ci.yml`) — ผ่านทั้งหมด
- [ ] อัปเดต `CLAUDE.md` บรรทัด "สินค้าหลายลาย": variant แบบลายมี `images` (รูปแรก = `image`, ที่เหลือใน `extra_images_json`, สูงสุด 8)
