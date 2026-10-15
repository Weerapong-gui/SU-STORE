# Locale Routing (`/` = EN, `/th/` = TH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้าร้านแยกภาษาตาม URL (อังกฤษที่ `/...`, ไทยที่ `/th/...`) จำภาษาที่เลือกด้วย cookie, เดาจากภาษาเครื่องตอนมาครั้งแรก และย้ายตัวเลือกภาษาจาก navbar ไป footer

**Architecture:** pure helpers ใน `src/lib/locale.ts` ตัดสินภาษา middleware จะ redirect (307) เมื่อภาษาที่ต้องการไม่ตรงกับ path หรือ rewrite `/th/x` → `/x` แล้วส่งภาษา/path ผ่าน request header ที่ลบค่าปลอมจาก client ทิ้งก่อน server layout อ่าน header ไปตั้ง `<html lang>`, `hreflang` และส่ง `lang` ให้ `LanguageProvider` จึงไม่มี state ภาษาแยกจาก URL อีก

**Tech Stack:** Next.js 14.2 App Router + middleware, React, TypeScript, Vitest (jsdom)

**Spec:** `docs/superpowers/specs/2026-10-15-locale-routing-design.md`

## Global Constraints

- cookie `su_lang` ค่า `en` | `th` อายุ 1 ปี (`60 * 60 * 24 * 365`) `path=/` `SameSite=Lax` `Secure` บน production **ไม่ใช่** httpOnly
- request header: `x-su-lang` (`en`|`th`), `x-su-path` (path ที่ตัด `/th` แล้ว) ต้องลบค่าที่ client ส่งมาก่อนเสมอ
- redirect ภาษาใช้ **307** + `Cache-Control: private, no-store` + `Vary: Cookie, Accept-Language` และต้องคง query เดิมทั้งหมด
- ไม่ redirect บอท (ไม่มี `Accept-Language` หรือ UA เข้า pattern บอท) และการตรวจภาษาเครื่องเองไม่ตั้ง cookie
- `/admin/*`, `/api/*`, `/product-images/*`, static ไม่ผ่านขั้นภาษา
- clean code ตาม `CLAUDE.md` §3.5: ห้าม `any`, ลบของเก่าในงานเดียวกัน (localStorage `su-store-lang` เหลือแค่โค้ดย้ายข้อมูล, ปุ่ม EN/TH บน navbar), ไม่มี magic number
- ก่อนจบงาน: `npm run lint` · `npx tsc --noEmit` · `npm test` · `ruff check server tests` · pytest `server/tests` และ `tests/`
- deploy: `./deploy.sh store` (ไม่แตะ `server/`)

## Review Focus

1. **ลิงก์ออเดอร์ `?t=` ข้ามภาษา:** คนที่มี cookie `th` เปิด `/order/SU0001?t=abc` ต้องไปที่ `/th/order/SU0001?t=abc` โดย token ไม่หาย → Task 2 test `keeps the order token across a language redirect`
2. **preview ลิงก์ใน LINE/Facebook และ Googlebot:** UA บอทที่ส่ง `Accept-Language: th` ก็ต้องได้หน้าตาม URL ไม่โดน redirect → Task 2 test `never redirects bots`
3. **cookie เสีย/ปลอม** (`su_lang=xx`): ถือว่าไม่มี cookie แล้วใช้ภาษาเครื่องแทน ห้าม redirect วนหรือ error → Task 1 test `ignores an unknown cookie value`
4. **หน้าตัวอย่างหน้าแรกใน `/admin/home/preview`** (ใช้ `StoreShell` เหมือนกัน): ต้องไม่ย้ายค่า localStorage และไม่ navigate ออกจากหน้า admin → Task 3: `LegacyLangMigration` อยู่ใน `(main)` layout เท่านั้น และ test `StoreShell defaults to English without migrating`
5. **ร้านปิด + `/th/checkout`** สำหรับ staff ต้องยังเป็นหน้าปิดร้าน และ host always-open ต้อง rewrite `/th/...` ด้วย (ไม่ 404) → Task 2 tests `keeps Thai checkout closed for staff`, `rewrites Thai paths on always-open hosts`

