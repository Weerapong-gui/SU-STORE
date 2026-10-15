# ภาษาตาม URL (`/` อังกฤษ, `/th/` ไทย) + ตัวเลือกภาษาใน footer

วันที่: 2026-10-15 · สถานะ: รออนุมัติ

## ทำไม

1. **แชร์ลิงก์แล้วอีกฝ่ายเห็นคนละภาษา** — ตอนนี้ภาษาเก็บใน localStorage (`su-store-lang`) และสลับฝั่ง browser ผ่าน `useLang()` URL จึงไม่บอกภาษา
2. **อยากให้ navbar สะอาดขึ้น** — เอาปุ่ม EN/TH ออกจาก navbar (ทั้ง desktop และ mobile) ย้ายไปเลือกที่ footer

แนวทางอ้างอิงจาก apple.com: ภาษาผูกกับ path, ทุกหน้ามี `<link rel="alternate" hreflang>` ชี้หากัน

## สิ่งที่เจ้าของตัดสินใจแล้ว

- **ภาษาอังกฤษอยู่ที่ path เดิม (`/...`) ภาษาไทยอยู่ใต้ `/th/...`** เช่น `/products/abc` ↔ `/th/products/abc` (ลิงก์ที่แชร์กันอยู่ตอนนี้ยังใช้ได้และยังเป็นอังกฤษ)
- **คนที่เคยเลือกภาษาแล้ว:** เว็บจำไว้และพาไปภาษาที่เลือกเสมอ แม้จะเปิดลิงก์ของอีกภาษา (`/products/abc` → `/th/products/abc`)
- **คนมาครั้งแรก (ยังไม่เคยเลือก):** ดูภาษาเครื่อง ถ้าเป็นไทย → `/th/...` ภาษาอื่นทั้งหมด → อังกฤษ
- **ตัวเลือกภาษาอยู่ใน footer** ปุ่มบน navbar ถูกลบ

## เป้าหมาย / ไม่ใช่เป้าหมาย

เป้าหมาย
- ทุกหน้าร้าน (กลุ่ม `(main)` และ `(fullscreen)/maintenance`) เปิดได้ทั้ง 2 ภาษาตาม path
- server render ภาษาถูกตั้งแต่แรก ไม่มีจังหวะเห็นภาษาผิดแล้วกระพริบเปลี่ยน
- ลิงก์ภายในเว็บทุกตัวพาไป path ของภาษาปัจจุบัน (ไม่พึ่ง redirect)
- `<html lang>`, `hreflang` + `canonical` ถูกต้องในทุกหน้าที่ index ได้

ไม่ใช่เป้าหมาย
- หลังร้าน `/admin/*`, `/api/*`, `/product-images/*` ไม่เปลี่ยน
- ไม่แปล `<title>`/meta description เพิ่มจากที่มี (ทำทีหลังได้)
- ไม่ทำแถบแนะนำภาษาแบบ Apple (เราใช้ redirect อัตโนมัติแทน)
- ไม่เพิ่มภาษาที่ 3

Anti-goal (ถ้าเกิดถือว่าพัง แม้จะ "ทำงาน")
- redirect วนไม่จบ
- Google เก็บหน้า `/th/` ไม่ได้เพราะบอทโดน redirect
- ลิงก์ออเดอร์หลุด `?t=` ระหว่าง redirect จนลูกค้าเข้าออเดอร์ไม่ได้
- ปิดร้าน/โหมด preview ของ staff หรือ rate limit ทำงานผิดเพราะ path มี `/th`

## การทำงาน

### กติกาเลือกภาษา (middleware, เฉพาะ GET ของหน้าเว็บ)

```
pathLang  = path คือ "/th" หรือขึ้นต้น "/th/" ? th : en
wanted    = cookie su_lang (ถ้ามีและเป็น en|th)
            ?? (ไม่ใช่บอท และมี Accept-Language ? ภาษาเครื่อง : ไม่มี)
ถ้า wanted มี และ ≠ pathLang  → 307 ไป path เดียวกันของอีกภาษา (คง query ทั้งหมด)
ไม่งั้น ถ้า pathLang = th      → rewrite ไป path ที่ตัด "/th" ออก + ตั้ง request header ภาษา
```

