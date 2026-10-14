# Mobile layout audit: หน้าร้านทุกหน้า

วันที่: 2026-10-14 · วัดด้วย headless Brave (puppeteer-core, mobile emulation, DPR 2) ที่ 320px และ 375px ทั้งภาษา TH และ EN
ข้อมูลทดสอบ: พวงกุญแจ 14 ลาย (ชื่ออังกฤษยาว เช่น "Anti-Aging and Regenerative Science"), เสื้อโปโล, ตะกร้า 3 รายการ, ออเดอร์ที่ยังไม่โอนและที่อัปสลิปแล้ว, ประกาศยาว 4 บรรทัด

## เกณฑ์และวิธีวัด

| เกณฑ์ | วิธีวัด |
|-------|---------|
| ไม่เลื่อนซ้าย-ขวา | `document.documentElement.scrollWidth > ความกว้างที่ตั้ง` (ใช้ความกว้างที่ตั้ง ไม่ใช่ `innerWidth` เพราะ mobile emulation ขยาย viewport ตามเนื้อหาที่ล้น) และหา element ที่ `right` เกินขอบ |
| tap target ≥ 44px | `getBoundingClientRect` ของ a / button / input / select (ไม่นับลิงก์ inline ในย่อหน้า) |
| input ≥ 16px | `getComputedStyle().fontSize` ของ input / select / textarea |
| sticky ไม่บัง | เลื่อนสุดหน้า ดูภาพว่า bar ไม่ทับเนื้อหาสุดท้าย/footer และ navbar ยังกดได้ |
| ชื่อยาวขึ้นบรรทัดใหม่ | ดูภาพ + ไม่มี element ล้นขอบ |

## ผลต่อหน้า (ก่อนแก้ → หลังแก้)

ตาราง: ล้น = ไม่เลื่อนซ้าย-ขวา, Tap = tap target ≥ 44px, Input = font ≥ 16px, Sticky = sticky ไม่บัง, ชื่อ = ชื่อยาวขึ้นบรรทัดใหม่ · "ผ่าน" ทั้ง 320 และ 375 หลังแก้