---

### Task 1: Locale helpers (`src/lib/locale.ts`)

**Files:**
- Create: `src/lib/locale.ts` (ไม่มี `"use client"` ห้าม import อะไรที่เป็น client/server-only)
- Test: `src/__tests__/locale.test.ts`

**Interfaces:**
- Consumes: `Lang` จาก `@/lib/i18n` → ย้าย `export type Lang = "en" | "th"` มาไว้ที่ `locale.ts` แล้วให้ `i18n.tsx` re-export (`export type { Lang } from "@/lib/locale"`) เพราะ middleware import ไฟล์ `"use client"` ไม่ได้
- Produces:
  - `type Lang = "en" | "th"`
  - `const LANG_COOKIE = "su_lang"`, `LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365`, `LANG_HEADER = "x-su-lang"`, `PATH_HEADER = "x-su-path"`, `SITE_URL = "https://sumfu.store"`
  - `parseLang(value: string | null | undefined): Lang | null`
  - `stripLocale(pathname: string): { lang: Lang; path: string }` — `/th` → `{th, "/"}`, `/th/x` → `{th, "/x"}`, `/thai` → `{en, "/thai"}`
  - `localePath(lang: Lang, path: string): string` — `("th", "/")` → `"/th"`, `("th", "/x?y=1")` → `"/th/x?y=1"`, en คืนค่าเดิม
  - `switchLocalePath(pathname: string, search: string, lang: Lang): string`
  - `preferredLang(acceptLanguage: string | null): Lang | null` — null เมื่อ header ว่าง/ไม่มี
  - `isBot(userAgent: string | null): boolean`
  - `decideLocale(input: { pathname: string; cookie: string | undefined; acceptLanguage: string | null; userAgent: string | null }): { kind: "redirect"; to: string } | { kind: "serve"; lang: Lang; path: string }` — `to` เป็น path ไม่รวม query (middleware ต่อ query เอง)
  - `localeAlternates(lang: Lang, path: string): { canonical: string; languages: Record<"en" | "th" | "x-default", string> }` — `canonical` = path ของภาษา `lang`
  - `legacyLangAction(stored: string | null, cookie: string | undefined, pathLang: Lang): { setCookie: Lang; navigate: boolean } | null`

- [ ] **Step 1: Write the failing tests** ใน `src/__tests__/locale.test.ts`

