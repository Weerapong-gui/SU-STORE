# Admin Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนหน้า admin ให้เป็นระบบดีไซน์ dark ชุดเดียวตามทิศทาง "ใกล้ของอ้างอิง" โดยถอด inline style ในโซนที่ผู้ใช้เห็นทันทีที่เปิดหน้า

**Architecture:** `server/order_api.py` อ่าน `server/templates/admin.html` เข้าตัวแปร `ADMIN_HTML` ตอน import ทั้งไฟล์ ไม่มี build step ไม่มีเฟรมเวิร์ก งานนี้จึงเป็นการแก้ไฟล์เดียว: เขียนบล็อก `<style>` ใหม่ให้เป็น token ชุดเดียว แล้วแทน inline style ในสี่จุด (markup นิ่งของ toolbar, `renderOrderStats`, `renderOrders`, `renderPagination`) ด้วย class ที่ประกาศไว้ เทสต์ทั้งหมดเป็น pytest ที่ assert เนื้อ `ADMIN_HTML` เพราะ repo นี้ไม่มีตัวรัน JavaScript

**Tech Stack:** HTML/CSS/vanilla ES5 ในไฟล์เดียว, pytest อ่าน `order_api.ADMIN_HTML`

**Spec:** `docs/superpowers/specs/2026-07-27-admin-design-system-design.md`

## Global Constraints

- **ห้ามแตะฝั่ง server** — ไม่แก้ `order_api.py`, ไม่แตะ API, ไม่แตะฐานข้อมูล, ไม่แตะ `claim_station.html` / `display*.html` งานนี้แก้ `server/templates/admin.html` กับไฟล์เทสต์เท่านั้น
- **ห้ามเปลี่ยนชื่อ class เดิม** — `stat`, `badge`, `toolbar`, `table-card`, `notice`, `tab-btn`, `ghost`, `primary`, `ok-btn`, `muted`, `money`, `editing-row`, `needs-action` ต้องคงชื่อ การ rename จะลากไปแตะโค้ดที่ไม่ได้ตั้งใจแก้จนอ่าน diff ไม่ออกว่าอะไรคือดีไซน์
- **การตั้งชื่อใหม่ใช้ `base + modifier` เว้นวรรค** ตามของเดิม (`stat compact`) ห้ามใช้ BEM
- **JavaScript ต้องเป็น ES5** — `var`, ไม่มี arrow function, ไม่มี template literal, ไม่มี optional chaining
- **ค่าที่มาจากผู้ใช้ต้องผ่าน `esc()` ก่อนต่อเข้า HTML string เสมอ**
- **ห้ามมีค่าสีเป็น hex ตรงๆ ในโค้ดใหม่** — ทุกสีต้องมาจาก `var(--…)` (โค้ดเดิมมี hex ฝังใน JS อยู่ 4 จุด ซึ่งงานนี้ต้องเก็บกวาด)
- **ธีมเดียวคือ dark** — ห้ามเหลือร่องรอย `prefers-color-scheme`, `data-theme`, `suStoreTheme`, `theme-btn`
- **รันเทสต์แยกสองคำสั่ง** (`server/tests/` กับ `tests/` เป็น package ชื่อ `tests` ทั้งคู่ รวมเป็นคำสั่งเดียวแล้ว pytest collect ชนกัน):
  ```bash
  export ORDER_API_DB_PATH=/tmp/su-order-api/orders.db \
         ORDER_API_SLIPS_DIR=/tmp/su-order-api/slips \
         ORDER_API_SLIDES_DIR=/tmp/su-order-api/slides \
         ORDER_API_ASSETS_DIR=/tmp/su-order-api/display2_assets \
         PRODUCT_IMAGES_DIR=/tmp/su-order-api/product-images
  python3 -m pytest server/tests/ -v
  python3 -m pytest tests/ -v
  ```
  env vars จำเป็นเพราะ `order_api.py` สร้าง data directory ตอน import
- **Deploy** — `bash deploy-api.sh` เท่านั้น ห้าม `deploy.sh`

## แก้ตัวเลขจาก spec

spec เขียนว่าถอด inline **48 จุด** จากการวัดช่วงบรรทัด 204–267 ตอนวัดละเอียดพบว่า:

| ที่ | บรรทัด | inline | หมายเหตุ |
|---|---|---|---|
| markup นิ่ง: แถว Phase, toolbar, bulk bar, pager | 204–249 | 8 | อยู่ในขอบเขต |
| หัวตาราง `<th style="width:N%">` | 250–267 | 8 | **นอกขอบเขต** — เป็นความกว้างคอลัมน์ ไม่ใช่ธีม ย้ายเข้า CSS แล้วไม่ได้อะไรกลับมา |
| `renderOrderStats()` | 1508–1598 | 9 | อยู่ในขอบเขต |
| `renderOrders()` | 1727–1772 | 15 | อยู่ในขอบเขต (spec ประเมิน 22 เพราะนับ `openEditForm` ที่บรรทัด 1804+ ติดมาด้วย ซึ่งเป็นของ modal = ก้อน 5) |
| `renderPagination()` | 2097–2111 | 1 | อยู่ในขอบเขต |

