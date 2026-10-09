"""SU STORE v2 — generic multi-product catalog and orders.

Lives beside the FP28 (v1) tables in the same SQLite file. Everything here is additive:
only `store_*` tables are created or written, v1 tables (`orders`, `products`, …) are
never touched. Functions take an open connection and raise StoreError for anything the
caller should turn into an HTTP error.

Money and stock are computed here, never taken from the client: an order payload carries
only variant ids, quantities and buyer details.
"""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

TZ_BANGKOK = timezone(timedelta(hours=7))

ORDER_PREFIX = "SU"

# Buyer details a product may ask for. name/phone/email are always required; the rest
# are opt-in per product (union across the cart). Labels are shown as-is in the UI.
BUYER_FIELDS: dict[str, str] = {
    "name": "ชื่อ-นามสกุล",
    "phone": "เบอร์โทรศัพท์",
    "email": "อีเมล",
    "studentCode": "รหัสนักศึกษา",
    "school": "สำนักวิชา",
    "lineId": "LINE ID",
    "address": "ที่อยู่จัดส่ง",
    "note": "หมายเหตุถึงผู้ขาย",
}
ALWAYS_REQUIRED_FIELDS = ("name", "phone", "email")
OPTIONAL_FIELDS = tuple(k for k in BUYER_FIELDS if k not in ALWAYS_REQUIRED_FIELDS)

# status -> Thai label. Order of keys is the normal flow.
ORDER_STATUSES: dict[str, str] = {
    "pending_payment": "รอโอนเงิน",
    "waiting_confirm": "รอตรวจสลิป",
    "paid": "ชำระแล้ว",
    "ready": "พร้อมรับสินค้า",
    "completed": "รับสินค้าแล้ว",
    "cancelled": "ยกเลิก",
}
PRODUCT_STATUSES: dict[str, str] = {
    "draft": "ฉบับร่าง",
    "active": "เปิดขาย",
    "archived": "ปิดการขาย",
}

MAX_ITEMS_PER_ORDER = 20
MAX_QTY_PER_ITEM = 50
MAX_FIELD_LENGTH = 500


class StoreError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso() -> str:
    return datetime.now(TZ_BANGKOK).replace(microsecond=0).isoformat()


# ── Schema ────────────────────────────────────────────────────────────────────