```ts
describe("stripLocale / localePath", () => {
  it("splits the Thai prefix", () => {
    expect(stripLocale("/th")).toEqual({ lang: "th", path: "/" });
    expect(stripLocale("/th/")).toEqual({ lang: "th", path: "/" });
    expect(stripLocale("/th/products/abc")).toEqual({ lang: "th", path: "/products/abc" });
    expect(stripLocale("/thai")).toEqual({ lang: "en", path: "/thai" });
    expect(stripLocale("/products")).toEqual({ lang: "en", path: "/products" });
  });
  it("adds the prefix only for Thai", () => {
    expect(localePath("th", "/")).toBe("/th");
    expect(localePath("th", "/order/SU1?t=a")).toBe("/th/order/SU1?t=a");
    expect(localePath("en", "/checkout")).toBe("/checkout");
  });
  it("switches language and keeps the query", () => {
    expect(switchLocalePath("/order/SU1", "?t=abc", "th")).toBe("/th/order/SU1?t=abc");
    expect(switchLocalePath("/th/products/x", "", "en")).toBe("/products/x");
    expect(switchLocalePath("/th", "", "en")).toBe("/");
  });
});

describe("preferredLang / isBot", () => {
  it("reads the highest-q language", () => {
    expect(preferredLang("th-TH,th;q=0.9,en;q=0.8")).toBe("th");
    expect(preferredLang("en-US,th;q=0.9")).toBe("en");
    expect(preferredLang("en;q=0.5,th;q=0.9")).toBe("th");
    expect(preferredLang("ja-JP")).toBe("en");
    expect(preferredLang("")).toBeNull();
    expect(preferredLang(null)).toBeNull();
  });
  it("spots crawlers and link previewers", () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "facebookexternalhit/1.1", "Line/13.0", "Twitterbot/1.0", "bingbot/2.0"]) {
      expect(isBot(ua)).toBe(true);
    }
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1")).toBe(false);
  });
});

describe("decideLocale", () => {
  const human = "Mozilla/5.0 (Macintosh) Safari/605.1";
  const decide = (pathname: string, cookie: string | undefined, acceptLanguage: string | null, userAgent: string | null = human) =>
    decideLocale({ pathname, cookie, acceptLanguage, userAgent });

  it("follows the saved choice over the URL", () => {
    expect(decide("/products/x", "th", "en")).toEqual({ kind: "redirect", to: "/th/products/x" });
    expect(decide("/th/products/x", "en", "th")).toEqual({ kind: "redirect", to: "/products/x" });
  });
  it("uses the device language on a first visit", () => {
    expect(decide("/", undefined, "th-TH")).toEqual({ kind: "redirect", to: "/th" });
    expect(decide("/th/x", undefined, "ja")).toEqual({ kind: "redirect", to: "/x" });
  });
  it("serves the URL when it already matches", () => {
    expect(decide("/th/x", "th", "en")).toEqual({ kind: "serve", lang: "th", path: "/x" });
    expect(decide("/x", undefined, "en-US")).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
  it("never redirects bots or requests without a language", () => {
    expect(decide("/th/x", undefined, "en", "Googlebot/2.1")).toEqual({ kind: "serve", lang: "th", path: "/x" });
    expect(decide("/x", undefined, null)).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
  it("ignores an unknown cookie value", () => {
    expect(decide("/x", "xx", "th")).toEqual({ kind: "redirect", to: "/th/x" });
    expect(decide("/x", "xx", "en")).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
});

describe("localeAlternates", () => {
  it("links both languages with English as x-default", () => {
    expect(localeAlternates("th", "/products/x")).toEqual({
      canonical: "/th/products/x",
      languages: { en: "/products/x", th: "/th/products/x", "x-default": "/products/x" },
    });
  });
});

describe("legacyLangAction", () => {
  it("moves the old localStorage choice into the cookie once", () => {
    expect(legacyLangAction("th", undefined, "en")).toEqual({ setCookie: "th", navigate: true });
    expect(legacyLangAction("en", undefined, "en")).toEqual({ setCookie: "en", navigate: false });
    expect(legacyLangAction("th", "en", "en")).toBeNull();
    expect(legacyLangAction(null, undefined, "en")).toBeNull();
    expect(legacyLangAction("xx", undefined, "en")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/locale.test.ts` — Expected: FAIL (module not found)
- [ ] **Step 3: Implement `src/lib/locale.ts`** ตาม Interfaces; `preferredLang` แยก `,` อ่าน `;q=` (ไม่มี = 1) เลือก q สูงสุด ถ้าเท่ากันใช้ตัวแรก แล้วดู primary subtag; `isBot` ใช้ regex `/bot|crawl|spider|slurp|facebookexternalhit|line\/|whatsapp|telegram|discord|preview/i`; ย้าย `Lang` type ตามที่บอกใน Interfaces
- [ ] **Step 4: Run** `npx vitest run src/__tests__/locale.test.ts src/__tests__/localized.test.ts` และ `npx tsc --noEmit` — Expected: PASS
- [ ] **Step 5: Commit** `git add src/lib/locale.ts src/lib/i18n.tsx src/__tests__/locale.test.ts && git commit -m "feat(store): locale path helpers"`

---

### Task 2: Middleware — redirect / rewrite ตามภาษา

**Files:**
- Modify: `src/middleware.ts` (ส่วน always-open, bypass, page navigations, `gatedPageResponse`, `pageResponse`)
- Test: `src/__tests__/middlewareLocale.test.ts` (ลอกโครง `run()` จาก `middlewarePreview.test.ts` แต่รับ `headers`/`cookie` ดิบ และ stub `ALWAYS_OPEN` ได้)