**รวมที่ถอดจริง 33 จุด** ไม่ใช่ 48 เจตนาเดิมของ spec ไม่เปลี่ยน — ที่หายไปคือของที่ไม่ควรอยู่ในขอบเขตตั้งแต่แรก

**เจอเพิ่มระหว่างวัด — สีสว่างฝังตรงๆ ใน JavaScript 4 จุด** ตัวเหล่านี้ CSS token มองไม่เห็น และจะเป็นจุดขาวโพลนบนพื้นเข้ม ต้องเก็บในงานนี้:

| ค่า | ที่ | ใช้ทำอะไร |
|---|---|---|
| `#e8e8e8` | `renderOrderStats` วงแหวนโควตาขันโตก | รางวงกลม |
| `#e5e7eb` | `renderOrders` `<hr>` คั่นสินค้าหลายชิ้น | เส้นคั่น |
| `#fef9c3` + `#ca8a04` | `renderOrders` ปุ่ม Edit ตอนกำลังแก้ | พื้น + ขอบเหลือง |

## File Structure

| ไฟล์ | สถานะ | ความรับผิดชอบ |
|---|---|---|
| `server/templates/admin.html` | modify | บล็อก `<style>` (token + คอมโพเนนต์), markup นิ่งโซน orders, ฟังก์ชันเรนเดอร์ 4 ตัว, ลบปุ่มสลับธีมและ `initTheme()` |
| `server/tests/test_order_api.py` | modify | เทสต์ยืนยันเนื้อ `ADMIN_HTML` — ธีมเดียว, คอมโพเนนต์มีจริง, inline หายจากโซนที่ประกาศ |

---

### Task 1: token ชุดเดียวและลบ light theme

**Files:**
- Modify: `server/templates/admin.html` — บล็อก `<style>` บรรทัด 11–41, ปุ่ม toggle บรรทัด 175–178, ฟังก์ชัน `initTheme()` บรรทัด ~3250–3279
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: ไม่มี — task แรก
- Produces: CSS custom properties ที่ทุก task ถัดไปใช้ — `--bg --surface --surface-2 --line --line-strong --text --muted --faint --ok --ok-bg --warn --warn-bg --danger --danger-bg --accent --accent-bg --purple --purple-bg --neutral-bg --r-sm --r-md --r-lg --r-pill --shadow-1 --shadow-2`

**บริบท:** ตอนนี้มีค่าสามชุด — `:root` (light), `@media (prefers-color-scheme: dark)`, และ `:root[data-theme="dark"]` — บวกปุ่ม toggle ที่เขียน `localStorage.suStoreTheme` ทั้งหมดนี้ถูกแทนด้วยชุดเดียว

ชื่อเดิมบางตัวมีโค้ดอื่นใช้อยู่ ห้ามลบทิ้ง ให้ชี้ไปที่ค่าใหม่แทน: `--surface2`, `--header-bg`, `--badge-default`, `--badge-warn`, `--badge-ok`, `--badge-danger`, `--badge-purple`, `--editing-row`, `--toggle-track`, `--bar-track`, `--img-bg`

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

เพิ่มท้าย `server/tests/test_order_api.py`:

```python
class TestAdminSingleDarkTheme:
    """หน้า admin เหลือธีมเดียว — ร่องรอยของระบบสองธีมต้องไม่เหลือ"""

    def test_no_light_theme_machinery_remains(self):
        html = order_api.ADMIN_HTML
        for leftover in ("prefers-color-scheme", 'data-theme', "suStoreTheme",
                         "theme-btn", "themeToggleBtn", "initTheme"):
            assert leftover not in html, "ยังเหลือร่องรอยระบบสองธีม: " + leftover

    def test_root_declares_dark_color_scheme(self):
        # ถ้าไม่ประกาศ scrollbar/dropdown/date picker ของเบราว์เซอร์จะเป็นกล่องขาว
        assert "color-scheme: dark" in order_api.ADMIN_HTML
        assert "color-scheme: light dark" not in order_api.ADMIN_HTML

    def test_new_tokens_are_declared(self):
        html = order_api.ADMIN_HTML
        for token in ("--surface-2:", "--line-strong:", "--faint:", "--ok-bg:",
                      "--warn-bg:", "--danger-bg:", "--accent-bg:", "--purple-bg:",
                      "--neutral-bg:", "--r-sm:", "--r-md:", "--r-lg:", "--r-pill:",
                      "--shadow-1:", "--shadow-2:"):
            assert token in html, "ไม่พบ token: " + token

    def test_legacy_token_names_still_resolve(self):
        # โค้ดส่วนอื่นยังอ้างชื่อเดิมอยู่ ลบทิ้งแล้วสีจะหายเป็นช่วงๆ
        html = order_api.ADMIN_HTML
        for legacy in ("--surface2:", "--header-bg:", "--badge-default:", "--badge-warn:",
                       "--badge-ok:", "--badge-danger:", "--badge-purple:",
                       "--editing-row:", "--toggle-track:", "--bar-track:", "--img-bg:"):
            assert legacy in html, "ลบ token เดิมที่ยังมีคนใช้: " + legacy
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminSingleDarkTheme -v
```
Expected: FAIL — `test_no_light_theme_machinery_remains` ตกที่ `prefers-color-scheme`

