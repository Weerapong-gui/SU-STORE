# SU-STORE

เว็บร้านค้าขององค์การนักศึกษา มฟล. (https://sumfu.store)

เริ่มจากเว็บขาย Fresher Package 28 แล้วค่อยๆ ปรับมาเป็นร้านที่ขายของได้หลายอย่าง
ข้อมูลออเดอร์ FP28 เดิมยังอยู่ใน DB เหมือนเดิม ส่วนระบบใหม่ใช้ตาราง `store_*` แยกออกมา

มีสองส่วน

- `su-store` หน้าเว็บ Next.js 14 (หน้าร้าน + หลังร้านที่ `/admin`)
- `su-order-api` Python (`server/order_api.py`) เก็บข้อมูลใน SQLite, API ของร้านใหม่อยู่ใต้ `/v2/` (โค้ดใน `server/store/`)

## รันในเครื่อง

```bash
./dev.sh
```

สคริปต์จะสร้าง `.env.local` ให้ถ้ายังไม่มี แล้วเปิด order-api ที่พอร์ต 10000 กับ Next ที่พอร์ต 3000
DB ที่ใช้คือ `data/dev/orders.db` ไม่ใช่ของจริง ลบทิ้งได้ตลอด

เข้าหลังร้านที่ http://localhost:3000/admin ด้วย `staff` / `dev`

## เทสต์

```bash
npm test
npx tsc --noEmit && npm run lint

python3 -m pytest server/tests/
python3 -m pytest tests/
```

pytest ต้องรันแยกสองรอบ เพราะทั้งสองโฟลเดอร์ชื่อ package `tests` เหมือนกัน รวมกันแล้วจะชน

## Deploy

production รันบนเครื่อง arch ของเรา ใช้ Docker Compose และเปิดออกเน็ตผ่าน Cloudflare Tunnel

```bash
./deploy.sh          # ทั้งสอง service
./deploy.sh store    # เฉพาะหน้าเว็บ
./deploy.sh api      # เฉพาะ order-api (แก้แค่ server/ ใช้อันนี้ เร็วกว่า)
```

ต้อง commit ให้เรียบร้อยก่อน ถ้ามีไฟล์ค้างสคริปต์จะไม่ยอม deploy
มันจะส่งโค้ดตาม commit ปัจจุบันขึ้นไป build ใหม่ รอจน container healthy แล้วค่อยเขียน `REVISION`
ค่าเริ่มต้นจะต่อไปที่ `park@100.94.120.103` (Tailscale) ถ้าจะใช้ host อื่นให้ตั้ง `DEPLOY_HOST`

ข้อมูลจริงอยู่บน host ที่

- DB: `/home/park/SU-STORE/data/order-api/su-order-api/orders.db`
- สลิป: `/home/park/SU-STORE/data/order-api/su-order-api/slips/`

backup DB ให้ใช้ `sqlite3 orders.db ".backup ..."` ห้าม `cp` เพราะเป็นโหมด WAL ไฟล์ที่ได้อาจไม่ครบ

## หลังร้าน

- `/admin` (หลังร้านใหม่) ใช้เพิ่มสินค้า ตั้งไซซ์/สี/สต็อก ตรวจสลิป เปลี่ยนสถานะออเดอร์ ดูยอดขาย และเปิด/ปิดหน้าร้าน
  login ด้วยบัญชีใน `admin_users`
- admin FP28 ตัวเก่า (`admin.sumfu.xyz`) กับ claim station ยังใช้ดูออเดอร์ FP28 ได้

เลขออเดอร์ร้านใหม่เป็น `SU{ปีเดือน}-{ลำดับ}` เช่น `SU2610-0001` เริ่มนับใหม่ทุกเดือน
ออเดอร์ FP28 เดิมเป็นแบบ `FP2801501`

## อ่านเพิ่ม

รายละเอียดโครงสร้าง server, tunnel และข้อควรระวังเวลาแก้โค้ดอยู่ใน `CLAUDE.md` กับ `server/CLAUDE.md`

`render.yaml` กับ `docker-compose.order-api.yml` เป็นของเก่าตอนที่เคยคิดจะย้ายไป Render ตอนนี้ไม่ได้ใช้