**Interfaces:**
- Consumes: `decideLocale`, `LANG_COOKIE`, `LANG_HEADER`, `PATH_HEADER`, `Lang` จาก Task 1
- Produces: request header `x-su-lang` / `x-su-path` บนทุกหน้า (ทั้งภาษาไทยและอังกฤษ) — Task 3 อ่าน

ลำดับใน `middleware()` หลังแก้: admin → POST rate-limit → **ขั้นภาษา (GET + `isPageRequest`)** → bypass token → always-open → visitor cookie + gate
- ขั้นภาษาคืน redirect ทันทีถ้า `kind === "redirect"` (ต่อ `request.nextUrl.search` และใส่ header ตาม Global Constraints) ไม่งั้นได้ `{ lang, path }` ส่งต่อ
- `pageResponse(request, preview, locale)` ลบ `LANG_HEADER`/`PATH_HEADER`/`STORE_PREVIEW_HEADER` ที่ client ส่งมาแล้วตั้งใหม่; ถ้า `locale.lang === "th"` ใช้ `NextResponse.rewrite(new URL(locale.path + search, request.url), { request: { headers } })` ไม่งั้น `NextResponse.next({ request: { headers } })`
- always-open คืน `pageResponse(request, false, locale)` แทน `NextResponse.next()`
- `storeGate` ได้ `pathname: locale.path`; rewrite ไป `/maintenance` ต้องแนบ request headers ภาษาเดียวกัน
- `siteClosedReason` เช็ค `/maintenance` จาก `locale.path`

- [ ] **Step 1: Write the failing tests**