- [ ] **Step 3: แทนบล็อก token ทั้งหมด**

แทนที่บรรทัด 11–41 (ตั้งแต่ `:root {` จนจบบรรทัด `.theme-btn-thumb` ตัวสุดท้าย) ด้วย:

```css
    :root {
      color-scheme: dark;

      /* พื้นผิวและเส้น */
      --bg: #0e0e11; --surface: #1a1a1f; --surface-2: #232329;
      --line: #2a2a32; --line-strong: #3a3a44;

      /* ตัวอักษร */
      --text: #f2f2f5; --muted: #9a9aa4; --faint: #6b6b76;

      /* สถานะ — ที่เดียวที่มีสี */
      --ok: #4ade80;      --ok-bg: #0f2e1c;
      --warn: #fbbf24;    --warn-bg: #33260a;
      --danger: #f87171;  --danger-bg: #3a1414;
      --accent: #60a5fa;  --accent-bg: #10243d;
      --purple: #a78bfa;  --purple-bg: #241a3d;
      --neutral-bg: #232329;

      /* ความมน */
      --r-sm: 8px; --r-md: 12px; --r-lg: 20px; --r-pill: 999px;

      /* เงา */
      --shadow-1: 0 1px 2px rgba(0,0,0,.5);
      --shadow-2: 0 8px 24px rgba(0,0,0,.45);

      /* ชื่อเดิมที่โค้ดส่วนอื่นยังอ้างอยู่ — ชี้มาที่ค่าใหม่ ห้ามลบ */
      --surface2: var(--surface-2);
      --header-bg: rgba(26,26,31,.9);
      --badge-default: var(--accent-bg);
      --badge-warn: var(--warn-bg);
      --badge-ok: var(--ok-bg);
      --badge-danger: var(--danger-bg);
      --badge-purple: var(--purple-bg);
      --editing-row: #2b2410;
      --toggle-track: var(--surface-2);
      --bar-track: var(--surface-2);
      --img-bg: var(--surface-2);
    }
```

- [ ] **Step 4: ลบปุ่มสลับธีมออกจาก markup**

ลบบรรทัด 175–178 ทั้งบล็อก:

```html
      <button class="theme-btn" id="themeToggleBtn" title="สลับโหมด">
        <span id="themeIcon" style="display:inline-flex;align-items:center;color:var(--muted)"></span>
        <span class="theme-btn-track"><span class="theme-btn-thumb" id="themeThumb"></span></span>
      </button>
```

- [ ] **Step 5: ลบฟังก์ชัน `initTheme()`**

ลบทั้ง IIFE ตั้งแต่คอมเมนต์ `// ── DARK MODE TOGGLE ─…` จนถึง `})();` ที่ปิดมัน (บรรทัด ~3250–3279) — ไม่มีโค้ดอื่นเรียกใช้

- [ ] **Step 6: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด รวมเทสต์เดิมที่ผูกกับ `admin.html` (`TestAdminKhantokStationCards`, `TestAdminPaginationPlacement`)

- [ ] **Step 7: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): single dark token set, remove the light theme and its toggle"
```

---

### Task 2: ชั้นคอมโพเนนต์

**Files:**
- Modify: `server/templates/admin.html` — บล็อก `<style>` (เพิ่ม class ใหม่ + จูน class เดิมให้ใช้ token ใหม่)
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: token จาก Task 1
- Produces: class ที่ Task 3–5 ใช้ — `.card` `.card.tight` `.chip` `.chip.active` `.pager` `.stat .meter` `.badge.ok` `.badge.warn` `.badge.danger` `.badge.accent` `.badge.purple` `.badge.neutral`

**บริบท:** `.stat`, `.badge`, `.toolbar`, `.table-card`, `.tab-btn` มีอยู่แล้วและมีโค้ดใช้อยู่ — งานนี้จูนค่าใน rule เดิม ไม่ใช่สร้างชื่อใหม่ ส่วน `.card` `.chip` `.pager` เป็นของใหม่ที่ Task 3–5 จะเริ่มใช้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminComponentLayer:
    """คอมโพเนนต์ที่ Task 3-5 จะใช้ ต้องมี rule รองรับก่อน"""

    def test_new_component_rules_exist(self):
        html = order_api.ADMIN_HTML
        for rule in (".card {", ".card.tight {", ".chip {", ".pager {"):
            assert rule in html, "ไม่พบ rule: " + rule

    def test_active_chip_matches_the_class_js_actually_toggles(self):
        # JS สลับ active-phase ถ้า CSS รับแต่ .active ชิปที่เลือกจะไม่เปลี่ยนสี
        assert ".chip.active-phase" in order_api.ADMIN_HTML

    def test_badge_status_modifiers_exist(self):
        html = order_api.ADMIN_HTML
        for mod in (".badge.ok", ".badge.warn", ".badge.danger",
                    ".badge.accent", ".badge.purple", ".badge.neutral"):
            assert mod in html, "ไม่พบ badge modifier: " + mod

    def test_large_radius_is_used_for_cards(self):
        assert "border-radius: var(--r-lg)" in order_api.ADMIN_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminComponentLayer -v
```
Expected: FAIL — ไม่พบ `.card {`

