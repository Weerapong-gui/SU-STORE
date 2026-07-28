---
name: deploy
description: Deploy SU STORE to the production server (order-api and/or su-store), SSH into arch.sumfu.xyz, and run the docker commands used for checking the live services. Use when deploying, restarting a container, tailing production logs, or inspecting the production database.
---

# Deploy SU STORE

## เลือก script

| แก้ไขอะไร | script | ผลกระทบต่อลูกค้า |
|-----------|--------|----------------|
| เฉพาะ `server/` (order-api + templates) | `bash deploy-api.sh` | order-api restart ~3-5 วินาที |
| Next.js frontend (`src/`) | `bash deploy.sh` | su-store + order-api restart ~1-3 นาที |
| ทั้งคู่ | `bash deploy.sh` | ~1-3 นาที |

**ห้ามใช้ `deploy.sh` ถ้าแก้แค่ `server/`** — มัน rebuild Next.js ไปด้วย ระหว่างนั้นลูกค้าเห็น "Unable to connect to the ordering service right now"

## ขั้นตอนภายใน `deploy-api.sh`

```
1. tar เฉพาะ ./server และ ./docker-compose.yml (~60KB, ไม่รวม .env)
2. scp ขึ้น server ด้วย deploy key ~/.ssh/su_store_deploy_ed25519
3. extract ที่ /home/park/SU-STORE/
4. docker compose up -d --build --no-deps order-api   (su-store ไม่ถูกแตะ)
```

ไม่ restart cloudflared → tunnel ไม่ดับ
`deploy.sh` **restart** `cloudflared` (tunnel ของ `sumfu.xyz`) → ดับ ~10-15 วินาที แต่ไม่กระทบ `sumfu.store` เพราะคนละ tunnel (`cloudflared-store`)

## SSH เข้าเซิร์ฟเวอร์

```bash
ssh park@arch.sumfu.xyz          # ใช้ key ที่ติดตั้งไว้แล้ว ไม่ต้องใส่ password
```

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