| หน้า | ล้น | Tap | Input | Sticky | ชื่อ | หมายเหตุ / สิ่งที่แก้ |
|------|-----|-----|-------|--------|------|-----------------------|
| `/` ทุกบล็อก | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | Navbar/footer/ปุ่ม hero ต่ำกว่า 44px (แก้ที่ component ด้านล่าง) · บล็อกหมวดหมู่ไม่มี padding ล่าง ติดบล็อกถัดไป/footer จึงเพิ่ม `pb-10 md:pb-14` · จุดสไลด์ hero สูง 8px ห่อด้วยปุ่ม `h-11 min-w-11` (วัด 3 และ 6 สไลด์ทั้ง 320/375: ทุกปุ่ม 44×44, 6 จุดกว้างรวม 264px พอดีใน 320px, ไม่ล้น) · wrapper ของจุดใส่ `pointer-events-none` (ปุ่ม `pointer-events-auto`) เพื่อไม่ให้บังการแตะปุ่ม CTA ของสไลด์ |
| `/products` | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | ตกเพราะ navbar/footer เท่านั้น |
| `/products/c/[category]` | ผ่าน | ผ่าน (เดิมตก) | ผ่าน (16px) | ผ่าน | ผ่าน | แถบค้นหา sticky ใช้ `-mx-4 px-4` แต่ Container เป็น `px-6` ทำให้ขอบไม่ตรง 8px → แก้เป็น `-mx-6 px-6` · พื้นหลังแถบเปลี่ยนจาก `bg-white/95` เป็น `bg-white` (เห็นตัวอักษรการ์ดทะลุ) · ลิงก์ "‹ Shop" (EN) กว้าง 41px → `min-w-11` |
| หน้าเสื้อ `/products/polo` | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | BuyBar อยู่เหนือ footer ไม่บังเนื้อหาสุดท้าย |
| หน้าลาย `/products/keychain` | ผ่าน (เดิมล้น 938px) | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | `fieldset` ของ DesignPicker มี `min-width: min-content` ทำให้แถวลายที่เลื่อนข้างได้ดันทั้งหน้ากว้าง → `min-w-0` ที่ fieldset, `grid-cols-1` + `min-w-0` ที่คอลัมน์ของ ProductDetail |
| `/checkout` (ตะกร้า 3 รายการ) | ผ่าน (เดิมล้นที่ 320: 343px) | ผ่าน (เดิมตก) | ผ่าน (เดิม 14px) | ผ่าน | ผ่าน | แถวสินค้าจัดเป็น grid: รูป / ชื่อ / ราคา แถวแรก, ปุ่มจำนวนเต็มแถวถัดไป (ปุ่ม − + เป็น 44px, ปุ่มลบและชื่อสินค้า min-h 44px) · input เป็น `text-base` · ลิงก์ "เลือกซื้อต่อ" สูง 44px |
| `/order/[code]` ยังไม่โอน | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | ปุ่มคัดลอกเลขบัญชี 40px → 44px · ปุ่ม "คัดลอกลิงก์" 36px → 44px |
| `/order/[code]` อัปสลิปแล้ว | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | แก้ชุดเดียวกับหน้าบน · ลิงก์ในหน้า "ไม่พบออเดอร์" สูง 44px |
| `/check-order` | ผ่าน | ผ่าน (เดิมตก) | ผ่าน (เดิม 14px) | ผ่าน | ผ่าน | input `text-base` · ลิงก์ไปหน้า FP28 สูง 44px |
| `/check-order/fp28` | ผ่าน | ผ่าน (เดิมตก) | ผ่าน (เดิม 14px) | ผ่าน | ผ่าน | input `text-base` |
| `/maintenance` manual / schedule / beRightBack | ผ่าน | ผ่าน | n/a | ผ่าน | ผ่าน | วัดโดยดักคำขอ `/api/site-status` ให้ตอบว่าปิด (dev ตั้ง ALWAYS_OPEN) · ประกาศยาวขึ้นบรรทัดใหม่ในกล่อง |
| แถบ preview (`StorePreviewBar`) | จำลอง | n/a | n/a | จำลอง (เดิมตก) | จำลอง | เดิม `sticky top-0 z-[60]` สูง 56px ทับ navbar (สูง 65px, sticky top-0 เหมือนกัน) เหลือให้กดแค่ 9px → ไม่ให้ sticky (วัดโดยฉีด element ที่ class เดียวกัน เพราะ dev ปิดร้านจริงไม่ได้) |
| แถบประกาศ | ผ่าน | n/a | n/a | ผ่าน | ผ่าน | ข้อความยาว 4 บรรทัดที่ 320px ไม่ล้น |
| เมนู navbar มือถือ | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | ปุ่มโลโก้/ภาษา/ตะกร้า/เมนู 28–37px → 44px · พื้นหลังเมนู `bg-[rgba(255,255,255,0.96)]` เห็นเนื้อหาทะลุ → `bg-white` |
| Footer | ผ่าน | ผ่าน (เดิมตก) | n/a | ผ่าน | ผ่าน | ลิงก์โซเชียลสูง 20px → `min-h-11` |

## ไฟล์ที่แก้

`Navbar.tsx`, `Footer.tsx`, `BuyButton.tsx`, `BankAccountCopyField.tsx`, `store/{CategoryView,CheckoutView,DesignPicker,OrderView,ProductDetail,StorePreview,TrackOrder}.tsx`, `store/home/{HeroSlider,HomeBlocks}.tsx`, `app/(main)/check-order/fp28/page.tsx`

## ข้อจำกัดของการวัด

- แถบ preview ("จำลอง") วัดด้วยการฉีด element ที่ใช้ class เดียวกัน ไม่ใช่เส้นทาง staff + ปิดร้านจริง
- จุดสไลด์ hero วัดแล้วกับ 3 และ 6 สไลด์ (สูงสุดที่ระบบรับคือ 6)
- ไม่ได้ทดสอบบนอุปกรณ์จริง (เฉพาะ emulation)