- [ ] **Step 3: เพิ่ม rule คอมโพเนนต์ใหม่**

แทรกในบล็อก `<style>` ต่อจาก rule ของ `.tab-pane`:

```css
    .card { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); padding: 24px; }
    .card.tight { padding: 16px; }

    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--surface-2); color: var(--muted);
      border: none; border-radius: var(--r-pill);
      padding: 6px 14px; font: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; min-height: 30px; transition: background .15s, color .15s;
    }
    .chip:hover { background: var(--line-strong); }
    /* JS สลับ class ชื่อ active-phase ไม่ใช่ active — ต้องรับทั้งสองชื่อ
       ไม่งั้นชิปที่เลือกอยู่จะไม่มีทางเปลี่ยนสี */
    .chip.active, .chip.active-phase { background: var(--text); color: var(--bg); }

    .pager {
      display: flex; gap: 12px; align-items: center;
      justify-content: space-between; flex-wrap: wrap;
      padding: 4px 0 12px;
    }
    .pager .pager-info { font-size: 13px; color: var(--muted); }

```

**หมายเหตุสองข้อที่ต่างจาก spec — ตั้งใจ:**

1. **ไม่มี `.btn` base class** spec §6 เขียนว่า `.btn` + `.primary .ghost .danger .pill` แต่โค้ดจริงใช้ `class="primary"` / `class="ghost"` / `class="ok-btn"` เดี่ยวๆ ทั่วทั้งไฟล์ การเพิ่ม base `.btn` แปลว่าต้องไปเติม class ให้ปุ่มทุกตัวในทุกแท็บ = rename ซึ่ง Global Constraints ห้ามไว้ จึงคง `.primary` / `.ghost` / `.ok-btn` เป็น class ปุ่มต่อไป แล้วเพิ่มแค่ modifier `.pill` (ดู Task 5)

2. **ไม่มี `.stat .meter`** spec §6 ลิสต์ไว้ และ mockup ที่อนุมัติวาดแถบ progress ใต้การ์ดโควตาขันโตก แต่โค้ดจริงเรนเดอร์เป็น **วงแหวน SVG** (`khantokStatHtml`) ซึ่งบอก % ได้ดีอยู่แล้วและจะ token-safe ทันทีที่แก้ `#e8e8e8` ใน Task 3 การเปลี่ยนวงแหวนเป็นแถบเป็นการรื้อรูปแบบการ์ด ไม่ใช่การถอด inline — ยกไปเป็นงานของก้อน 3 (แท็บ Orders) ซึ่งเป็นเจ้าของการจัดรูปการ์ดสรุปอยู่แล้ว

- [ ] **Step 4: จูน class เดิมให้ใช้ token ใหม่**

แก้ rule ที่มีอยู่แล้ว (ค้นด้วยชื่อ class อย่าอ้างเลขบรรทัด):

```css
    /* .stat — การ์ดตัวเลขสรุป */
    .stat { background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--shadow-1); padding: 22px 24px; }
    .stat > span { display: block; font-size: 12px; color: var(--muted); }
    .stat > strong { display: block; font-size: 44px; font-weight: 800; line-height: 1.05; margin-top: 6px; }
    .stat.compact > strong { font-size: 30px; font-weight: 750; }

    /* .badge — สถานะทรง pill */
    .badge { display: inline-block; border-radius: var(--r-pill); padding: 3px 11px; font-size: 12px; font-weight: 600; background: var(--neutral-bg); color: var(--muted); }
    .badge.ok      { background: var(--ok-bg);      color: var(--ok); }
    .badge.warn    { background: var(--warn-bg);    color: var(--warn); }
    .badge.danger  { background: var(--danger-bg);  color: var(--danger); }
    .badge.accent  { background: var(--accent-bg);  color: var(--accent); }
    .badge.purple  { background: var(--purple-bg);  color: var(--purple); }
    .badge.neutral { background: var(--neutral-bg); color: var(--muted); }

    /* .table-card — กล่องตาราง มน ไม่มีกรอบนอก */
    .table-card { background: var(--surface); border: none; border-radius: var(--r-lg); overflow: hidden; }
    .table-card th { padding: 10px 22px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); text-align: left; }
    .table-card td { padding: 11px 22px; font-size: 13px; border-top: 1px solid var(--line); vertical-align: top; }
    .table-card tbody tr:hover { background: var(--surface-2); }
```

