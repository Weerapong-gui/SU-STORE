---
name: deploy
description: Deploy SU STORE to the production server (order-api and/or su-store), SSH into the arch server, and run the docker commands used for checking the live services. Use when deploying, restarting a container, tailing production logs, or inspecting the production database.
---

# Deploy SU STORE

## เลือก script

| แก้ไขอะไร | คำสั่ง | ผลกระทบต่อลูกค้า |
|-----------|--------|----------------|
| เฉพาะ `server/` (order-api + templates) | `./deploy.sh api` (หรือ `bash deploy-api.sh`) | order-api restart ~3-5 วินาที |
| เฉพาะ Next.js (`src/`, `public/`) | `./deploy.sh store` | su-store restart หลัง build เสร็จ |
| ทั้งคู่ | `./deploy.sh` | ทั้งสอง service restart |

**ห้ามใช้ `./deploy.sh` (all) ถ้าแก้แค่ `server/`** — มัน rebuild Next.js ไปด้วย

## ขั้นตอนภายใน `deploy.sh`

```
1. ปฏิเสธถ้ามี uncommitted changes — deploy เฉพาะ HEAD ที่ commit แล้ว
2. git archive HEAD → rsync ขึ้น /home/park/SU-STORE/ (ใช้ SSH key, ไม่ใช้ password)
   .env / .env.local / data/ ไม่อยู่ใน git จึงไม่ถูกแตะ
3. เขียน REVISION (commit + เวลา) ไว้บน server
4. docker compose up -d --build --no-deps <services>
5. รอ healthcheck จน healthy (fail ถ้าเกิน 90 วินาที)
6. warm Next.js image cache (เฉพาะ store/all)
```

ไม่ restart cloudflared — ไม่จำเป็น container restart แล้ว tunnel ต่อเองได้

## SSH เข้าเซิร์ฟเวอร์

```bash
ssh park@100.94.120.103   # Tailscale (ค่า default ของ deploy.sh)
ssh park@192.168.31.242   # LAN — ใช้ได้ถ้าอยู่วงเดียวกัน: DEPLOY_HOST=park@192.168.31.242 ./deploy.sh
```

ดูว่า production รัน commit ไหน: `ssh park@100.94.120.103 cat SU-STORE/REVISION`

## คำสั่งที่ใช้บ่อยบนเซิร์ฟเวอร์

```bash
docker ps                                    # containers ที่รัน
docker logs --tail=100 su-order-api          # log ของ order-api
docker logs --tail=100 su-store              # log ของ Next.js
docker exec su-store wget -qO- http://order-api:10000/health   # ทดสอบ connectivity ระหว่าง container
docker stats --no-stream                     # CPU/mem ต่อ container
df -h                                        # เช็คก่อนถ้า deploy ล้มด้วย ENOSPC
docker system prune -a -f                    # ล้าง image เก่าเมื่อ disk ใกล้เต็ม
```

## แตะ production database

DB อยู่ที่ `/home/park/SU-STORE/data/order-api/su-order-api/orders.db` (SQLite + WAL)

**อ่านอย่างเดียว** ให้เปิดแบบ read-only เสมอ:

```python
sqlite3.connect("file:/home/park/SU-STORE/data/order-api/su-order-api/orders.db?mode=ro", uri=True)
```

**ก่อนแตะอะไรที่เขียนข้อมูล** ต้อง backup ด้วย `Connection.backup()` ไม่ใช่ `cp` (มี WAL อยู่ ไฟล์ที่ copy มาอาจไม่ consistent):

```python
s = sqlite3.connect("file:<db>?mode=ro", uri=True); d = sqlite3.connect("<dest>.db")
with d: s.backup(d)
```

## หลัง deploy

รอ ~30 วินาที แล้วรีเฟรชหน้า admin ตรวจว่าขึ้นปกติ จากนั้น commit + push