```ts
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const thaiPhone = { "accept-language": "th-TH", "user-agent": "Mozilla/5.0 (iPhone) Safari" };
const englishMac = { "accept-language": "en-US", "user-agent": "Mozilla/5.0 (Macintosh) Safari" };

it("serves Thai paths from the shared pages", async () => {
  const res = await run(false, "/th/products/x", { headers: englishMac, cookie: "su_lang=th" });
  expect(new URL(rewrittenTo(res)).pathname).toBe("/products/x");
  expect(forwarded(res, LANG_HEADER)).toBe("th");
  expect(forwarded(res, PATH_HEADER)).toBe("/products/x");
});
it("keeps the order token across a language redirect", async () => {
  const res = await run(false, "/order/SU0001?t=abc", { headers: englishMac, cookie: "su_lang=th" });
  expect(res.status).toBe(307);
  expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/th/order/SU0001?t=abc");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("vary")).toBe("Cookie, Accept-Language");
});
it("sends a Thai device to /th on a first visit", async () => {
  const res = await run(false, "/", { headers: thaiPhone });
  expect(new URL(res.headers.get("location")!).pathname).toBe("/th");
  expect(res.headers.get("set-cookie") ?? "").not.toContain("su_lang");
});
it("never redirects bots", async () => {
  const res = await run(false, "/products/x", { headers: { "accept-language": "th", "user-agent": "facebookexternalhit/1.1" } });
  expect(res.status).not.toBe(307);
});
it("drops client-sent language headers", async () => {
  const res = await run(false, "/products/x", { headers: { ...englishMac, [LANG_HEADER]: "th", [PATH_HEADER]: "/evil" } });
  expect(forwarded(res, LANG_HEADER)).toBe("en");
  expect(forwarded(res, PATH_HEADER)).toBe("/products/x");
});
it("keeps Thai checkout closed for staff", async () => {
  // staff session "Claim good" + store closed, same fake as middlewarePreview.test.ts
  const res = await run(true, "/th/checkout", { headers: thaiPhone, cookie: `${ADMIN_COOKIE}=Claim good` });
  expect(rewrittenTo(res)).toContain("/maintenance");
  expect(forwarded(res, LANG_HEADER)).toBe("th");
});
it("rewrites Thai paths on always-open hosts", async () => {
  vi.stubEnv("ALWAYS_OPEN", "1");
  const res = await run(false, "/th/products/x", { headers: thaiPhone });
  expect(new URL(rewrittenTo(res)).pathname).toBe("/products/x");
});
it("leaves admin and api routes alone", async () => {
  expect((await run(false, "/admin/login", { headers: thaiPhone })).status).not.toBe(307);
  expect((await run(false, "/api/store/products", { headers: thaiPhone })).status).not.toBe(307);
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/middlewareLocale.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** ตามลำดับใน Interfaces ข้างบน (helper `localeRedirect(request, to)` แยกไว้; `middleware()` ยังต้องอ่านง่าย)
- [ ] **Step 4: Run** `npx vitest run src/__tests__/middlewareLocale.test.ts src/__tests__/middlewarePreview.test.ts src/__tests__/storePreview.test.ts` — Expected: PASS (test preview เดิมห้ามแก้ assertion; ถ้า test เดิมไม่มี `accept-language` จะไม่โดน redirect อยู่แล้ว)
- [ ] **Step 5: Commit** `git commit -m "feat(store): route /th paths and remember language in middleware"`

---

### Task 3: ภาษาจาก server → `<html lang>`, hreflang, `LanguageProvider`

**Files:**
- Create: `src/lib/requestLocale.ts` — `requestLang(): Lang`, `requestPath(): string` อ่าน `headers()` (`parseLang(...) ?? "en"`, path default `"/"`)
- Create: `src/components/LegacyLangMigration.tsx` (`"use client"`)
- Modify: `src/app/layout.tsx` (`<html lang={requestLang()}>`, `metadataBase: new URL(SITE_URL)`)
- Modify: `src/app/(main)/layout.tsx` (ส่ง `lang` ให้ `StoreShell`, render `<LegacyLangMigration />`, เพิ่ม `generateMetadata` คืน `{ alternates: localeAlternates(requestLang(), requestPath()) }`)
- Modify: `src/components/store/StoreShell.tsx` (prop `lang?: Lang` default `"en"` → `<LanguageProvider lang={lang}>`)
- Modify: `src/lib/i18n.tsx`
- Test: `src/__tests__/languageProvider.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`LANG_COOKIE`, `LANG_COOKIE_MAX_AGE`, `switchLocalePath`, `localePath`, `stripLocale`, `legacyLangAction`), Task 2 headers
- Produces:
  - `LanguageProvider({ lang, children }: { lang: Lang; children: ReactNode })` — ไม่มี state/localStorage แล้ว
  - `useLang(): { lang: Lang; setLang: (l: Lang) => void; t: Translations[Lang] }` (รูปเดิม ผู้เรียกเดิมไม่ต้องแก้)
  - `setLang(l)`: เขียน cookie `su_lang` (ตาม Global Constraints) แล้ว `window.location.assign(switchLocalePath(location.pathname, location.search, l))` — โหลดเต็มหน้าเพื่อให้ server render ภาษาใหม่
  - `useLocalePath(): (path: string) => string` = `localePath(lang, path)` (export จาก `i18n.tsx`)
  - `LegacyLangMigration()`: ใน `useEffect` อ่าน localStorage `su-store-lang` + cookie, เรียก `legacyLangAction(stored, cookie, stripLocale(location.pathname).lang)`; ถ้าได้ action ให้ตั้ง cookie, ลบ key, และถ้า `navigate` ก็ `location.replace(switchLocalePath(...))`; คอมเมนต์ว่าเป็นโค้ดย้ายข้อมูลชั่วคราวของลูกค้าที่เคยเลือกภาษาก่อนเปลี่ยนระบบ

- [ ] **Step 1: Write the failing tests** (`languageProvider.test.tsx`, ใช้ `createRoot` + `act` แบบ `categoryView.test.tsx`)