**ข้อควรระวัง:** `.badge` เดิมถูกใช้ด้วยชื่อสถานะเป็น modifier (`class="badge paid"`, `class="badge shipped"` — ดู `renderOrders`) rule เดิมของสถานะเหล่านั้นต้องยังอยู่และใช้ token ใหม่ อย่าลบ modifier ชื่อสถานะทิ้งแล้วเหลือแต่ `.ok/.warn/...` ไม่งั้น badge ในตารางจะกลายเป็นเทาหมดทันที

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): component layer for card, chip, pager, stat meter and status badges"
```

---

### Task 3: ถอด inline โซนสรุปและ toolbar

**Files:**
- Modify: `server/templates/admin.html` — markup นิ่งบรรทัด 204–249, `renderOrderStats()` บรรทัด ~1508–1598, `updateOrderStats()` บรรทัด ~1429–1442
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `.card` `.chip` `.stat .meter` `.badge.*` จาก Task 2
- Produces: markup ของการ์ดสรุปที่ใช้ class ล้วน — Task 5 อ้าง `.pager` ที่อยู่ในโซนนี้

**บริบท:** 8 inline ในบล็อกนิ่ง + 9 ใน `renderOrderStats` + hex `#e8e8e8` หนึ่งจุด และมีบั๊กแฝง: `#bulkBar` บรรทัด 230 ประกาศ `display` สองครั้งในสตริงเดียว (`style="display:none;padding:10px 0;display:flex;…"`) ตัวหลังชนะ แถบจึงถูกกาง จนกว่า JS จะสั่งซ่อน — ต้องแก้ให้ซ่อนจริงตั้งแต่แรก

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminSummaryZoneDeinlined:
    """โซนที่เห็นทันทีที่เปิดหน้าต้องใช้ class ไม่ใช่ inline"""

    def test_phase_chips_use_the_chip_class(self):
        assert 'class="chip active-phase phase-btn"' in order_api.ADMIN_HTML

    def test_pagination_bar_has_no_inline_style(self):
        assert '<div id="paginationBar" class="pager"></div>' in order_api.ADMIN_HTML
        assert 'id="paginationBar" style=' not in order_api.ADMIN_HTML

    def test_bulk_bar_starts_hidden(self):
        # เดิมประกาศ display สองครั้งในสตริงเดียว ตัวหลังชนะ แถบเลยกางค้าง
        assert 'id="bulkBar" class="toolbar" hidden' in order_api.ADMIN_HTML
        assert 'display:none;padding:10px 0;display:flex' not in order_api.ADMIN_HTML

    def test_khantok_ring_track_uses_a_token(self):
        assert "#e8e8e8" not in order_api.ADMIN_HTML
        assert 'stroke="var(--surface-2)"' in order_api.ADMIN_HTML

    def test_clickable_stat_card_uses_a_class(self):
        assert 'class="stat compact clickable"' in order_api.ADMIN_HTML
        assert 'cursor:pointer;border-bottom:2px solid var(--accent)' not in order_api.ADMIN_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminSummaryZoneDeinlined -v
```
Expected: FAIL ทั้ง 5 เคส

- [ ] **Step 3: แปลง markup นิ่ง บรรทัด 205–249**

แทนบล็อกแถว Phase:

```html
      <div class="toolbar" style="margin-bottom:12px">
```
เป็น
```html
      <div class="toolbar toolbar-phase">
```
แล้วเพิ่ม rule `.toolbar-phase { margin-bottom: 12px; }` ในบล็อก `<style>`

ป้าย `Phase` เปลี่ยนจาก `<span style="font-size:12px;…">` เป็น `<span class="label-cap">Phase</span>` พร้อม rule:

```css
    .label-cap { font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; margin-right: 4px; }
```

ปุ่ม phase ตัวอย่างในบรรทัด 208 เปลี่ยนเป็น:

```html
          <button class="chip active-phase phase-btn" data-round="0">All</button>
```

`#phaseBtnContainer` เปลี่ยนจาก inline เป็น `class="chip-row"` พร้อม rule `.chip-row { display: flex; gap: 6px; flex-wrap: wrap; }`

`#bulkBar` เปลี่ยนเป็น:

```html
      <div id="bulkBar" class="toolbar" hidden>
```

และ `#paginationBar` เปลี่ยนเป็น:

```html
      <div id="paginationBar" class="pager"></div>
```