- **ภาษาเครื่อง** = ภาษาแรกที่ q สูงสุดใน `Accept-Language` ถ้า primary subtag เป็น `th` → th, อย่างอื่น → en
- **บอท:** ไม่มี `Accept-Language` หรือ User-Agent เข้า pattern บอท (googlebot, bingbot, facebookexternalhit, line, twitterbot ฯลฯ) → ไม่ redirect เลย (link preview ใน LINE/Facebook จะได้ภาษาตามลิงก์)
- ตรวจภาษาเครื่องเองไม่ตั้ง cookie — cookie ตั้งเฉพาะตอนผู้ใช้เลือกใน footer (จะได้ไม่มี cookie ของคนที่ไม่เคยเลือก)
- ใช้ 307 (ชั่วคราว) เพราะผลขึ้นกับผู้ใช้ ห้าม cache เป็น permanent; response redirect ใส่ `Cache-Control: private, no-store` และ `Vary: Cookie, Accept-Language` กัน Cloudflare/browser จำ redirect ของคนอื่น
- `/th` เฉยๆ = หน้าแรกภาษาไทย, `/thai` ไม่นับเป็นภาษาไทย

### ลำดับใน `src/middleware.ts`

ขั้นภาษาต้องอยู่ **ก่อน** การ return เร็วของ `isAlwaysOpen` และก่อน gate ปิดร้าน (ไม่งั้นบน staging/Docker `/th/...` จะ 404) และอยู่ **หลัง** ส่วน admin และ rate-limit POST (ไม่เกี่ยวกับภาษา)

- gate ปิดร้าน (`storeGate`) และการเลือก `ORDER_PATHS` ต้องใช้ path ที่ตัด `/th` แล้ว
- rewrite ไป `/maintenance` ต้องคง header ภาษาไว้ หน้าปิดร้านจึงขึ้นภาษาเดียวกับ path
- header ภาษา (`x-su-lang`) และ path ที่ตัดแล้ว (`x-su-path`) ต้องลบค่าที่ client ส่งมาก่อนเสมอ แบบเดียวกับ `STORE_PREVIEW_HEADER`
- bypass token redirect ยังทำงานบน `/th/...?token=`

### Cookie `su_lang`

- ค่า `en` | `th`, อายุ 1 ปี, `path=/`, `SameSite=Lax`, `Secure` บน production, **ไม่** httpOnly (ตั้งจาก footer ฝั่ง browser)
- เป็น cookie จำค่าที่ผู้ใช้เลือกเอง ไม่ติดตามตัวตน → ยังไม่ต้องมี cookie banner; อัปเดตรายการ cookie ใน `CLAUDE.md` เป็น 4 ตัว

### ฝั่ง React

- `LanguageProvider` รับ `initialLang` จาก server (layout อ่าน `x-su-lang`) แทนการอ่าน localStorage — ไม่มี state ภาษาแยกจาก URL อีก
- `setLang(l)` = ตั้ง cookie `su_lang` แล้ว navigate ไป path เดียวกันของภาษา `l` (คง query)
- helper กลางใน `src/lib/locale.ts` (ไฟล์เดียว ไม่มี `"use client"` ใช้ได้ทั้ง middleware/server/client):
  - `localePath(lang, path)` — เติม `/th` ให้ path ภายใน
  - `stripLocale(pathname)` → `{ lang, path }`
  - `switchLocalePath(pathname, search, lang)` — สำหรับ redirect และ footer
  - `preferredLang(acceptLanguage)`, `isBot(userAgent)`, `decideLocale(...)` (pure function ของกติกาข้างบน ทดสอบได้)