```ts
it("uses the language given by the server", () => {
  render(<LanguageProvider lang="th"><Probe /></LanguageProvider>); // Probe แสดง useLang().lang และ useLocalePath()("/checkout")
  expect(container.textContent).toBe("th /th/checkout");
});
it("setLang saves the cookie and opens the same page in the other language", () => {
  window.history.replaceState(null, "", "/order/SU1?t=abc");
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}); // ถ้า jsdom ไม่ยอม ให้ stubGlobal location
  // คลิกปุ่มใน Probe ที่เรียก setLang("th")
  expect(document.cookie).toContain("su_lang=th");
  expect(assign).toHaveBeenCalledWith("/th/order/SU1?t=abc");
});
it("StoreShell defaults to English without migrating", () => {
  localStorage.setItem("su-store-lang", "th");
  render(<StoreShell><Probe /></StoreShell>); // mock Navbar/Footer/CartProvider/ScheduleWarningBanner ให้เบา
  expect(container.textContent).toContain("en");
  expect(localStorage.getItem("su-store-lang")).toBe("th");
  expect(document.cookie).not.toContain("su_lang");
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/languageProvider.test.tsx` — Expected: FAIL
- [ ] **Step 3: Implement** ตาม Files/Interfaces; ลบ `useState`/`useEffect`/localStorage เดิมใน `LanguageProvider`
- [ ] **Step 4: Run** `npx vitest run` และ `npx tsc --noEmit` — Expected: PASS ทั้งหมด
- [ ] **Step 5: ตรวจมือ** `./dev.sh` แล้ว `curl -s -H 'Accept-Language: en' -b 'su_lang=th' localhost:3000/th/products | grep -o '<html[^>]*>\|hreflang="[^"]*"'` — Expected: `lang="th"` และ hreflang `en`, `th`, `x-default`
- [ ] **Step 6: Commit** `git commit -m "feat(store): server-provided language, html lang and hreflang"`

---

### Task 4: ลิงก์ภายในทุกจุดใช้ path ของภาษาปัจจุบัน

**Files (Modify):** `src/components/BuyButton.tsx`, `Navbar.tsx`, `store/TrackOrder.tsx`, `store/CategoryStrip.tsx`, `store/OrderView.tsx`, `store/CategoryView.tsx`, `store/ProductCardGrid.tsx`, `store/CategoryCovers.tsx`, `store/CheckoutView.tsx` (+ `router.push(orderPageHref(...))`), `store/ProductDetail.tsx` (`router.replace(...?design=)`, `router.push("/checkout")`), `src/app/(fullscreen)/maintenance/MaintenanceClient.tsx`, `src/components/ScheduleWarningBanner.tsx`, `src/app/(main)/check-order/fp28/page.tsx`, `src/app/(main)/check-order/page.tsx` (server `redirect` → `localePath(requestLang(), ...)`), และลิงก์ภายในใน `src/components/store/home/*` ถ้ามี
- Test: `src/__tests__/categoryView.test.tsx` (เพิ่ม test ใหม่ ไม่แก้ assertion เดิม)

**Interfaces:**
- Consumes: `useLocalePath()` (Task 3), `localePath`, `requestLang()`
- Produces: ไม่มี API ใหม่; `orderPageHref` คงรูปเดิม ผู้เรียกห่อด้วย `localePath`