**สำคัญ:** โค้ด JS ที่คุม `#bulkBar` ใช้ `bar.style.display = selected.length ? "flex" : "none"` — เมื่อเปลี่ยนมาใช้ `hidden` ต้องแก้เป็น `bar.hidden = !selected.length;` ใน `updateBulkBar()` ไม่งั้น attribute `hidden` จะค้างและแถบไม่มีวันโผล่

- [ ] **Step 4: แปลง `renderOrderStats()`**

จุดที่ต้องแก้ในฟังก์ชันนั้น:

1. รางวงแหวนโควตาขันโตก — `stroke="#e8e8e8"` เปลี่ยนเป็น `stroke="var(--surface-2)"`
2. การ์ดที่คลิกได้ — `'<div class="stat compact" style="cursor:pointer;border-bottom:2px solid var(--accent)" data-breakdown="…"'` เปลี่ยนเป็น `'<div class="stat compact clickable" data-breakdown="…"'` พร้อม rule:

```css
    .stat.clickable { cursor: pointer; border-bottom: 2px solid var(--accent); }
```

3. วงแหวนโควตายังเป็น SVG เหมือนเดิม ไม่เปลี่ยนเป็นแถบ (เหตุผลอยู่ในหมายเหตุท้าย Task 2) — `stroke-dasharray` ที่คำนวณจาก % ยังเป็น attribute ปกติ ไม่ใช่ inline style
4. `style="margin-bottom:8px"` / `style="margin-bottom:0"` บนแถว `.stats` เปลี่ยนเป็น class `.stats-row` และ `.stats-row.last` พร้อม rule:

```css
    .stats-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .stats-row.last { margin-bottom: 0; }
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด — โดยเฉพาะ `TestAdminKhantokStationCards` ที่ผูกกับ `setOdom('statKhantokClaimed'` ต้องยังเขียว พิสูจน์ว่าการ์ดขันโตกที่ทำไว้เมื่อวานไม่หลุด

- [ ] **Step 6: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): de-inline the summary cards, phase chips and toolbars"
```

---

### Task 4: ถอด inline ในแถวตาราง

**Files:**
- Modify: `server/templates/admin.html` — `renderOrders()` บรรทัด ~1727–1772
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `.badge.*` และ token จาก Task 1–2
- Produces: ไม่มี interface ใหม่

**บริบท:** 15 inline ในฟังก์ชันนี้ และสีสว่างฝังตรง 3 จุด — `#e5e7eb` (เส้นคั่นสินค้าหลายชิ้น), `#fef9c3` + `#ca8a04` (ปุ่ม Edit ตอนกำลังแก้) ทั้งสามจะเป็นจุดสว่างจ้าบนพื้นเข้ม

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminOrderRowsDeinlined:
    """แถวตารางต้องไม่มีสีสว่างฝังตรงและใช้ class แทน inline"""

    def test_no_hardcoded_light_colours_remain(self):
        html = order_api.ADMIN_HTML
        for hexcolour in ("#e5e7eb", "#fef9c3", "#ca8a04", "#e8e8e8"):
            assert hexcolour not in html, "ยังมีสีสว่างฝังตรง: " + hexcolour

    def test_item_separator_uses_a_class(self):
        assert '<hr class="item-sep">' in order_api.ADMIN_HTML
        assert 'border-top:1px solid #e5e7eb' not in order_api.ADMIN_HTML

    def test_edit_button_editing_state_uses_a_class(self):
        assert "editOrderBtn' + (isEditing ? ' editing' : '')" in order_api.ADMIN_HTML

    def test_row_action_buttons_use_a_class(self):
        assert 'class="row-actions"' in order_api.ADMIN_HTML
        assert 'font-size:12px;min-height:28px;flex:1' not in order_api.ADMIN_HTML

    def test_slip_and_ticket_markers_use_status_classes(self):
        html = order_api.ADMIN_HTML
        assert 'class="mark ok"' in html
        assert 'style="color:var(--ok)"' not in html
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminOrderRowsDeinlined -v
```
Expected: FAIL — `#e5e7eb` ยังอยู่

- [ ] **Step 3: เพิ่ม rule ที่แถวตารางต้องใช้**

```css
    .item-sep { border: none; border-top: 1px solid var(--line); margin: 4px 0; }
    .mark { font-size: 11px; font-weight: 700; }
    .mark.ok { color: var(--ok); }
    .mark.warn { color: var(--warn); }
    .mark.muted { color: var(--muted); font-weight: 400; }
    .row-actions { display: flex; gap: 4px; margin-top: 4px; }
    .row-actions > button { font-size: 12px; min-height: 28px; flex: 1; }
    .row-actions > button.receiptBtn { flex: 0 0 auto; }
    .ghost.editing { background: var(--warn-bg); border-color: var(--warn); color: var(--warn); }
    .note-cell { font-size: 12px; white-space: pre-wrap; }
    .note-cell.danger { color: var(--danger); font-weight: 700; }
    .note-cell.ok { color: var(--ok); }
    .note-cell.muted { color: var(--muted); }
```

- [ ] **Step 4: แปลง markup ใน `renderOrders()`**

การแทนที่ทีละจุด:

| เดิม | ใหม่ |
|---|---|
| `'<hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0">'` | `'<hr class="item-sep">'` |
| `'<span class="muted" style="font-size:11px">'` | `'<span class="mark muted">'` |
| `'<span style="color:var(--ok)">✓ Slip uploaded</span>'` | `'<span class="mark ok">✓ Slip uploaded</span>'` |
| `'<span style="font-size:11px;font-weight:700;color:var(--ok)">🎟 บัตรขันโตก ฿'` | `'<span class="mark ok">🎟 บัตรขันโตก ฿'` |
| `'<span style="font-size:11px;font-weight:700;color:var(--warn)">🎟 ได้ไปแล้ว</span>'` | `'<span class="mark warn">🎟 ได้ไปแล้ว</span>'` |
| `'<span style="font-size:11px;color:var(--muted)">ไม่ได้บัตร</span>'` | `'<span class="mark muted">ไม่ได้บัตร</span>'` |
| `'<span style="font-size:10px;color:var(--warn);font-weight:700">⚠ รอยืนยัน</span>'` | `'<span class="mark warn">⚠ รอยืนยัน</span>'` |
| `'<span style="font-size:10px;color:var(--muted)">โดย '` | `'<span class="mark muted">โดย '` |
| `'<td style="font-size:12px;white-space:pre-wrap">'` | `'<td class="note-cell">'` |
| โน้ตที่เลือกสีด้วย ternary ในสตริง `style="color:…"` | เลือก **class** แทน: `'<span class="' + noteClass + '">'` โดย `var noteClass = order.adminNote.indexOf('ยังไม่ได้นับ') >= 0 ? 'note-cell danger' : order.adminNote.indexOf('ได้รับผ้าคาดฟรีโควต้า500') >= 0 ? 'note-cell ok' : 'note-cell muted';` |
| `'<div style="display:flex;gap:4px">'` | `'<div class="row-actions">'` |
| ปุ่มในแถวที่มี `style="font-size:12px;min-height:28px;flex:1"` | ตัด `style` ออก ให้ `.row-actions > button` จัดการ |
| ปุ่ม Edit ที่มี `style="…background:' + (isEditing ? '#fef9c3' : '') + ';border-color:' + (isEditing ? '#ca8a04' : '') + '"` | `'<button class="ghost editOrderBtn' + (isEditing ? ' editing' : '') + '" data-oid="…">Edit</button>'` |

`.editing-row` และ `.needs-action` ที่อยู่บน `<tr>` ไม่ต้องแตะ — เป็น class อยู่แล้ว แค่ต้องมั่นใจว่า rule ของมันใช้ token ใหม่ (`--editing-row` ชี้ไปที่ `#2b2410` แล้วใน Task 1)

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด

- [ ] **Step 6: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): de-inline order rows and drop the light colours baked into them"
```

---

### Task 5: pager

**Files:**
- Modify: `server/templates/admin.html` — `renderPagination()` บรรทัด ~2097–2111
- Test: `server/tests/test_order_api.py`

**Interfaces:**
- Consumes: `.pager` `.pager-info` จาก Task 2, `<div id="paginationBar" class="pager">` จาก Task 3
- Produces: ไม่มี interface ใหม่

**บริบท:** ฟังก์ชันนี้เพิ่งถูกแก้ไปเมื่อวาน (ย้ายแถบขึ้นเหนือตาราง) และมีเทสต์เดิมผูกกับรูปแบบข้อความอยู่ — `assert "'/' + totalPages + ' — ' + totalOrders + ' total orders'" in order_api.ADMIN_HTML` ห้ามทำให้เทสต์นั้นตก

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

```python
class TestAdminPagerDeinlined:
    def test_pager_info_uses_a_class(self):
        assert 'class="pager-info"' in order_api.ADMIN_HTML
        assert 'style="font-size:13px;color:var(--muted)">Page ' not in order_api.ADMIN_HTML

    def test_pager_label_format_is_unchanged(self):
        # เทสต์เดิมของแถบนี้ต้องไม่ตก
        assert "'/' + totalPages + ' — ' + totalOrders + ' total orders'" in order_api.ADMIN_HTML
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

```bash
python3 -m pytest server/tests/test_order_api.py::TestAdminPagerDeinlined -v
```
Expected: FAIL — เคสแรกตก เคสที่สองผ่านอยู่แล้ว (เป็นตัวกันการถอยหลัง)

- [ ] **Step 3: แปลง `<span>` กลางแถบ**

เปลี่ยน
```javascript
        '<span style="font-size:13px;color:var(--muted)">Page ' + currentPage + '/' + totalPages + ' — ' + totalOrders + ' total orders' + '</span>' +
```
เป็น
```javascript
        '<span class="pager-info">Page ' + currentPage + '/' + totalPages + ' — ' + totalOrders + ' total orders' + '</span>' +
```