- hook `useLocalePath()` คืนฟังก์ชันเติม prefix ตามภาษาปัจจุบัน ใช้กับ `<Link href>`, `router.push/replace` ทุกจุดในหน้าร้าน ได้แก่ `BuyButton`, `Navbar`, `TrackOrder`, `CategoryStrip`, `OrderView`, `CategoryView`, `ProductCardGrid`, `CategoryCovers`, `CheckoutView`, `ProductDetail`, `MaintenanceClient`, `ScheduleWarningBanner`, `check-order/fp28` และ `orderPageHref`
- server redirect (`check-order/page.tsx`) ใช้ `localePath` กับภาษาจาก header
- `<html lang>` ใน `src/app/layout.tsx` = `th` หรือ `en` จาก header

### ย้ายค่าเดิมของลูกค้าเก่า

ถ้า browser มี localStorage `su-store-lang` แต่ไม่มี cookie `su_lang` ตอนโหลดหน้าแรก: ตั้ง cookie ตามค่านั้น, ลบ key เดิม, และถ้าไม่ตรงกับภาษาของ path ก็ navigate ไปอีกภาษา (ครั้งเดียว) คอมเมนต์ไว้ว่าเป็นโค้ดย้ายข้อมูลชั่วคราว

### SEO

- layout `(main)` สร้าง `alternates` จาก `x-su-path`: `canonical` = path ของภาษาตัวเอง, `languages: { en: "/x", th: "/th/x", "x-default": "/x" }` บน `metadataBase` `https://sumfu.store`
- หน้าออเดอร์ยัง `noindex` เหมือนเดิม

### Footer

ตัวเลือกภาษาอยู่แถวล่างสุดของ footer (แถวลิขสิทธิ์) เป็นไอคอนลูกโลก + `English · ไทย` (ภาษาปัจจุบันตัวหนาสีขาว) อีกภาษาเป็นลิงก์จริง (`<a href>` ไป path ของอีกภาษา) ที่ onClick ตั้ง cookie ก่อน navigate — **เป็นการตัดสินใจของผู้ออกแบบ** ยังไม่ได้ให้เจ้าของดู

## ข้อจำกัด

- กฎ clean code ใน `CLAUDE.md` §3.5: ห้าม `any`, ไฟล์ < ~400 บรรทัด, ลบของเก่าในงานเดียวกัน (localStorage key, ปุ่มบน navbar, `setLangState` เดิม)
- เป็นงาน Next.js อย่างเดียว ไม่แตะ `server/` → deploy ด้วย `./deploy.sh store`
- ต้องผ่าน: `npm run lint`, `npx tsc --noEmit`, `npm test` (+ ruff/pytest ตาม checklist แม้ไม่แตะ server)

## ทดสอบ

- unit (vitest, `src/__tests__/locale.test.ts`): `preferredLang` (th-TH, th;q=0.9 หลัง en, ว่าง), `isBot`, `stripLocale` (`/th`, `/th/`, `/thai`), `switchLocalePath` คง query (`?t=`), `decideLocale` ครบทุกแถวของกติกา
- middleware (ตามแบบ `middlewarePreview.test.ts`): `/th/products/x` rewrite + header; cookie th บน `/products/x` → 307 `/th/products/x`; บอทไม่ redirect; header ที่ client ปลอมมาถูกลบ; ปิดร้าน + `/th/checkout` ยังเป็น closed สำหรับ staff; always-open ยัง rewrite `/th`
- ตรวจมือ: แชร์ลิงก์ออเดอร์ `?t=` ข้ามภาษา, footer สลับไป-กลับ, เครื่องภาษาไทยเปิด `/` ครั้งแรก

## เหลือให้ผู้สร้างตัดสินใจ

- รายการ pattern บอทที่แน่นอน
- ชื่อ/ตำแหน่ง component ตัวเลือกภาษา (แนะนำ `src/components/LanguagePicker.tsx`)
- รายละเอียด style ของ footer picker ตามโทนเดิม