ค้นให้ครบด้วย `grep -rnE 'href="/|href=\{`/|router\.(push|replace)\(|redirect\(' src --include='*.tsx' | grep -v admin` — ทุกผลลัพธ์ที่เป็นหน้าร้านต้องผ่าน `useLocalePath`/`localePath` (ยกเว้น `/api/*`, `/images/*`, `/product-images/*`, ลิงก์ภายนอก) หน้า maintenance ไม่มี `LanguageProvider` → ใช้ `stripLocale(location.pathname).lang`

- [ ] **Step 1: Write the failing test** ใน `categoryView.test.tsx`

```ts
it("links back to the products page in Thai under /th", () => {
  // render <LanguageProvider lang="th"><CategoryView .../></LanguageProvider>
  expect(container.querySelector('a[href="/th/products"]')).not.toBeNull();
  expect(container.querySelector('a[href="/th/products/keychain"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/categoryView.test.tsx` — Expected: FAIL
- [ ] **Step 3: Implement** แก้ทุกไฟล์ในรายการ
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, และ grep ข้างบน — Expected: PASS และไม่มี path หน้าร้านที่ไม่ผ่าน helper
- [ ] **Step 5: Commit** `git commit -m "feat(store): keep internal links in the current language"`

---

### Task 5: ตัวเลือกภาษาใน footer, เอาปุ่มออกจาก navbar, อัปเดตเอกสาร

**Files:**
- Create: `src/components/LanguagePicker.tsx` (`"use client"`)
- Modify: `src/components/Footer.tsx` (วาง `<LanguagePicker />` ในแถวล่างสุดข้าง ©), `src/components/Navbar.tsx` (ลบปุ่ม EN/TH ทั้ง desktop และ mobile + `setLang` ที่ไม่ใช้แล้ว, แก้คอมเมนต์ "Mobile: lang toggle + ...")
- Modify: `CLAUDE.md` — รายการ cookie เป็น 4 ตัว (เพิ่ม `su_lang`: ภาษาที่ลูกค้าเลือกเอง อายุ 1 ปี เป็น cookie จำค่าที่เลือก ไม่ติดตามตัวตน), บรรทัด "ข้อความ 2 ภาษา" ให้บอกว่า ภาษามาจาก URL (`/` = EN, `/th/` = TH, `src/lib/locale.ts` + middleware), ลิงก์ภายในใช้ `useLocalePath()`, ตัวเลือกภาษาอยู่ footer; "ข้อมูลที่ browser ใช้คนเดียว" ตัดคำว่า "ภาษา" ออก
- Test: `src/__tests__/languagePicker.test.tsx`

**Interfaces:**
- Consumes: `useLang()` (Task 3), `usePathname` จาก `next/navigation`, `stripLocale`, `localePath`
- Produces: `LanguagePicker(): JSX.Element`

UI (ตาม spec, เป็นการตัดสินใจของผู้ออกแบบ): ไอคอน `Globe` (lucide) + `English · ไทย`; ภาษาปัจจุบันเป็น `<span aria-current="true">` ตัวหนาสีขาว; อีกภาษาเป็น `<a href={localePath(other, stripLocale(usePathname()).path)} lang={other} hrefLang={other}>` ที่ `onClick` → `preventDefault()` + `setLang(other)`; tap target `min-h-11`; สี/ขนาดตามแถว © เดิม (`text-xs text-zinc-500`, hover `text-white`) — `stripLocale` รองรับทั้งกรณี `usePathname()` คืน `/th/x` หรือ `/x`

- [ ] **Step 1: Write the failing test**

```ts
vi.mock("next/navigation", () => ({ usePathname: () => "/products/x" }));
it("shows the current language and links to the other one", () => {
  render(<LanguageProvider lang="en"><LanguagePicker /></LanguageProvider>);
  expect(container.querySelector('[aria-current="true"]')?.textContent).toBe("English");
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/th/products/x");
  expect(link.textContent).toBe("ไทย");
});
it("switches language on click", () => {
  // spy window.location.assign แบบ Task 3, คลิก link
  expect(document.cookie).toContain("su_lang=th");
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/languagePicker.test.tsx` — Expected: FAIL
- [ ] **Step 3: Implement** `LanguagePicker`, แก้ Footer/Navbar/CLAUDE.md
- [ ] **Step 4: Run ครบตาม checklist** `npm run lint && npx tsc --noEmit && npm test && ruff check server tests` และ pytest ทั้ง `server/tests` และ `tests/` (env ตาม `.github/workflows/ci.yml`) — Expected: ผ่านทั้งหมด
- [ ] **Step 5: ตรวจมือบน `./dev.sh`** (มือถือ 375px + desktop): navbar ไม่มีปุ่มภาษา; footer สลับ EN↔TH แล้วอยู่หน้าเดิม; เปิด `/order/<code>?t=...` หลังเลือกไทยแล้วไป `/th/order/...` และเห็นออเดอร์; ลบ cookie แล้วตั้งภาษา browser เป็นไทย เปิด `/` → `/th`
- [ ] **Step 6: Commit** `git commit -m "feat(store): language picker in footer, remove navbar toggle"`