ปุ่ม Prev/Next เปลี่ยน `class="ghost"` เป็น `class="ghost pill"` เพื่อให้เป็นทรงแคปซูลตามทิศทาง A พร้อม rule:

```css
    .ghost.pill, .primary.pill { border-radius: var(--r-pill); }
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

```bash
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: PASS ทั้งหมด รวม `TestAdminPaginationPlacement` เดิม

- [ ] **Step 5: Commit**

```bash
git add server/templates/admin.html server/tests/test_order_api.py
git commit -m "feat(admin): pager uses the component class instead of inline style"
```

---

### Task 6: ตรวจด้วยตาและ deploy

> **ห้ามมอบ task นี้ให้ subagent** — แตะ production ต้องรันจาก session หลักและถามเจ้าของก่อนยิง `deploy-api.sh`

**Files:** ไม่มีการแก้ไฟล์ — เป็นขั้นตรวจรับ

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า

- [ ] **Step 1: ตรวจว่าไม่มี inline หลงเหลือในโซนที่ประกาศ**

```bash
python3 - <<'PY'
import re
lines = open('server/templates/admin.html', encoding='utf-8').read().split('\n')
def count(a, b):
    return len(re.findall(r'\sstyle="[^"]*"', '\n'.join(lines[a-1:b])))
print("static 205-249      :", count(205, 249))
print("renderOrderStats    :", count(1508, 1600))
print("renderOrders        :", count(1727, 1775))
print("renderPagination    :", count(2097, 2115))
PY
```
Expected: ตัวเลขทั้งสี่ควรเหลือแค่ inline ที่เป็น **ค่าคำนวณ** (เช่น `width:NN%` ของ meter และวงแหวน) ถ้าเจอ inline ที่เป็นสี/ระยะ/ขนาดคงที่ แปลว่ายังถอดไม่ครบ

- [ ] **Step 2: ตรวจ syntax และเทสต์ครบ**

```bash
python3 -c "import ast; ast.parse(open('server/order_api.py').read()); print('order_api.py OK')"
python3 -m pytest server/tests/ -v
python3 -m pytest tests/ -v
```
Expected: OK + PASS ทั้งสองชุด

- [ ] **Step 3: Deploy (ถามเจ้าของก่อน)**

```bash
bash deploy-api.sh
```
Expected: จบด้วย `✓ Done! order-api redeployed.`

- [ ] **Step 4: ตรวจว่าเซิร์ฟเวอร์ยัง serve หน้า admin ได้**

```bash
ssh park@arch.sumfu.xyz 'docker exec su-order-api python3 -c "
import urllib.request
r = urllib.request.urlopen(\"http://127.0.0.1:10000/admin\", timeout=15)
b = r.read()
print(r.status, len(b), \"bytes\")
print(\"prefers-color-scheme present:\", b\"prefers-color-scheme\" in b)
"'
```
Expected: `200`, ขนาดใกล้เคียงเดิม, และ `prefers-color-scheme present: False`

- [ ] **Step 5: ตรวจด้วยตา 5 ข้อ**

1. หน้า Orders ตอนมีข้อมูล และตอนค้นแล้วไม่เจอ — การ์ดสรุป ตาราง และแถบ pager ต้องไม่ซ้อนหรือหลุดกริด
2. badge ครบทุกสถานะ: พร้อมรับ / ชำระแล้ว / รอยืนยัน / ปฏิเสธ / รับแล้ว / คืนเงิน — สีต้องต่างกันและอ่านออกบนพื้นเข้ม
3. ชิป phase ตอน active และไม่ active + กดสลับแล้วตัวเลขในการ์ดสรุปขยับตาม
4. เลือกแถวในตาราง — แถบ bulk ต้องโผล่ (ก่อนหน้านี้มันกางค้างเพราะบั๊ก `display` ซ้ำ) และหายเมื่อยกเลิกเลือก
5. scrollbar, dropdown ของ `<select>`, และ date picker ต้องเป็นโทนเข้ม ไม่ใช่กล่องขาว

- [ ] **Step 6: Push**

```bash
git push origin $(git rev-parse --abbrev-ref HEAD)
```

---

## หมายเหตุ (ไม่อยู่ในขอบเขต)

- `<th style="width:N%">` 8 จุดในหัวตารางยังเป็น inline โดยตั้งใจ — เป็นความกว้างคอลัมน์ ไม่ใช่ธีม
- inline อีก ~330 จุดใน modal แก้ไขออเดอร์และแท็บที่เหลือเป็นงานของก้อน 4–5
- ไฟล์ยังเป็นก้อนเดียว 187k — การผ่าเป็น `admin.css` / `admin.js` เป็นงานของก้อน 2 ซึ่งต้องรื้อโครงหน้าอยู่แล้ว