def ensure_store_db(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS store_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            images_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL DEFAULT 'draft',
            buyer_fields_json TEXT NOT NULL DEFAULT '[]',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS store_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES store_products(id),
            size TEXT NOT NULL DEFAULT '',
            color TEXT NOT NULL DEFAULT '',
            price INTEGER NOT NULL,
            stock INTEGER,
            sku TEXT NOT NULL DEFAULT '',
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_store_variants_product ON store_variants(product_id);
        CREATE TABLE IF NOT EXISTS store_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_code TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL,
            customer_json TEXT NOT NULL,
            total_amount INTEGER NOT NULL,
            access_token TEXT NOT NULL,
            admin_note TEXT NOT NULL DEFAULT '',
            slip_original_name TEXT,
            slip_stored_name TEXT,
            slip_storage_path TEXT,
            slip_mime_type TEXT,
            slip_size INTEGER,
            slip_uploaded_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders(status);
        CREATE INDEX IF NOT EXISTS idx_store_orders_created ON store_orders(created_at);
        CREATE TABLE IF NOT EXISTS store_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES store_orders(id),
            variant_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            variant_label TEXT NOT NULL,
            unit_price INTEGER NOT NULL,
            quantity INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_store_order_items_order ON store_order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_store_order_items_variant ON store_order_items(variant_id);
        CREATE TABLE IF NOT EXISTS store_counters (
            period TEXT PRIMARY KEY,
            last_seq INTEGER NOT NULL
        );
        """
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean_text(value: Any, field: str, *, required: bool = False, max_len: int = MAX_FIELD_LENGTH) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise StoreError(400, f"{field} ต้องเป็นข้อความ")
    value = value.strip()
    if required and not value:
        raise StoreError(400, f"กรุณากรอก{field}")
    if len(value) > max_len:
        raise StoreError(400, f"{field} ยาวเกิน {max_len} ตัวอักษร")
    return value


def _as_int(value: Any, field: str, *, minimum: int = 0, allow_none: bool = False) -> int | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise StoreError(400, f"กรุณากรอก{field}")
    if isinstance(value, bool) or not isinstance(value, int):
        raise StoreError(400, f"{field} ต้องเป็นจำนวนเต็ม")
    if value < minimum:
        raise StoreError(400, f"{field} ต้องไม่น้อยกว่า {minimum}")
    return value


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:48] or "product"


def _unique_slug(connection: sqlite3.Connection, base: str, exclude_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        row = connection.execute("SELECT id FROM store_products WHERE slug = ?", (slug,)).fetchone()
        if row is None or row[0] == exclude_id:
            return slug
        slug, n = f"{base}-{n}", n + 1


def variant_label(size: str, color: str) -> str:
    return " / ".join(p for p in (size, color) if p) or "-"


def next_order_code(connection: sqlite3.Connection, when: datetime | None = None) -> str:
    """SU{YYMM}-{seq:04d}; seq restarts each Bangkok calendar month. Must run inside the
    caller's write transaction so the counter bump commits or rolls back with the order."""
    when = (when or datetime.now(TZ_BANGKOK)).astimezone(TZ_BANGKOK)
    period = when.strftime("%y%m")
    seq = connection.execute(
        "INSERT INTO store_counters (period, last_seq) VALUES (?, 1) "
        "ON CONFLICT(period) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq",
        (period,),
    ).fetchone()[0]
    return f"{ORDER_PREFIX}{period}-{seq:04d}"


# ── Products ──────────────────────────────────────────────────────────────────

def _serialize_variant(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "size": row["size"],
        "color": row["color"],
        "label": variant_label(row["size"], row["color"]),
        "price": row["price"],
        "stock": row["stock"],
        "sku": row["sku"],
        "active": bool(row["active"]),
        "soldOut": row["stock"] is not None and row["stock"] <= 0,
    }


def _serialize_product(connection: sqlite3.Connection, row: sqlite3.Row, *, public: bool) -> dict[str, Any]:
    variant_rows = connection.execute(
        "SELECT * FROM store_variants WHERE product_id = ? ORDER BY sort_order, id", (row["id"],)
    ).fetchall()
    variants = [_serialize_variant(v) for v in variant_rows]
    if public:
        variants = [v for v in variants if v["active"]]
    prices = [v["price"] for v in variants if v["active"]]
    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "description": row["description"],
        "images": json.loads(row["images_json"] or "[]"),
        "status": row["status"],
        "buyerFields": json.loads(row["buyer_fields_json"] or "[]"),
        "sortOrder": row["sort_order"],
        "minPrice": min(prices) if prices else None,
        "maxPrice": max(prices) if prices else None,
        "soldOut": bool(variants) and all(v["soldOut"] for v in variants if v["active"]),
        "variants": variants,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_products(connection: sqlite3.Connection, *, public: bool) -> list[dict[str, Any]]:
    where = "WHERE status = 'active'" if public else ""
    rows = connection.execute(
        f"SELECT * FROM store_products {where} ORDER BY sort_order, id"
    ).fetchall()
    return [_serialize_product(connection, r, public=public) for r in rows]


def get_product(connection: sqlite3.Connection, key: int | str, *, public: bool) -> dict[str, Any]:
    column = "id" if isinstance(key, int) else "slug"
    row = connection.execute(f"SELECT * FROM store_products WHERE {column} = ?", (key,)).fetchone()
    if row is None or (public and row["status"] != "active"):
        raise StoreError(404, "ไม่พบสินค้า")
    return _serialize_product(connection, row, public=public)


def _product_fields(payload: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if "name" in payload:
        fields["name"] = _clean_text(payload["name"], "ชื่อสินค้า", required=True, max_len=120)
    if "description" in payload:
        fields["description"] = _clean_text(payload["description"], "คำอธิบาย", max_len=5000)
    if "images" in payload:
        images = payload["images"]
        if not isinstance(images, list) or not all(isinstance(i, str) and i for i in images):
            raise StoreError(400, "images ต้องเป็นรายการ URL")
        fields["images_json"] = json.dumps(images[:10], ensure_ascii=False)
    if "buyerFields" in payload:
        chosen = payload["buyerFields"]
        if not isinstance(chosen, list) or any(f not in OPTIONAL_FIELDS for f in chosen):
            raise StoreError(400, f"buyerFields ต้องเลือกจาก {', '.join(OPTIONAL_FIELDS)}")
        fields["buyer_fields_json"] = json.dumps(list(dict.fromkeys(chosen)))
    if "sortOrder" in payload:
        fields["sort_order"] = _as_int(payload["sortOrder"], "ลำดับ")
    if "status" in payload:
        if payload["status"] not in PRODUCT_STATUSES:
            raise StoreError(400, "สถานะสินค้าไม่ถูกต้อง")
        fields["status"] = payload["status"]
    return fields


def _check_can_activate(connection: sqlite3.Connection, product_id: int) -> None:
    has_variant = connection.execute(
        "SELECT 1 FROM store_variants WHERE product_id = ? AND active = 1", (product_id,)
    ).fetchone()
    if not has_variant:
        raise StoreError(400, "ต้องมีตัวเลือกสินค้าอย่างน้อย 1 แบบ (พร้อมราคา) ก่อนเปิดขาย")


def create_product(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    if "name" not in payload:
        raise StoreError(400, "กรุณากรอกชื่อสินค้า")
    fields = _product_fields(payload)
    status = fields.pop("status", "draft")
    now = now_iso()
    slug = _unique_slug(connection, slugify(_clean_text(payload.get("slug") or fields["name"], "slug")))
    cursor = connection.execute(
        "INSERT INTO store_products (slug, name, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)",
        (slug, fields.pop("name"), now, now),
    )
    product_id = int(cursor.lastrowid)
    if fields:
        _apply_product_fields(connection, product_id, fields)
    if "variants" in payload:
        replace_variants(connection, product_id, payload["variants"])
    if status != "draft":
        update_product(connection, product_id, {"status": status})
    return get_product(connection, product_id, public=False)


def _apply_product_fields(connection: sqlite3.Connection, product_id: int, fields: dict[str, Any]) -> None:
    fields = {**fields, "updated_at": now_iso()}
    assignments = ", ".join(f"{k} = ?" for k in fields)
    connection.execute(
        f"UPDATE store_products SET {assignments} WHERE id = ?", (*fields.values(), product_id)
    )


def update_product(connection: sqlite3.Connection, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    get_product(connection, product_id, public=False)  # 404 if missing
    fields = _product_fields(payload)
    if "variants" in payload:
        replace_variants(connection, product_id, payload["variants"])
    if fields.get("status") == "active":
        _check_can_activate(connection, product_id)
    if fields:
        _apply_product_fields(connection, product_id, fields)
    return get_product(connection, product_id, public=False)


def delete_product(connection: sqlite3.Connection, product_id: int) -> dict[str, Any]:
    """Products that were ever ordered are archived instead, so order history keeps
    pointing at something real."""
    get_product(connection, product_id, public=False)
    ordered = connection.execute(
        "SELECT 1 FROM store_order_items WHERE product_id = ? LIMIT 1", (product_id,)
    ).fetchone()
    if ordered:
        _apply_product_fields(connection, product_id, {"status": "archived"})
        return {"deleted": False, "archived": True}
    connection.execute("DELETE FROM store_variants WHERE product_id = ?", (product_id,))
    connection.execute("DELETE FROM store_products WHERE id = ?", (product_id,))
    return {"deleted": True, "archived": False}


def replace_variants(connection: sqlite3.Connection, product_id: int, variants: Any) -> None:
    """Make the product's variants match `variants`. Items with an `id` update that row,
    items without one are inserted, and rows left out are deleted — or deactivated if
    they appear in any order."""
    if not isinstance(variants, list):
        raise StoreError(400, "variants ต้องเป็นรายการ")
    existing = {
        r["id"]: r
        for r in connection.execute("SELECT * FROM store_variants WHERE product_id = ?", (product_id,))
    }
    seen_labels: set[tuple[str, str]] = set()
    kept_ids: set[int] = set()
    for index, raw in enumerate(variants):
        if not isinstance(raw, dict):
            raise StoreError(400, "variants ต้องเป็น object")
        size = _clean_text(raw.get("size"), "ไซซ์", max_len=40)
        color = _clean_text(raw.get("color"), "สี/แบบ", max_len=40)
        price = _as_int(raw.get("price"), f"ราคา ({variant_label(size, color)})")
        stock = _as_int(raw.get("stock"), f"สต็อก ({variant_label(size, color)})", allow_none=True)
        sku = _clean_text(raw.get("sku"), "SKU", max_len=60)
        active = 1 if raw.get("active", True) else 0
        if active:
            if (size, color) in seen_labels:
                raise StoreError(400, f"ตัวเลือก {variant_label(size, color)} ซ้ำกัน")
            seen_labels.add((size, color))
        variant_id = raw.get("id")
        if variant_id is not None:
            if variant_id not in existing:
                raise StoreError(400, f"ไม่พบตัวเลือก id {variant_id} ในสินค้านี้")
            connection.execute(
                "UPDATE store_variants SET size=?, color=?, price=?, stock=?, sku=?, active=?, sort_order=? WHERE id=?",
                (size, color, price, stock, sku, active, index, variant_id),
            )
            kept_ids.add(variant_id)
        else:
            connection.execute(
                "INSERT INTO store_variants (product_id, size, color, price, stock, sku, active, sort_order) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (product_id, size, color, price, stock, sku, active, index),
            )
    for variant_id in set(existing) - kept_ids:
        ordered = connection.execute(
            "SELECT 1 FROM store_order_items WHERE variant_id = ? LIMIT 1", (variant_id,)
        ).fetchone()
        if ordered:
            connection.execute("UPDATE store_variants SET active = 0 WHERE id = ?", (variant_id,))
        else:
            connection.execute("DELETE FROM store_variants WHERE id = ?", (variant_id,))
    status = connection.execute("SELECT status FROM store_products WHERE id = ?", (product_id,)).fetchone()
    if status and status[0] == "active":
        _check_can_activate(connection, product_id)


def add_product_image(connection: sqlite3.Connection, product_id: int, url: str) -> dict[str, Any]:
    product = get_product(connection, product_id, public=False)
    images = (product["images"] + [url])[:10]
    _apply_product_fields(connection, product_id, {"images_json": json.dumps(images, ensure_ascii=False)})
    return get_product(connection, product_id, public=False)


# ── Orders ────────────────────────────────────────────────────────────────────

def _serialize_order(connection: sqlite3.Connection, row: sqlite3.Row, *, include_token: bool = False) -> dict[str, Any]:
    items = connection.execute(
        "SELECT * FROM store_order_items WHERE order_id = ? ORDER BY id", (row["id"],)
    ).fetchall()
    order = {
        "orderCode": row["order_code"],
        "status": row["status"],
        "statusLabel": ORDER_STATUSES.get(row["status"], row["status"]),
        "customer": json.loads(row["customer_json"]),
        "totalAmount": row["total_amount"],
        "items": [
            {
                "variantId": i["variant_id"],
                "productId": i["product_id"],
                "productName": i["product_name"],
                "variantLabel": i["variant_label"],
                "unitPrice": i["unit_price"],
                "quantity": i["quantity"],
                "lineTotal": i["unit_price"] * i["quantity"],
            }
            for i in items
        ],
        "hasSlip": bool(row["slip_stored_name"]),
        "slipUploadedAt": row["slip_uploaded_at"],
        "adminNote": row["admin_note"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if include_token:
        order["accessToken"] = row["access_token"]
    return order


def _fetch_order_row(connection: sqlite3.Connection, order_code: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM store_orders WHERE order_code = ?", (order_code,)).fetchone()
    if row is None:
        raise StoreError(404, "ไม่พบออเดอร์")
    return row


def get_order(connection: sqlite3.Connection, order_code: str, *, include_token: bool = False) -> dict[str, Any]:
    return _serialize_order(connection, _fetch_order_row(connection, order_code), include_token=include_token)


def get_order_row(connection: sqlite3.Connection, order_code: str) -> sqlite3.Row:
    return _fetch_order_row(connection, order_code)


def create_order(connection: sqlite3.Connection, payload: Any) -> dict[str, Any]:
    """Validate, price and stock-check a cart, then insert it under one IMMEDIATE
    transaction so concurrent buyers can't oversell the last unit. Commits on success."""
    if not isinstance(payload, dict):
        raise StoreError(400, "ข้อมูลไม่ถูกต้อง")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise StoreError(400, "ตะกร้าว่าง")
    quantities: dict[int, int] = {}
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise StoreError(400, "items ไม่ถูกต้อง")
        variant_id = _as_int(raw.get("variantId"), "variantId", minimum=1)
        qty = _as_int(raw.get("quantity"), "จำนวน", minimum=1)
        quantities[variant_id] = quantities.get(variant_id, 0) + qty
    if len(quantities) > MAX_ITEMS_PER_ORDER:
        raise StoreError(400, f"สั่งได้ไม่เกิน {MAX_ITEMS_PER_ORDER} รายการต่อออเดอร์")
    if any(q > MAX_QTY_PER_ITEM for q in quantities.values()):
        raise StoreError(400, f"สั่งได้ไม่เกิน {MAX_QTY_PER_ITEM} ชิ้นต่อรายการ")

    raw_customer = payload.get("customer")
    if not isinstance(raw_customer, dict):
        raise StoreError(400, "กรุณากรอกข้อมูลผู้ซื้อ")

    connection.commit()  # make sure no implicit transaction is open before BEGIN
    connection.execute("BEGIN IMMEDIATE")
    try:
        lines = []
        required_fields: list[str] = list(ALWAYS_REQUIRED_FIELDS)
        for variant_id, qty in quantities.items():
            row = connection.execute(
                "SELECT v.*, p.name AS product_name, p.status AS product_status, p.buyer_fields_json "
                "FROM store_variants v JOIN store_products p ON p.id = v.product_id WHERE v.id = ?",
                (variant_id,),
            ).fetchone()
            if row is None or not row["active"] or row["product_status"] != "active":
                raise StoreError(409, "มีสินค้าในตะกร้าที่ไม่เปิดขายแล้ว กรุณาเลือกใหม่")
            label = variant_label(row["size"], row["color"])
            updated = connection.execute(
                "UPDATE store_variants SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ?",
                (qty, variant_id, qty),
            ).rowcount
            if row["stock"] is not None and updated == 0:
                left = max(row["stock"], 0)
                raise StoreError(409, f"{row['product_name']} ({label}) เหลือ {left} ชิ้น")
            for f in json.loads(row["buyer_fields_json"] or "[]"):
                if f not in required_fields:
                    required_fields.append(f)
            lines.append((row, label, qty))

        customer = {}
        for field in required_fields:
            optional = field == "note"
            customer[field] = _clean_text(raw_customer.get(field), BUYER_FIELDS[field], required=not optional)
        if "@" not in customer["email"]:
            raise StoreError(400, "อีเมลไม่ถูกต้อง")
        if not re.fullmatch(r"[0-9+\- ]{9,15}", customer["phone"]):
            raise StoreError(400, "เบอร์โทรศัพท์ไม่ถูกต้อง")

        total = sum(row["price"] * qty for row, _, qty in lines)
        now = now_iso()
        order_code = next_order_code(connection)
        cursor = connection.execute(
            "INSERT INTO store_orders (order_code, status, customer_json, total_amount, access_token, created_at, updated_at) "
            "VALUES (?, 'pending_payment', ?, ?, ?, ?, ?)",
            (order_code, json.dumps(customer, ensure_ascii=False), total, secrets.token_hex(24), now, now),
        )
        order_id = int(cursor.lastrowid)
        for row, label, qty in lines:
            connection.execute(
                "INSERT INTO store_order_items (order_id, variant_id, product_id, product_name, variant_label, unit_price, quantity) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (order_id, row["id"], row["product_id"], row["product_name"], label, row["price"], qty),
            )
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    return get_order(connection, order_code, include_token=True)


def lookup_order(connection: sqlite3.Connection, order_code: Any, phone: Any) -> dict[str, Any]:
    """Customer self-service: order code + the phone used at checkout returns the order
    with its access token. Both failure cases give the same answer so codes can't be
    probed."""
    not_found = StoreError(404, "ไม่พบออเดอร์ หรือเบอร์โทรไม่ตรงกับที่ใช้สั่งซื้อ")
    if not isinstance(order_code, str) or not isinstance(phone, str):
        raise not_found
    row = connection.execute(
        "SELECT * FROM store_orders WHERE order_code = ?", (order_code.strip().upper(),)
    ).fetchone()
    digits = re.sub(r"\D", "", phone)
    if row is None or not digits or re.sub(r"\D", "", json.loads(row["customer_json"]).get("phone", "")) != digits:
        raise not_found
    return _serialize_order(connection, row, include_token=True)


def attach_slip(connection: sqlite3.Connection, order_code: str, slip: dict[str, Any]) -> dict[str, Any]:
    row = _fetch_order_row(connection, order_code)
    if row["status"] not in ("pending_payment", "waiting_confirm"):
        raise StoreError(409, "ออเดอร์นี้อัปโหลดสลิปไม่ได้แล้ว")
    connection.execute(
        "UPDATE store_orders SET slip_original_name=?, slip_stored_name=?, slip_storage_path=?, slip_mime_type=?, "
        "slip_size=?, slip_uploaded_at=?, status='waiting_confirm', updated_at=? WHERE id=?",
        (slip["originalName"], slip["storedName"], slip["storedPath"], slip["mimeType"], slip["size"],
         slip["uploadedAt"], now_iso(), row["id"]),
    )
    return get_order(connection, order_code)


def update_order(connection: sqlite3.Connection, order_code: str, payload: Any) -> tuple[dict[str, Any], str | None]:
    """Admin edit of status / note. Cancelling returns the stock; a cancelled order is
    final. Returns (order, previous_status_if_changed)."""
    if not isinstance(payload, dict):
        raise StoreError(400, "ข้อมูลไม่ถูกต้อง")
    row = _fetch_order_row(connection, order_code)
    changed_from = None
    if "adminNote" in payload:
        note = _clean_text(payload["adminNote"], "หมายเหตุ", max_len=2000)
        connection.execute("UPDATE store_orders SET admin_note=?, updated_at=? WHERE id=?", (note, now_iso(), row["id"]))
    status = payload.get("status")
    if status is not None and status != row["status"]:
        if status not in ORDER_STATUSES:
            raise StoreError(400, "สถานะไม่ถูกต้อง")
        if row["status"] == "cancelled":
            raise StoreError(409, "ออเดอร์ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้")
        if status == "cancelled":
            for item in connection.execute(
                "SELECT variant_id, quantity FROM store_order_items WHERE order_id = ?", (row["id"],)
            ).fetchall():
                connection.execute(
                    "UPDATE store_variants SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL",
                    (item["quantity"], item["variant_id"]),
                )
        connection.execute("UPDATE store_orders SET status=?, updated_at=? WHERE id=?", (status, now_iso(), row["id"]))
        changed_from = row["status"]
    return get_order(connection, order_code), changed_from


def list_orders(
    connection: sqlite3.Connection,
    *,
    status: str | None = None,
    query: str | None = None,
    page: int = 1,
    per_page: int = 50,
) -> dict[str, Any]:
    clauses, params = [], []
    if status:
        clauses.append("status = ?")
        params.append(status)
    if query:
        clauses.append("(order_code LIKE ? OR customer_json LIKE ?)")
        params += [f"%{query}%", f"%{query}%"]
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    total = connection.execute(f"SELECT COUNT(*) FROM store_orders {where}", params).fetchone()[0]
    page, per_page = max(page, 1), min(max(per_page, 1), 200)
    rows = connection.execute(
        f"SELECT * FROM store_orders {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        (*params, per_page, (page - 1) * per_page),
    ).fetchall()
    counts = {
        r[0]: r[1] for r in connection.execute("SELECT status, COUNT(*) FROM store_orders GROUP BY status")
    }
    return {
        "orders": [_serialize_order(connection, r) for r in rows],
        "total": total,
        "page": page,
        "perPage": per_page,
        "statusCounts": {s: counts.get(s, 0) for s in ORDER_STATUSES},
    }


def orders_csv_rows(connection: sqlite3.Connection, status: str | None = None) -> list[list[Any]]:
    """One row per order item, for the admin spreadsheet export."""
    where, params = ("WHERE o.status = ?", (status,)) if status else ("", ())
    rows = connection.execute(
        "SELECT o.*, i.product_name, i.variant_label, i.unit_price, i.quantity FROM store_orders o "
        f"JOIN store_order_items i ON i.order_id = o.id {where} ORDER BY o.id, i.id",
        params,
    ).fetchall()
    fields = list(BUYER_FIELDS)
    out: list[list[Any]] = [
        ["เลขออเดอร์", "วันที่สั่ง", "สถานะ", "สินค้า", "ตัวเลือก", "ราคาต่อชิ้น", "จำนวน", "ยอดออเดอร์"]
        + [BUYER_FIELDS[f] for f in fields]
        + ["หมายเหตุแอดมิน"]
    ]
    for r in rows:
        customer = json.loads(r["customer_json"])
        out.append(
            [r["order_code"], r["created_at"], ORDER_STATUSES.get(r["status"], r["status"]), r["product_name"],
             r["variant_label"], r["unit_price"], r["quantity"], r["total_amount"]]
            + [customer.get(f, "") for f in fields]
            + [r["admin_note"]]
        )
    return out


def meta() -> dict[str, Any]:
    return {
        "buyerFields": [
            {"key": k, "label": v, "alwaysRequired": k in ALWAYS_REQUIRED_FIELDS} for k, v in BUYER_FIELDS.items()
        ],
        "orderStatuses": [{"key": k, "label": v} for k, v in ORDER_STATUSES.items()],
        "productStatuses": [{"key": k, "label": v} for k, v in PRODUCT_STATUSES.items()],
    }
