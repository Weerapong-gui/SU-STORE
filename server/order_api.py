#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import csv
import hmac
import html
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta, date
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import sys
import time
from urllib.parse import urlparse

from store import api as store_api
from store import db as store_db

HOST = os.environ.get("ORDER_API_HOST", "0.0.0.0")
PORT = int(os.environ.get("ORDER_API_PORT", os.environ.get("PORT", "3010")))
DB_PATH = Path(os.environ.get("ORDER_API_DB_PATH", str(Path.home() / "su-order-api" / "data" / "orders.db")))
SLIPS_DIR = Path(os.environ.get("ORDER_API_SLIPS_DIR", str(DB_PATH.parent / "slips")))
PRODUCT_IMAGES_DIR = Path(os.environ.get("PRODUCT_IMAGES_DIR", str(DB_PATH.parent / "product-images")))
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PRODUCT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
ORDER_PREFIX = os.environ.get("ORDER_PREFIX", "FP28")
ORDER_ROUND = int(os.environ.get("ORDER_ROUND", "1"))
ORDER_API_TOKEN = os.environ.get("ORDER_API_TOKEN", "")
BYPASS_TOKEN = os.environ.get("BYPASS_TOKEN", "")
PICKUP_USERNAME = os.environ.get("PICKUP_USERNAME", "staff")
PICKUP_PASSWORD = os.environ.get("PICKUP_PASSWORD", "")
# Deterministic session token derived from credentials (survives restarts)
SUPER_TOKEN = hmac.new(
    key=(PICKUP_USERNAME + ":" + PICKUP_PASSWORD).encode("utf-8"),
    msg=b"superadmin-v1",
    digestmod="sha256",
).hexdigest() if PICKUP_PASSWORD else ""

CLAIM_STATION_TOKEN = hmac.new(
    key=(PICKUP_USERNAME + ":" + PICKUP_PASSWORD).encode("utf-8"),
    msg=b"claim-station-v1",
    digestmod="sha256",
).hexdigest() if PICKUP_PASSWORD else ""
GOOGLE_SHEETS_WEBHOOK_URL = os.environ.get("GOOGLE_SHEETS_WEBHOOK_URL", "").strip()
GOOGLE_SHEETS_WEBHOOK_TOKEN = os.environ.get("GOOGLE_SHEETS_WEBHOOK_TOKEN", "").strip()
KHANTOK_QUOTA_100 = int(os.environ.get("KHANTOK_QUOTA_100", "2000"))
KHANTOK_QUOTA_50 = int(os.environ.get("KHANTOK_QUOTA_50", "1000"))
KHANTOK_STUDENT_CODE_PREFIX = "693"
ORDER_ID_PATTERN = re.compile(r"^[A-Z0-9-]+$")
ALLOWED_SLIP_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024
ORDER_STATUSES = {
    "pending_payment",
    "waiting_confirm",
    "paid",
    "preparing",
    "shipped",
    "received",
    "cancelled",
    "rejected",
    "refund",
    "refunded",
}
PAYMENT_STATUS_BY_ORDER_STATUS = {
    "pending_payment": "awaiting_payment",
    "waiting_confirm": "waiting_confirm",
    "paid": "paid",
    "preparing": "paid",
    "shipped": "paid",
    "received": "paid",
    "cancelled": "rejected",
    "rejected": "rejected",
    "refund": "refund_pending",
    "refunded": "refunded",
}

# In-memory visitor tracking (IP → last-seen timestamp)
_visitor_registry: dict[str, float] = {}
_VISITOR_ACTIVE_SECONDS = 120  # 2 minutes

# In-memory test-warning expiry (timestamp)
_test_warning_until: float = 0

_global_lock = threading.Lock()


def get_schedule_status(schedule_enabled: bool, warning_message: str) -> dict[str, Any]:
    """Compute schedule open/closed/warning state from current Bangkok time."""
    if not schedule_enabled:
        return {"scheduleClosed": False, "scheduleWarning": False, "scheduleWarningMessage": warning_message}
    now = datetime.now(TZ_BANGKOK)
    total_min = now.hour * 60 + now.minute
    open_min = 6 * 60       # 06:00
    close_min = 23 * 60     # 23:00 (end of 22:59)
    warn_min = close_min - 10  # 22:50
    schedule_closed = total_min < open_min or total_min >= close_min
    schedule_warning = not schedule_closed and total_min >= warn_min
    return {
        "scheduleClosed": schedule_closed,
        "scheduleWarning": schedule_warning,
        "scheduleWarningMessage": warning_message,
    }

DEFAULT_PRODUCTS = [
    {
        "slug": "single-shirt",
        "name": "FRESHER POLO SHIRT",
        "short_name": "เสื้อเดี่ยว",
        "tagline": "Classic fresher polo for everyday campus wear.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 399,
        "category": "single",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/POLP_post/Artboard 4.png",
        "sort_order": 1,
    },
    {
        "slug": "fresh-jacket",
        "name": "FRESHER JACKET",
        "short_name": "แจ็คเก็ต",
        "tagline": "Layer up with a clean campus-ready jacket.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 899,
        "category": "jacket",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/Pr1.png",
        "sort_order": 3,
    },
    {
        "slug": "fresh-headband",
        "name": "FRESHER HEADBAND",
        "short_name": "ผ้าคาดสำนักวิชา",
        "tagline": "A lightweight accessory for sports day and activity looks.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 35,
        "category": "headband",
        "requires_size": 0,
        "requires_school": 1,
        "image_path": "/images/Pr1.png",
        "sort_order": 4,
    },
]


_TEMPLATES_DIR = Path(__file__).parent / "templates"
ADMIN_HTML = (_TEMPLATES_DIR / "admin.html").read_text(encoding="utf-8")
ORDER_VIEW_HTML = (_TEMPLATES_DIR / "order_view.html").read_text(encoding="utf-8")
CLAIM_STATION_HTML = (_TEMPLATES_DIR / "claim_station.html").read_text(encoding="utf-8")
DISPLAY_HTML = (_TEMPLATES_DIR / "display.html").read_text(encoding="utf-8")
DISPLAY2_HTML = (_TEMPLATES_DIR / "display2.html").read_text(encoding="utf-8")
DISPLAY3_HTML = (_TEMPLATES_DIR / "display3.html").read_text(encoding="utf-8")
RECEIPT_SVG = (_TEMPLATES_DIR / "receipt_template.svg").read_bytes()
_FONT_PATH = _TEMPLATES_DIR / "fonts" / "SukhumvitSet.ttc"
_slides_dir = Path(os.environ.get("ORDER_API_SLIDES_DIR", "/var/data/su-order-api/slides"))
_slides_dir.mkdir(parents=True, exist_ok=True)
_assets_dir = Path(os.environ.get("ORDER_API_ASSETS_DIR", "/var/data/su-order-api/display2_assets"))
_assets_dir.mkdir(parents=True, exist_ok=True)

# display1 state is stored in the display1_state table (see helpers below).

STATION_BY_SLUG = {
    "single": "polo",
    "single-shirt": "polo",
    "jacket": "jacket",
    "fresh-jacket": "jacket",
    "headband": "headband",
    "fresh-headband": "headband",
}


TZ_BANGKOK = timezone(timedelta(hours=7))


def now_iso() -> str:
    return datetime.now(TZ_BANGKOK).replace(microsecond=0).isoformat()


def _parse_stored_datetime(value: str | None) -> datetime | None:
    """แปลงค่า timestamp ในคอลัมน์ให้เป็น datetime ที่มี timezone

    แถวใหม่เขียนด้วย now_iso() จึงมี offset +07:00 ติดมา ส่วนแถวเก่าเก็บเป็น UTC
    (บางแถวลงท้าย 'Z' บางแถวไม่มี suffix) ค่าที่ไม่มี offset จึงถือเป็น UTC
    ตรงกับที่ทุกหน้าจอแสดงผลกันอยู่ คืน None เมื่อ parse ไม่ได้ ไม่ raise
    """
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def khantok_claim_warning(received_at: str | None, status: str | None = None,
                          now: datetime | None = None) -> bool:
    """True เมื่อออเดอร์รับของไปแล้วในวันไทยที่เก่ากว่าวันนี้ หรือรับของไปแล้ว
    (status == 'received') แต่ไม่มี received_at ที่ใช้พิสูจน์ได้ว่าเป็นวันนี้

    ออเดอร์ที่รับของไปก่อนจะมีการรับบัตรแยก อาจได้บัตรขันโตกไปพร้อมของแล้ว
    claim station จึงเตือนก่อนแจกใบใหม่ ส่วนคนที่มารับวันเดียวกันต้องไม่เตือน
    เพราะ flow ปกติคือ staff กดรับของแล้วกดรับบัตรต่อห่างกันไม่กี่นาที

    รับของแล้ว (admin กดสถานะ 'received' ตรงๆ ไม่ผ่าน claim station) แต่ timestamp
    หาย/ว่าง/parse ไม่ได้ ก็ยังต้องเตือน เพราะพิสูจน์ไม่ได้ว่าเป็นการรับของวันนี้
    """
    received = _parse_stored_datetime(received_at)
    if status == "received" and received is None:
        return True
    if received is None:
        return False
    current = now or datetime.now(TZ_BANGKOK)
    if current.tzinfo is None:
        current = current.replace(tzinfo=TZ_BANGKOK)
    return received.astimezone(TZ_BANGKOK).date() < current.astimezone(TZ_BANGKOK).date()


def log_audit(connection: sqlite3.Connection, order_code: str, event: str, detail: str = "") -> None:
    connection.execute(
        "INSERT INTO order_audit_log (order_code, event, detail, created_at) VALUES (?, ?, ?, ?)",
        (order_code, event, detail, now_iso()),
    )


def enqueue_display2(connection, order_row, claim_user):
    """Insert one display2_picks row per item in the order, mapped by product_slug.
    Idempotent on (order_internal_id, item_index). Returns count of new rows."""
    try:
        items = json.loads(order_row["items_json"] or "[]")
    except (TypeError, json.JSONDecodeError):
        items = []
    if not items:
        items = [{
            "slug": order_row["product_slug"],
            "name": order_row["product_name"],
            "size": order_row["size"],
            "quantity": order_row["quantity"],
        }]
    inserted = 0
    now = now_iso()
    for idx, item in enumerate(items):
        product = item.get("product") or {}
        slug = (item.get("slug") or product.get("slug") or "").lower()
        if not slug:
            cat = (product.get("category") or item.get("category") or "").lower()
            if cat == "shirt":
                slug = "single"
            elif cat in ("single", "jacket", "headband"):
                slug = cat
        station = STATION_BY_SLUG.get(slug)
        if not station:
            log_audit(connection, order_row["order_code"],
                      "display2_skipped", f"slug={slug} item={idx}")
            continue
        exists = connection.execute(
            "SELECT 1 FROM display2_picks WHERE order_internal_id=? AND item_index=?",
            (order_row["internal_id"], idx),
        ).fetchone()
        if exists:
            continue
        connection.execute(
            """INSERT INTO display2_picks
               (order_internal_id, order_code, item_index, station,
                product_slug, product_name, size, quantity,
                student_code, nickname, full_name, queued_at, queued_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (order_row["internal_id"], order_row["order_code"], idx, station,
             slug, item.get("name") or product.get("name", ""),
             item.get("size", ""), int(item.get("quantity", 1) or 1),
             order_row["student_code"], order_row["nickname"], order_row["full_name"],
             now, claim_user),
        )
        inserted += 1
        log_audit(connection, order_row["order_code"],
                  "display2_enqueued", f"station={station} item={idx}")

    return inserted


def enqueue_display2_khantok(connection, order_row, claim_user) -> int:
    """Insert the khantok-station pick row (item_index -1) for a ticketed order.
    Idempotent on (order_internal_id, -1). Returns 1 if a row was inserted, else 0."""
    row_keys = order_row.keys() if hasattr(order_row, "keys") else []
    has_kt = "khantok_ticket" in row_keys and int(order_row["khantok_ticket"] or 0) == 1
    if not has_kt:
        return 0
    kt_idx = -1
    exists_kt = connection.execute(
        "SELECT 1 FROM display2_picks WHERE order_internal_id=? AND item_index=?",
        (order_row["internal_id"], kt_idx),
    ).fetchone()
    if exists_kt:
        return 0
    kt_value = 0
    if "khantok_ticket_value" in row_keys:
        kt_value = int(order_row["khantok_ticket_value"] or 0)
    kt_size = f"฿{kt_value}" if kt_value else "บัตร"
    connection.execute(
        """INSERT INTO display2_picks
           (order_internal_id, order_code, item_index, station,
            product_slug, product_name, size, quantity,
            student_code, nickname, full_name, queued_at, queued_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (order_row["internal_id"], order_row["order_code"], kt_idx, "khantok",
         "khantok", "บัตรขันโตก", kt_size, 1,
         order_row["student_code"], order_row["nickname"], order_row["full_name"],
         now_iso(), claim_user),
    )
    log_audit(connection, order_row["order_code"],
              "display2_enqueued", f"station=khantok value={kt_value}")
    return 1


def mark_khantok_station_claimed(
    connection: sqlite3.Connection, order_code: str, claim_user: str
) -> tuple[int, dict[str, Any]]:
    """Mark a ticketed order's khantok ticket as claimed at the claim station and
    enqueue its khantok pick row. Never touches khantok_ticket_claims (quota).
    Returns (http_status, response_body). Does not commit."""
    existing = fetch_order_by_code(connection, order_code)
    if existing is None:
        return HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"}
    row_keys = existing.keys()
    has_ticket = "khantok_ticket" in row_keys and int(existing["khantok_ticket"] or 0) == 1
    if not has_ticket:
        return HTTPStatus.BAD_REQUEST, {"message": "ออเดอร์นี้ไม่มีบัตรขันโตก"}
    if existing["status"] in ("pending_payment", "waiting_confirm", "cancelled", "rejected"):
        return HTTPStatus.BAD_REQUEST, {
            "message": f"ออเดอร์มีสถานะ '{existing['status']}' ยังไม่พร้อมรับบัตร"
        }
    already = (
        existing["khantok_station_claimed_at"]
        if "khantok_station_claimed_at" in row_keys else None
    )
    if already:
        return HTTPStatus.CONFLICT, {
            "message": "รับบัตรขันโตกไปแล้ว", "claimedAt": already, "alreadyClaimed": True,
        }
    ts = now_iso()
    connection.execute(
        "UPDATE orders SET khantok_station_claimed_at=?, updated_at=? WHERE order_code=?",
        (ts, ts, order_code),
    )
    log_audit(connection, order_code, "khantok_claimed", f"claimed by {claim_user}")
    updated_row = fetch_order_by_code(connection, order_code)
    queued = 0
    try:
        queued = enqueue_display2_khantok(connection, updated_row, claim_user)
    except Exception as exc:
        log_audit(connection, order_code,
                  "display2_enqueue_failed", f"{type(exc).__name__}: {exc}")
    return HTTPStatus.OK, {"order": serialize_order(updated_row), "queued": queued}


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SLIPS_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH, timeout=30) as connection:
      connection.execute("PRAGMA journal_mode=WAL")
      connection.execute("PRAGMA synchronous=NORMAL")
      connection.execute("PRAGMA busy_timeout=30000")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS orders (
              internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT UNIQUE,
              round_number INTEGER NOT NULL,
              status TEXT NOT NULL,
              payment_status TEXT NOT NULL,
              khantok_ticket INTEGER NOT NULL DEFAULT 0,
              khantok_ticket_claimed_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              product_slug TEXT NOT NULL,
              product_name TEXT NOT NULL,
              product_short_name TEXT NOT NULL,
              product_tagline TEXT NOT NULL,
              product_price INTEGER NOT NULL,
              product_image TEXT NOT NULL,
              product_category TEXT NOT NULL,
              size TEXT NOT NULL,
              quantity INTEGER NOT NULL,
              total_amount INTEGER NOT NULL,
              items_json TEXT NOT NULL DEFAULT '[]',
              student_code TEXT NOT NULL DEFAULT '',
              full_name TEXT NOT NULL DEFAULT '',
              parent_phone TEXT NOT NULL DEFAULT '',
              first_name TEXT NOT NULL,
              last_name TEXT NOT NULL,
              nickname TEXT NOT NULL,
              email TEXT NOT NULL,
              phone TEXT NOT NULL,
              school TEXT NOT NULL,
              access_token TEXT NOT NULL,
              slip_original_name TEXT,
              slip_stored_name TEXT,
              slip_storage_path TEXT,
              slip_mime_type TEXT,
              slip_size INTEGER,
              slip_uploaded_at TEXT
          )
          """
      )
      columns = {
          row[1]
          for row in connection.execute("PRAGMA table_info(orders)").fetchall()
      }
      if "access_token" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN access_token TEXT")
      if "slip_storage_path" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN slip_storage_path TEXT")
      if "khantok_ticket" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket INTEGER NOT NULL DEFAULT 0")
      if "khantok_ticket_claimed_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_claimed_at TEXT")
      if "lucky_ticket" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantok_ticket = lucky_ticket
              WHERE khantok_ticket = 0 AND lucky_ticket = 1
              """
          )
      if "lucky_ticket_claimed_at" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantok_ticket_claimed_at = lucky_ticket_claimed_at
              WHERE
                  (khantok_ticket_claimed_at IS NULL OR khantok_ticket_claimed_at = '')
                  AND lucky_ticket_claimed_at IS NOT NULL
                  AND lucky_ticket_claimed_at != ''
              """
          )
      if "khantok_ticket_already_claimed" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_already_claimed INTEGER NOT NULL DEFAULT 0")
      if "khantok_ticket_value" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_value INTEGER")
      if "khantok_station_claimed_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_station_claimed_at TEXT")
      if "student_code" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN student_code TEXT NOT NULL DEFAULT ''")
      if "full_name" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
      if "parent_phone" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN parent_phone TEXT NOT NULL DEFAULT ''")
      if "items_json" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'")
      if "admin_note" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN admin_note TEXT")
      if "received_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN received_at TEXT")
      if "received_by" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN received_by TEXT")
      existing_rows = connection.execute(
          "SELECT internal_id FROM orders WHERE access_token IS NULL OR access_token = ''"
      ).fetchall()
      for row in existing_rows:
          connection.execute(
              "UPDATE orders SET access_token = ? WHERE internal_id = ?",
              (create_order_access_token(), row[0]),
          )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS khantok_ticket_claims (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_id INTEGER NOT NULL UNIQUE,
              claimed_at TEXT NOT NULL,
              ticket_value INTEGER NOT NULL DEFAULT 100,
              FOREIGN KEY (order_id) REFERENCES orders(internal_id)
          )
          """
      )
      existing_tables = {
          row[0]
          for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
      }
      if "lucky_ticket_claims" in existing_tables:
          connection.execute(
              """
              INSERT OR IGNORE INTO khantok_ticket_claims (order_id, claimed_at)
              SELECT order_id, claimed_at FROM lucky_ticket_claims
              """
          )
      claim_columns = {
          row[1]
          for row in connection.execute("PRAGMA table_info(khantok_ticket_claims)").fetchall()
      }
      if "ticket_value" not in claim_columns:
          connection.execute("ALTER TABLE khantok_ticket_claims ADD COLUMN ticket_value INTEGER NOT NULL DEFAULT 100")
      connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)")
      # Hot-path indexes: the khantok de-dup check, list/filter, analytics group-bys and
      # check-order lookups all filter/sort on these columns. Additive & idempotent.
      connection.execute("CREATE INDEX IF NOT EXISTS idx_orders_student_code ON orders(student_code)")
      connection.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")
      connection.execute("CREATE INDEX IF NOT EXISTS idx_orders_round_number ON orders(round_number)")
      connection.execute("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              slug TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              short_name TEXT NOT NULL,
              tagline TEXT NOT NULL,
              description TEXT NOT NULL,
              price INTEGER NOT NULL,
              category TEXT NOT NULL,
              requires_size INTEGER NOT NULL DEFAULT 1,
              requires_school INTEGER NOT NULL DEFAULT 1,
              available INTEGER NOT NULL DEFAULT 1,
              image_path TEXT NOT NULL DEFAULT '',
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS site_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT NOT NULL,
              event TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_order_code ON order_audit_log(order_code)")
      connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_created_at ON order_audit_log(created_at)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_feedback (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT NOT NULL UNIQUE,
              rating INTEGER NOT NULL,
              comment TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON order_feedback(created_at)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS display2_picks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_internal_id INTEGER NOT NULL,
              order_code TEXT NOT NULL,
              item_index INTEGER NOT NULL,
              station TEXT NOT NULL,
              product_slug TEXT NOT NULL,
              product_name TEXT NOT NULL,
              size TEXT NOT NULL,
              quantity INTEGER NOT NULL,
              student_code TEXT NOT NULL,
              nickname TEXT NOT NULL,
              full_name TEXT NOT NULL,
              queued_at TEXT NOT NULL,
              queued_by TEXT NOT NULL,
              picked_at TEXT,
              picked_by TEXT,
              undone_at TEXT,
              FOREIGN KEY (order_internal_id) REFERENCES orders(internal_id)
          )
          """
      )
      connection.execute(
          "CREATE INDEX IF NOT EXISTS idx_display2_picks_station_active "
          "ON display2_picks(station, picked_at)"
      )
      connection.execute(
          "CREATE INDEX IF NOT EXISTS idx_display2_picks_order "
          "ON display2_picks(order_internal_id)"
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS display2_assets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              station TEXT NOT NULL,
              category TEXT,
              filename TEXT NOT NULL UNIQUE,
              uploaded_at TEXT NOT NULL,
              uploaded_by TEXT NOT NULL DEFAULT ''
          )
          """
      )
      connection.execute(
          "CREATE INDEX IF NOT EXISTS idx_display2_assets_station "
          "ON display2_assets(station, category)"
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS display1_state (
              username     TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              updated_at   TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS display1_state (
              username     TEXT PRIMARY KEY,
              payload_json TEXT NOT NULL,
              updated_at   TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS slip_ocr_results (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code   TEXT UNIQUE NOT NULL,
              status       TEXT NOT NULL DEFAULT 'pending',
              ref_number   TEXT,
              amount       REAL,
              date         TEXT,
              sender       TEXT,
              bank         TEXT,
              duplicate_of TEXT,
              raw_reason   TEXT,
              checked_at   TEXT
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_ocr_ref ON slip_ocr_results(ref_number)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_extra_slips (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code   TEXT NOT NULL,
              original_name TEXT,
              stored_name  TEXT NOT NULL,
              storage_path TEXT,
              mime_type    TEXT,
              file_size    INTEGER,
              uploaded_at  TEXT NOT NULL
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_extra_slips_order_code ON order_extra_slips(order_code)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_backups (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              label TEXT NOT NULL DEFAULT '',
              order_count INTEGER NOT NULL DEFAULT 0,
              orders_json TEXT NOT NULL DEFAULT '[]'
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS admin_users (
              username TEXT PRIMARY KEY,
              claim_token TEXT NOT NULL,
              super_token TEXT,
              is_superadmin INTEGER NOT NULL DEFAULT 0,
              created_by TEXT NOT NULL DEFAULT 'system',
              created_at TEXT NOT NULL
          )
          """
      )
      if not connection.execute("SELECT 1 FROM admin_users WHERE username=?", (PICKUP_USERNAME,)).fetchone():
          if PICKUP_PASSWORD:
              seed_now = now_iso()
              connection.execute(
                  "INSERT OR IGNORE INTO admin_users (username,claim_token,super_token,is_superadmin,created_by,created_at) VALUES (?,?,?,1,'system',?)",
                  (PICKUP_USERNAME, CLAIM_STATION_TOKEN, SUPER_TOKEN, seed_now),
              )
      product_count_row = connection.execute("SELECT COUNT(*) FROM products").fetchone()
      if product_count_row[0] == 0:
          seed_now = now_iso()
          for p in DEFAULT_PRODUCTS:
              connection.execute(
                  """
                  INSERT OR IGNORE INTO products
                  (slug, name, short_name, tagline, description, price, category,
                   requires_size, requires_school, available, image_path, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                  """,
                  (
                      p["slug"], p["name"], p["short_name"], p["tagline"], p["description"],
                      p["price"], p["category"], p["requires_size"], p["requires_school"],
                      p["image_path"], p["sort_order"], seed_now, seed_now,
                  ),
              )
      store_db.ensure_store_db(connection)


_CONN_POOL: list[sqlite3.Connection] = []
_CONN_POOL_LOCK = threading.Lock()
_CONN_POOL_MAX = int(os.environ.get("ORDER_API_CONN_POOL_MAX", "32"))


def _new_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


class _PooledConnection:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._broken = False

    def __enter__(self) -> sqlite3.Connection:
        return self._connection

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        try:
            if exc_type is None:
                self._connection.commit()
            else:
                self._connection.rollback()
        except Exception:
            self._broken = True
        with _CONN_POOL_LOCK:
            if self._broken or len(_CONN_POOL) >= _CONN_POOL_MAX:
                try:
                    self._connection.close()
                except Exception:
                    pass
            else:
                _CONN_POOL.append(self._connection)
        return False


def open_db() -> "_PooledConnection":
    with _CONN_POOL_LOCK:
        connection = _CONN_POOL.pop() if _CONN_POOL else None
    if connection is None:
        connection = _new_db_connection()
    return _PooledConnection(connection)


_READ_CACHE: dict[str, tuple[float, Any]] = {}
_READ_CACHE_LOCK = threading.Lock()
_READ_CACHE_TTL = float(os.environ.get("ORDER_API_READ_CACHE_TTL", "1.0"))
_READ_CACHE_MAX = int(os.environ.get("ORDER_API_READ_CACHE_MAX", "5000"))


def cache_get(key: str) -> Any:
    if _READ_CACHE_TTL <= 0:
        return None
    with _READ_CACHE_LOCK:
        entry = _READ_CACHE.get(key)
    if entry is None:
        return None
    ts, value = entry
    if (time.monotonic() - ts) > _READ_CACHE_TTL:
        return None
    return value


def cache_set(key: str, value: Any) -> None:
    if _READ_CACHE_TTL <= 0:
        return
    with _READ_CACHE_LOCK:
        _READ_CACHE[key] = (time.monotonic(), value)
        if len(_READ_CACHE) > _READ_CACHE_MAX:
            drop = sorted(_READ_CACHE.items(), key=lambda kv: kv[1][0])[: _READ_CACHE_MAX // 5]
            for k, _ in drop:
                _READ_CACHE.pop(k, None)


def cache_invalidate(prefix: str) -> None:
    with _READ_CACHE_LOCK:
        for key in [k for k in _READ_CACHE if k.startswith(prefix)]:
            _READ_CACHE.pop(key, None)


def display_state_set(username: str, payload: dict) -> None:
    with open_db() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO display1_state (username, payload_json, updated_at) VALUES (?,?,?)",
            (username, json.dumps(payload, ensure_ascii=False), now_iso()),
        )


def display_state_get(username: str) -> dict:
    with open_db() as connection:
        row = connection.execute(
            "SELECT payload_json FROM display1_state WHERE username=?",
            (username,),
        ).fetchone()
    if row is None:
        return {"active": False}
    try:
        return json.loads(row["payload_json"])
    except (TypeError, json.JSONDecodeError):
        return {"active": False}


def display_state_users() -> list[str]:
    with open_db() as connection:
        rows = connection.execute(
            "SELECT username FROM display1_state ORDER BY updated_at DESC"
        ).fetchall()
    return [r["username"] for r in rows]


def compute_claim_token(username: str, password: str) -> str:
    return hmac.new(
        key=(username + ":" + password).encode("utf-8"),
        msg=b"claim-station-v1",
        digestmod="sha256",
    ).hexdigest()


def compute_qr_token(order_code: str) -> str:
    """Short HMAC token embedded in QR codes so staff can't forge scan codes."""
    if not ORDER_API_TOKEN:
        return ""
    return hmac.new(
        key=ORDER_API_TOKEN.encode("utf-8"),
        msg=f"qr-v1:{order_code}".encode("utf-8"),
        digestmod="sha256",
    ).hexdigest()[:16]


def compute_super_token(username: str, password: str) -> str:
    return hmac.new(
        key=(username + ":" + password).encode("utf-8"),
        msg=b"superadmin-v1",
        digestmod="sha256",
    ).hexdigest()


def get_current_phase(connection: sqlite3.Connection | None = None) -> int:
    if connection is not None:
        row = connection.execute(
            "SELECT value FROM site_settings WHERE key = 'phase_override'"
        ).fetchone()
        if row is not None and row["value"] not in ("", None):
            try:
                return int(row["value"])
            except (ValueError, TypeError):
                pass
        config_row = connection.execute(
            "SELECT value FROM site_settings WHERE key = 'phase_configs'"
        ).fetchone()
        if config_row is not None and config_row["value"]:
            try:
                configs = json.loads(config_row["value"])
                today = datetime.now(TZ_BANGKOK).date()
                for phase_str, info in configs.items():
                    s, e = info.get("start", ""), info.get("end", "")
                    if s and e and date.fromisoformat(s) <= today <= date.fromisoformat(e):
                        return int(phase_str)
            except (json.JSONDecodeError, ValueError, KeyError):
                pass
    now = datetime.now(TZ_BANGKOK)
    m, d = now.month, now.day
    if m == 5 and 18 <= d <= 23: return 1
    if m == 5 and 25 <= d <= 30: return 2
    if m == 6 and  1 <= d <= 7:  return 3
    return 0


def create_order_code(sequence_number: int, connection: sqlite3.Connection | None = None) -> str:
    return f"{ORDER_PREFIX}{sequence_number:04d}{get_current_phase(connection)}"


def create_order_access_token() -> str:
    return secrets.token_hex(24)


def sanitize_file_name(file_name: str) -> str:
    sanitized = re.sub(r"[^a-z0-9.-]+", "-", file_name.strip().lower())
    sanitized = re.sub(r"-+", "-", sanitized).strip("-")
    return sanitized or "slip"


def resolve_slip_extension(file_name: str, mime_type: str) -> str:
    original_extension = Path(file_name).suffix.lower()
    if original_extension:
        return original_extension
    if mime_type == "image/jpeg":
        return ".jpg"
    if mime_type == "image/png":
        return ".png"
    if mime_type == "image/webp":
        return ".webp"
    if mime_type == "application/pdf":
        return ".pdf"
    return ".bin"


def resolve_stored_slip_path(stored_name: str | None, stored_path: str | None = None) -> Path | None:
    if isinstance(stored_path, str) and stored_path.strip():
        candidate = Path(stored_path.strip())
        if not candidate.is_absolute():
            return SLIPS_DIR / candidate.name
        return candidate

    if not stored_name:
        return None

    target_name = Path(str(stored_name)).name
    if not target_name:
        return None
    return SLIPS_DIR / target_name


def delete_local_slip_file(stored_name: str | None, stored_path: str | None = None) -> None:
    target_path = resolve_stored_slip_path(stored_name, stored_path)
    if target_path is None:
        return
    try:
        target_path.unlink()
    except FileNotFoundError:
        return


def persist_slip_file(
    order_code: str,
    original_name: str,
    mime_type: str,
    uploaded_at: str,
    file_content: bytes,
) -> tuple[dict[str, Any] | None, str | None]:
    if mime_type not in ALLOWED_SLIP_TYPES:
        return None, "unsupported slip mime type"

    file_size = len(file_content)
    if file_size < 1 or file_size > MAX_SLIP_SIZE_BYTES:
        return None, "slip.size must be between 1 and 5242880"

    safe_name = sanitize_file_name(Path(original_name).stem)
    extension = resolve_slip_extension(original_name, mime_type)
    stored_name = f"{order_code}-{int(datetime.now(timezone.utc).timestamp())}-{safe_name}{extension}"
    stored_path = SLIPS_DIR / stored_name
    stored_path.write_bytes(file_content)

    normalized_slip = {
        "originalName": original_name,
        "storedName": stored_name,
        "storedPath": str(stored_path),
        "mimeType": mime_type,
        "size": file_size,
        "uploadedAt": uploaded_at,
    }
    return normalized_slip, None


def materialize_slip_payload(order_code: str, slip: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    file_content_base64 = slip.get("fileContentBase64")
    if not isinstance(file_content_base64, str) or not file_content_base64.strip():
        stored_name = slip.get("storedName")
        stored_path = slip.get("storedPath")
        if (not isinstance(stored_name, str) or not stored_name.strip()) and isinstance(stored_path, str) and stored_path.strip():
            stored_name = Path(stored_path).name
        if not isinstance(stored_name, str) or not stored_name.strip():
            return None, "slip.storedName is required"
        return {
            "originalName": slip["originalName"],
            "storedName": Path(stored_name).name,
            "storedPath": str(resolve_stored_slip_path(stored_name, str(stored_path) if isinstance(stored_path, str) else None)),
            "mimeType": slip["mimeType"],
            "size": int(slip["size"]),
            "uploadedAt": slip["uploadedAt"],
        }, None

    mime_type = slip.get("mimeType")
    if not isinstance(mime_type, str) or mime_type not in ALLOWED_SLIP_TYPES:
        return None, "unsupported slip mime type"

    file_size = slip.get("size")
    if not isinstance(file_size, int) or file_size < 1 or file_size > MAX_SLIP_SIZE_BYTES:
        return None, "slip.size must be between 1 and 5242880"

    try:
        file_content = base64.b64decode(file_content_base64.encode("utf-8"), validate=True)
    except (binascii.Error, ValueError):
        return None, "slip.fileContentBase64 is invalid"

    if len(file_content) != file_size:
        return None, "slip.size does not match uploaded content"

    return persist_slip_file(
        order_code,
        str(slip["originalName"]),
        mime_type,
        str(slip["uploadedAt"]),
        file_content,
    )


def has_feedback_for_order(order_code: str) -> bool:
    try:
        with open_db() as conn:
            row = conn.execute("SELECT 1 FROM order_feedback WHERE order_code=?", (order_code,)).fetchone()
        return row is not None
    except sqlite3.Error:
        return False


def serialize_order(row: sqlite3.Row, include_access_token: bool = False) -> dict[str, Any]:
    row_keys = set(row.keys())
    slip = None
    if row["slip_stored_name"]:
        slip = {
            "originalName": row["slip_original_name"],
            "storedName": row["slip_stored_name"],
            "storedPath": row["slip_storage_path"] or str(resolve_stored_slip_path(row["slip_stored_name"])),
            "mimeType": row["slip_mime_type"],
            "size": row["slip_size"],
            "uploadedAt": row["slip_uploaded_at"],
        }
    items: list[dict[str, Any]] = []
    if "items_json" in row_keys and row["items_json"]:
        try:
            parsed_items = json.loads(row["items_json"])
            if isinstance(parsed_items, list):
                items = [item for item in parsed_items if isinstance(item, dict)]
        except json.JSONDecodeError:
            items = []

    if not items:
        items = [
            {
                "id": row["product_slug"],
                "product": {
                    "slug": row["product_slug"],
                    "name": row["product_name"],
                    "shortName": row["product_short_name"],
                    "tagline": row["product_tagline"],
                    "price": row["product_price"],
                    "image": row["product_image"],
                    "category": row["product_category"],
                },
                "size": row["size"],
                "quantity": row["quantity"],
                "unitPrice": row["product_price"],
                "totalAmount": row["product_price"] * row["quantity"],
            }
        ]

    payload = {
        "id": row["order_code"],
        "sequenceNumber": row["internal_id"],
        "roundNumber": row["round_number"],
        "status": row["status"],
        "paymentStatus": row["payment_status"],
        "khantokTicket": bool(
            row["khantok_ticket"] if "khantok_ticket" in row_keys else row["lucky_ticket"]
        ),
        "khantokTicketClaimedAt": (
            row["khantok_ticket_claimed_at"]
            if "khantok_ticket_claimed_at" in row_keys
            else row["lucky_ticket_claimed_at"]
        ),
        "khantokTicketAlreadyClaimed": bool(row["khantok_ticket_already_claimed"]) if "khantok_ticket_already_claimed" in row_keys else False,
        "khantokStationClaimedAt": (
            row["khantok_station_claimed_at"]
            if "khantok_station_claimed_at" in row_keys
            else None
        ),
        "khantokClaimWarning": khantok_claim_warning(
            row["received_at"] if "received_at" in row_keys else None,
            row["status"] if "status" in row_keys else None,
        ),
        "khantokTicketValue": int(row["khantok_ticket_value"]) if "khantok_ticket_value" in row_keys and row["khantok_ticket_value"] is not None else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "size": row["size"],
        "quantity": row["quantity"],
        "totalAmount": row["total_amount"],
        "product": {
            "slug": row["product_slug"],
            "name": row["product_name"],
            "shortName": row["product_short_name"],
            "tagline": row["product_tagline"],
            "price": row["product_price"],
            "image": row["product_image"],
            "category": row["product_category"],
        },
        "items": items,
        "customer": {
            "studentCode": row["student_code"] or "",
            "email": row["email"],
            "fullName": row["full_name"] or " ".join(
                value for value in [row["first_name"], row["last_name"]] if value
            ).strip(),
            "phone": row["phone"],
            "school": row["school"],
            "parentPhone": row["parent_phone"] or "",
        },
        "slip": slip,
        "adminNote": row["admin_note"] if "admin_note" in row_keys else None,
        "receivedAt": row["received_at"] if "received_at" in row_keys else None,
        "receivedBy": row["received_by"] if "received_by" in row_keys else None,
        "feedbackSubmitted": has_feedback_for_order(row["order_code"]),
        "qrToken": compute_qr_token(row["order_code"]),
    }
    if include_access_token:
        payload["accessToken"] = row["access_token"]
    return payload


def create_sheet_row_payload(order: dict[str, Any], event: str) -> dict[str, Any]:
    product = order.get("product") or {}
    customer = order.get("customer") or {}
    slip = order.get("slip") or {}
    return {
        "orderId": order.get("id", ""),
        "orderNumber": order.get("id", ""),
        "roundNumber": order.get("roundNumber", ""),
        "sequenceNumber": order.get("sequenceNumber", ""),
        "status": order.get("status", ""),
        "paymentStatus": order.get("paymentStatus", ""),
        "khantokTicket": order.get("khantokTicket", order.get("luckyTicket", False)),
        "khantokTicketValue": order.get("khantokTicketValue"),
        "khantokTicketClaimedAt": order.get(
            "khantokTicketClaimedAt", order.get("luckyTicketClaimedAt", "")
        ),
        "createdAt": order.get("createdAt", ""),
        "updatedAt": order.get("updatedAt", ""),
        "lastEvent": event,
        "lastSyncedAt": now_iso(),
        "productSlug": product.get("slug", ""),
        "productName": product.get("name", ""),
        "productShortName": product.get("shortName", ""),
        "productTagline": product.get("tagline", ""),
        "productCategory": product.get("category", ""),
        "productImage": product.get("image", ""),
        "unitPrice": product.get("price", ""),
        "size": order.get("size", ""),
        "quantity": order.get("quantity", ""),
        "totalAmount": order.get("totalAmount", ""),
        "studentCode": customer.get("studentCode", ""),
        "email": customer.get("email", ""),
        "fullName": customer.get("fullName", ""),
        "phone": customer.get("phone", ""),
        "school": customer.get("school", ""),
        "parentPhone": customer.get("parentPhone", ""),
        "slipOriginalName": slip.get("originalName", ""),
        "slipStoredName": slip.get("storedName", ""),
        "slipStoredPath": slip.get("storedPath", ""),
        "slipMimeType": slip.get("mimeType", ""),
        "slipSize": slip.get("size", ""),
        "slipUploadedAt": slip.get("uploadedAt", ""),
    }


def sync_order_to_google_sheets(order: dict[str, Any], event: str) -> None:
    if not GOOGLE_SHEETS_WEBHOOK_URL:
        return

    payload = {
        "event": event,
        "syncedAt": now_iso(),
        "token": GOOGLE_SHEETS_WEBHOOK_TOKEN,
        "row": create_sheet_row_payload(order, event),
        "order": order,
    }
    request_headers = {
        "Content-Type": "application/json; charset=utf-8",
    }

    request = urllib.request.Request(
        GOOGLE_SHEETS_WEBHOOK_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"unexpected response status {response.status}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as error:
        print(f"[google-sheets-sync] failed to sync order {order.get('id', '')}: {error}")


def validate_order_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "payload ต้องเป็น JSON object"

    product = payload.get("product")
    customer = payload.get("customer")
    if not isinstance(product, dict) or not isinstance(customer, dict):
        return None, "payload ต้องมี product และ customer"

    required_product_fields = ["slug", "name", "shortName", "tagline", "price", "image", "category"]
    for field in required_product_fields:
        if field not in product or product[field] in (None, ""):
            return None, f"product.{field} is required"

    required_customer_fields = [
        "studentCode",
        "email",
        "fullName",
        "phone",
        "school",
        "parentPhone",
    ]
    for field in required_customer_fields:
        if field not in customer or customer[field] in (None, ""):
            return None, f"customer.{field} is required"

    size = payload.get("size")
    quantity = payload.get("quantity")
    total_amount = payload.get("totalAmount")

    if not isinstance(size, str) or not size.strip():
        return None, "size is required"
    if not isinstance(quantity, int) or quantity < 1:
        return None, "quantity must be a positive integer"
    if not isinstance(total_amount, int) or total_amount < 0:
        return None, "totalAmount must be a non-negative integer"

    raw_items = payload.get("items")
    normalized_items: list[dict[str, Any]] = []
    if isinstance(raw_items, list) and raw_items:
        for index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                return None, "items must contain objects"

            item_product = item.get("product")
            if not isinstance(item_product, dict):
                return None, "item.product is required"

            for field in required_product_fields:
                if field not in item_product or item_product[field] in (None, ""):
                    return None, f"items[{index}].product.{field} is required"

            item_size = item.get("size")
            item_quantity = item.get("quantity")
            item_unit_price = item.get("unitPrice", item_product.get("price"))
            item_total_amount = item.get("totalAmount")

            if not isinstance(item_size, str) or not item_size.strip():
                return None, f"items[{index}].size is required"
            if not isinstance(item_quantity, int) or item_quantity < 1:
                return None, f"items[{index}].quantity must be a positive integer"
            if not isinstance(item_unit_price, int) or item_unit_price < 0:
                return None, f"items[{index}].unitPrice must be a non-negative integer"
            if not isinstance(item_total_amount, int):
                item_total_amount = item_unit_price * item_quantity

            item_school = item.get("school")
            normalized_items.append(
                {
                    "id": str(item.get("id") or f"{item_product.get('slug', 'item')}-{index + 1}"),
                    "product": item_product,
                    "size": item_size.strip(),
                    "school": item_school if isinstance(item_school, str) and item_school.strip() else None,
                    "quantity": item_quantity,
                    "unitPrice": item_unit_price,
                    "totalAmount": item_total_amount,
                }
            )

    if not normalized_items:
        normalized_items = [
            {
                "id": str(product.get("slug") or "item-1"),
                "product": product,
                "size": size.strip(),
                "quantity": quantity,
                "unitPrice": int(product["price"]),
                "totalAmount": int(product["price"]) * quantity,
            }
        ]

    # Derive the order total from the (validated) line items rather than trusting the
    # client-supplied top-level totalAmount. This guarantees the stored total always
    # matches the sum of items — the value OCR later checks the slip against.
    # NOTE: per-item unitPrice is still client-supplied; making price fully authoritative
    # requires a single source of product-price truth (see audit follow-up).
    computed_total = sum(int(item["totalAmount"]) for item in normalized_items)

    return {
        "product": product,
        "customer": customer,
        "size": size.strip(),
        "quantity": quantity,
        "total_amount": computed_total,
        "items": normalized_items,
    }, None


def validate_slip_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "payload ต้องเป็น JSON object"
    slip = payload.get("slip")
    if not isinstance(slip, dict):
        return None, "payload ต้องมี slip"

    required_fields = ["originalName", "mimeType", "size", "uploadedAt"]
    for field in required_fields:
        if field not in slip or slip[field] in (None, ""):
            return None, f"slip.{field} is required"

    if (
        ("storedName" not in slip or slip["storedName"] in (None, ""))
        and ("storedPath" not in slip or slip["storedPath"] in (None, ""))
        and ("fileContentBase64" not in slip or slip["fileContentBase64"] in (None, ""))
    ):
        return None, "slip.storedName, slip.storedPath or slip.fileContentBase64 is required"

    return slip, None


def fetch_order_by_code(connection: sqlite3.Connection, order_code: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM orders WHERE order_code = ?",
        (order_code,),
    ).fetchone()


def list_orders(
    connection: sqlite3.Connection,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    status_filter: str = "",
    round_filter: int = 0,
    student_code_filter: str = "",
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[str] = []
    params: list[Any] = []
    if round_filter > 0:
        conditions.append("round_number = ?")
        params.append(round_filter)
    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)
    if student_code_filter:
        conditions.append("student_code LIKE ?")
        params.append(f"%{student_code_filter}%")
    if search:
        like = f"%{search}%"
        conditions.append(
            "(order_code LIKE ? OR full_name LIKE ? OR student_code LIKE ? OR phone LIKE ? OR school LIKE ? OR product_name LIKE ?)"
        )
        params.extend([like] * 6)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    total_row = connection.execute(f"SELECT COUNT(*) AS cnt FROM orders {where}", params).fetchone()
    total = int(total_row["cnt"] if total_row else 0)
    offset = (page - 1) * per_page
    rows = connection.execute(
        f"SELECT * FROM orders {where} ORDER BY internal_id DESC LIMIT ? OFFSET ?",
        params + [per_page, offset],
    ).fetchall()
    return [serialize_order(row) for row in rows], total


def create_orders_summary(connection: sqlite3.Connection, round_filter: int = 0) -> dict[str, int]:
    settings_rows = connection.execute("SELECT key, value FROM site_settings WHERE key IN ('khantok_quota_100','khantok_quota_50')").fetchall()
    settings_map = {row["key"]: row["value"] for row in settings_rows}
    quota_100 = int(settings_map.get("khantok_quota_100") or KHANTOK_QUOTA_100)
    quota_50 = int(settings_map.get("khantok_quota_50") or KHANTOK_QUOTA_50)
    round_where = "AND round_number = ?" if round_filter > 0 else ""
    round_params: list[Any] = [round_filter] if round_filter > 0 else []
    used_100 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 100"
    ).fetchone()["c"])
    used_50 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 50"
    ).fetchone()["c"])
    counts = {
        row["status"]: row["cnt"]
        for row in connection.execute(
            f"SELECT status, COUNT(*) AS cnt FROM orders WHERE 1=1 {round_where} GROUP BY status",
            round_params,
        ).fetchall()
    }
    total_row = connection.execute(
        f"SELECT COUNT(*) AS cnt FROM orders WHERE status NOT IN ('refund','refunded') {round_where}",
        round_params,
    ).fetchone()
    khantok_station_row = connection.execute(
        f"""
        SELECT
            COUNT(*) AS claimed,
            SUM(CASE WHEN (received_at IS NULL OR received_at = '') AND status != 'received' THEN 1 ELSE 0 END) AS not_received
        FROM orders
        WHERE khantok_station_claimed_at IS NOT NULL
          AND khantok_station_claimed_at != ''
          AND status NOT IN ('rejected','cancelled','refund','refunded')
          {round_where}
        """,
        round_params,
    ).fetchone()
    # Count per-category qty from items_json so multi-item orders are fully counted
    # Exclude rejected, cancelled, refund, and refunded orders from product quantity totals
    category_counts: dict[str, int] = {}
    for row in connection.execute(
        f"SELECT items_json, product_category, quantity FROM orders WHERE status NOT IN ('rejected','cancelled','refund','refunded') {round_where}",
        round_params,
    ).fetchall():
        counted = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list) and parsed:
                    for item in parsed:
                        cat = (item.get("product") or {}).get("category") or ""
                        cat = {"shirt": "single"}.get(cat, cat)
                        qty = item.get("quantity") or 0
                        if cat:
                            category_counts[cat] = category_counts.get(cat, 0) + int(qty)
                    counted = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if not counted:
            cat = row["product_category"] or ""
            if cat:
                category_counts[cat] = category_counts.get(cat, 0) + int(row["quantity"] or 0)
    return {
        "total": int(total_row["cnt"] if total_row else 0),
        "pendingPayment": counts.get("pending_payment", 0),
        "waitingConfirm": counts.get("waiting_confirm", 0),
        "paid": counts.get("paid", 0) + counts.get("preparing", 0) + counts.get("shipped", 0) + counts.get("received", 0),
        "received": counts.get("received", 0),
        "rejected": counts.get("rejected", 0),
        "cancelled": counts.get("cancelled", 0),
        "khantokTicket100Quota": quota_100,
        "khantokTicket100Used": used_100,
        "khantokTicket100Remaining": max(quota_100 - used_100, 0),
        "khantokTicket50Quota": quota_50,
        "khantokTicket50Used": used_50,
        "khantokTicket50Remaining": max(quota_50 - used_50, 0),
        "khantokStationClaimed": int(khantok_station_row["claimed"] or 0),
        "khantokStationClaimedNotReceived": int(khantok_station_row["not_received"] or 0),
        "qtySingle": category_counts.get("single", 0),
        "qtyJacket": category_counts.get("jacket", 0),
        "qtyHeadband": category_counts.get("headband", 0),
    }


_SUMMARY_CACHE: dict[int, tuple[float, dict[str, int]]] = {}
_SUMMARY_CACHE_LOCK = threading.Lock()
_SUMMARY_CACHE_TTL = float(os.environ.get("ORDER_API_SUMMARY_CACHE_TTL", "2.0"))


def create_orders_summary_cached(
    connection: sqlite3.Connection, round_filter: int = 0
) -> dict[str, int]:
    """create_orders_summary() ที่แชร์ผลข้าม request ไม่กี่วินาที

    summary สแกน orders ทั้งตารางแล้ว json.loads ทุกแถว จึงแพงเกินกว่าจะให้ทุก
    request/stream คำนวณซ้ำเอง ค่าที่ได้เป็นตัวนับ ไม่ใช่ข้อมูลออเดอร์ ช้าไม่กี่
    วินาทีจึงยอมรับได้
    """
    if _SUMMARY_CACHE_TTL <= 0:
        return create_orders_summary(connection, round_filter)
    with _SUMMARY_CACHE_LOCK:
        entry = _SUMMARY_CACHE.get(round_filter)
        if entry is not None and (time.monotonic() - entry[0]) <= _SUMMARY_CACHE_TTL:
            return dict(entry[1])
    summary = create_orders_summary(connection, round_filter)
    with _SUMMARY_CACHE_LOCK:
        if len(_SUMMARY_CACHE) > 32:
            _SUMMARY_CACHE.clear()
        _SUMMARY_CACHE[round_filter] = (time.monotonic(), summary)
    return dict(summary)


_STATS_SNAPSHOT: tuple[float, dict[str, Any]] | None = None
_STATS_SNAPSHOT_LOCK = threading.Lock()
_STATS_SNAPSHOT_TTL = float(os.environ.get("ORDER_API_STATS_SNAPSHOT_TTL", "5.0"))


def _compute_stats_snapshot() -> dict[str, Any]:
    with open_db() as connection:
        summary = create_orders_summary_cached(connection)
        rev_row = connection.execute(
            "SELECT COALESCE(SUM(total_amount),0) AS r FROM orders WHERE status IN ('paid','preparing','shipped','received')"
        ).fetchone()
        revenue = int(rev_row["r"] if rev_row else 0)
        school_cnt = connection.execute(
            "SELECT COUNT(DISTINCT school) AS c FROM orders"
        ).fetchone()["c"]
        cost_rows = connection.execute(
            "SELECT items_json, product_category, quantity FROM orders WHERE status IN ('paid','preparing','shipped','received')"
        ).fetchall()
    cq: dict[str, int] = {}
    for row in cost_rows:
        ok = False
        if row["items_json"]:
            try:
                for itm in json.loads(row["items_json"]):
                    cat = (itm.get("product") or {}).get("category") or ""
                    if cat:
                        cq[cat] = cq.get(cat, 0) + int(itm.get("quantity") or 0)
                ok = True
            except Exception:
                pass
        if not ok:
            cat = row["product_category"] or ""
            if cat:
                cq[cat] = cq.get(cat, 0) + int(row["quantity"] or 0)
    profit = revenue - sum(cq.get(c, 0) * p for c, p in PRODUCT_COST.items())
    return {
        "summary": summary,
        "analytics": {
            "total": summary["total"],
            "revenue": revenue,
            "schoolCount": school_cnt,
            "profit": profit,
        },
    }


def get_stats_snapshot() -> dict[str, Any]:
    """ส่วนที่มาจาก DB ของ payload /admin/stats-stream คำนวณรอบเดียวแล้วแชร์ทุก connection

    ก่อนหน้านี้ทุก connection ที่ต่ออยู่ query ชุดเดียวกันเองทุก tick — 16 แท็บ
    เปิดค้าง = ทำงานเดียวกัน 16 รอบ กิน CPU จน request อื่นโดน GIL starve
    """
    global _STATS_SNAPSHOT
    snapshot = _STATS_SNAPSHOT
    if snapshot is not None and (time.monotonic() - snapshot[0]) <= _STATS_SNAPSHOT_TTL:
        return snapshot[1]
    with _STATS_SNAPSHOT_LOCK:
        snapshot = _STATS_SNAPSHOT
        if snapshot is not None and (time.monotonic() - snapshot[0]) <= _STATS_SNAPSHOT_TTL:
            return snapshot[1]
        payload = _compute_stats_snapshot()
        _STATS_SNAPSHOT = (time.monotonic(), payload)
        return payload


_STATS_STREAM_MAX = int(os.environ.get("ORDER_API_STATS_STREAM_MAX", "8"))
_STATS_STREAM_MAX_SECONDS = float(
    os.environ.get("ORDER_API_STATS_STREAM_MAX_SECONDS", "1800")
)
_stats_stream_count = 0
_stats_stream_lock = threading.Lock()


def _stats_stream_acquire() -> bool:
    global _stats_stream_count
    with _stats_stream_lock:
        if _stats_stream_count >= _STATS_STREAM_MAX:
            return False
        _stats_stream_count += 1
        return True


def _stats_stream_release() -> None:
    global _stats_stream_count
    with _stats_stream_lock:
        _stats_stream_count = max(0, _stats_stream_count - 1)


def update_order_status(
    connection: sqlite3.Connection,
    order_code: str,
    status: str,
) -> dict[str, Any] | None:
    existing_order = fetch_order_by_code(connection, order_code)
    if existing_order is None:
        return None

    prev_status = existing_order["status"]
    payment_status = PAYMENT_STATUS_BY_ORDER_STATUS[status]
    connection.execute(
        """
        UPDATE orders
        SET status = ?, payment_status = ?, updated_at = ?
        WHERE order_code = ?
        """,
        (status, payment_status, now_iso(), order_code),
    )
    log_audit(connection, order_code, "status_changed", f"{prev_status} → {status}")
    if prev_status == "received" and status != "received":
        removed = connection.execute(
            "DELETE FROM display2_picks WHERE order_internal_id=?",
            (existing_order["internal_id"],),
        ).rowcount
        if removed:
            log_audit(connection, order_code, "display2_cleared",
                      f"rollback received→{status}, removed {removed} picks")
        # The khantok queue row went with the rest, so the stamp claiming it was
        # handed out at the station has to go too — otherwise the order shows
        # "รับบัตรแล้ว" with nothing queued and no way back but the edit form.
        connection.execute(
            "UPDATE orders SET khantok_station_claimed_at = NULL WHERE order_code = ?",
            (order_code,),
        )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def update_order_fields(
    connection: sqlite3.Connection,
    order_code: str,
    fields: dict[str, Any],
    expected_updated_at: str | None = None,
) -> dict[str, Any] | None | bool:
    existing = fetch_order_by_code(connection, order_code)
    if existing is None:
        return None
    if expected_updated_at:
        existing_updated = existing["updated_at"] if "updated_at" in existing.keys() else ""
        if str(existing_updated or "") != str(expected_updated_at):
            return False  # conflict — order was modified by someone else

    allowed: dict[str, Any] = {}
    str_fields = {
        "fullName": "full_name",
        "studentCode": "student_code",
        "phone": "phone",
        "parentPhone": "parent_phone",
        "school": "school",
        "email": "email",
        "nickname": "nickname",
    }
    for key, col in str_fields.items():
        if key in fields and isinstance(fields[key], str):
            allowed[col] = fields[key].strip()

    if "adminNote" in fields:
        note = fields["adminNote"]
        allowed["admin_note"] = note.strip() if isinstance(note, str) else None

    # Khantok ticket — always sync khantok_ticket_claims together with orders fields
    khantok_changed = "khantokTicket" in fields and isinstance(fields["khantokTicket"], bool)
    value_changed = "khantokTicketValue" in fields
    claimed_changed = "khantokTicketAlreadyClaimed" in fields and isinstance(fields["khantokTicketAlreadyClaimed"], bool)

    if khantok_changed or value_changed or claimed_changed:
        order_id = existing["internal_id"]
        old_has_ticket = bool(existing["khantok_ticket"])
        new_has_ticket = fields["khantokTicket"] if khantok_changed else old_has_ticket

        if khantok_changed:
            allowed["khantok_ticket"] = 1 if new_has_ticket else 0
        if claimed_changed:
            allowed["khantok_ticket_already_claimed"] = 1 if fields["khantokTicketAlreadyClaimed"] else 0

        if not old_has_ticket and new_has_ticket:
            # Adding ticket: insert claim record so quota is consumed
            raw_val = fields.get("khantokTicketValue")
            new_value = int(raw_val) if isinstance(raw_val, (int, float)) and raw_val is not None else 100
            claimed_at = now_iso()
            connection.execute(
                "INSERT OR REPLACE INTO khantok_ticket_claims (order_id, claimed_at, ticket_value) VALUES (?, ?, ?)",
                (order_id, claimed_at, new_value),
            )
            allowed["khantok_ticket_value"] = new_value
            allowed["khantok_ticket_claimed_at"] = claimed_at

        elif old_has_ticket and not new_has_ticket:
            # Removing ticket: delete claim record so quota is returned
            connection.execute("DELETE FROM khantok_ticket_claims WHERE order_id = ?", (order_id,))
            allowed["khantok_ticket_value"] = None
            allowed["khantok_ticket_claimed_at"] = None

        elif old_has_ticket and new_has_ticket and value_changed:
            # Ticket stays but value changed: update the claim record's ticket_value
            raw_val = fields["khantokTicketValue"]
            new_value = int(raw_val) if isinstance(raw_val, (int, float)) and raw_val is not None else None
            if new_value is not None:
                connection.execute(
                    "UPDATE khantok_ticket_claims SET ticket_value = ? WHERE order_id = ?",
                    (new_value, order_id),
                )
            allowed["khantok_ticket_value"] = new_value

    # Station claim state — independent of quota; never touches khantok_ticket_claims
    # The toggle has to move the Display 2 khantok queue row as well as the column.
    # Editing only the column left the two out of step: unticking cleared the stamp
    # while the person stayed queued at the khantok station, and ticking never
    # queued anyone. "enqueue" runs even when the stamp is already set, so an order
    # left inconsistent by the old behaviour is repaired by re-ticking it.
    station_claim_action: str | None = None
    if "khantokStationClaimed" in fields and isinstance(fields["khantokStationClaimed"], bool):
        existing_station_claimed = (
            existing["khantok_station_claimed_at"]
            if "khantok_station_claimed_at" in existing.keys() else None
        )
        if fields["khantokStationClaimed"]:
            station_claim_action = "enqueue"
            if not existing_station_claimed:
                allowed["khantok_station_claimed_at"] = now_iso()
        else:
            station_claim_action = "dequeue"
            allowed["khantok_station_claimed_at"] = None

    if "items" in fields and isinstance(fields["items"], list) and fields["items"]:
        raw_items = fields["items"]
        product_price_map: dict[str, int] = {}
        try:
            for prow in connection.execute("SELECT slug, price FROM products").fetchall():
                product_price_map[prow["slug"]] = int(prow["price"] or 0)
        except sqlite3.Error:
            pass
        for dp in DEFAULT_PRODUCTS:
            product_price_map.setdefault(dp["slug"], int(dp["price"]))
        new_items: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            school = item.get("school")
            product = item.get("product") or {}
            slug = product.get("slug") or ""
            fallback_price = product_price_map.get(slug, 0)
            unit_price = int(item.get("unitPrice") or product.get("price") or fallback_price or 0)
            if not product.get("price") and fallback_price:
                product = {**product, "price": fallback_price}
            qty = max(1, int(item.get("quantity") or 1))
            total_amount = int(item.get("totalAmount") or (unit_price * qty))
            new_items.append({
                "id": str(item.get("id") or "item"),
                "product": product,
                "size": str(item.get("size") or "").strip(),
                "school": school if isinstance(school, str) and school.strip() else None,
                "quantity": qty,
                "unitPrice": unit_price,
                "totalAmount": total_amount,
            })
        if new_items:
            allowed["items_json"] = json.dumps(new_items, ensure_ascii=False)
            total = sum(it["totalAmount"] for it in new_items)
            allowed["total_amount"] = total
            first = new_items[0]
            allowed["size"] = first["size"]
            allowed["quantity"] = first["quantity"]

    if station_claim_action == "enqueue":
        enqueue_display2_khantok(connection, existing, "admin (edit form)")
    elif station_claim_action == "dequeue":
        # A row the khantok station already picked is a record that the ticket
        # physically went out — clearing the admin checkbox must not erase it.
        removed = connection.execute(
            "DELETE FROM display2_picks "
            "WHERE order_internal_id=? AND item_index=-1 AND picked_at IS NULL",
            (existing["internal_id"],),
        ).rowcount
        if removed:
            log_audit(connection, order_code, "display2_khantok_dequeued",
                      "admin edit form cleared the station-claimed toggle")
        else:
            still_picked = connection.execute(
                "SELECT 1 FROM display2_picks "
                "WHERE order_internal_id=? AND item_index=-1 AND picked_at IS NOT NULL",
                (existing["internal_id"],),
            ).fetchone()
            if still_picked:
                log_audit(connection, order_code, "display2_khantok_kept_picked",
                          "toggle cleared but the khantok row was already picked — row kept")

    if not allowed:
        return serialize_order(existing)

    allowed["updated_at"] = now_iso()
    set_clause = ", ".join(f"{col} = ?" for col in allowed)
    values = list(allowed.values()) + [order_code]
    connection.execute(f"UPDATE orders SET {set_clause} WHERE order_code = ?", values)

    changed = ", ".join(f"{k}={v!r}" for k, v in fields.items())
    log_audit(connection, order_code, "order_fields_updated", changed)
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def reserve_khantok_ticket(
    connection: sqlite3.Connection, order_id: int, student_code: str
) -> tuple[bool, str | None, bool, int | None]:
    existing_claim = connection.execute(
        "SELECT claimed_at, ticket_value FROM khantok_ticket_claims WHERE order_id = ?",
        (order_id,),
    ).fetchone()
    if existing_claim is not None:
        return True, str(existing_claim["claimed_at"]), False, int(existing_claim["ticket_value"])

    code = (student_code or "").strip()
    if not code.startswith(KHANTOK_STUDENT_CODE_PREFIX):
        return False, None, False, None

    # Only a still-live order should block a re-claim. A ticketed order that was later
    # cancelled/rejected/refunded must NOT permanently deny the student a ticket on a new
    # order. (Read-only guard — does not mutate the dead order's data.)
    duplicate = connection.execute(
        "SELECT 1 FROM orders WHERE student_code = ? AND khantok_ticket = 1 AND internal_id != ? "
        "AND status NOT IN ('cancelled', 'rejected', 'refund', 'refunded')",
        (code, order_id),
    ).fetchone()
    if duplicate is not None:
        return False, None, True, None

    count_100 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 100"
    ).fetchone()["c"])
    if count_100 < KHANTOK_QUOTA_100:
        ticket_value = 100
    else:
        count_50 = int(connection.execute(
            "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 50"
        ).fetchone()["c"])
        if count_50 < KHANTOK_QUOTA_50:
            ticket_value = 50
        else:
            return False, None, False, None

    claimed_at = now_iso()
    connection.execute(
        "INSERT INTO khantok_ticket_claims (order_id, claimed_at, ticket_value) VALUES (?, ?, ?)",
        (order_id, claimed_at, ticket_value),
    )
    return True, claimed_at, False, ticket_value


def create_order(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    now = now_iso()
    access_token = create_order_access_token()
    cursor = connection.execute(
        """
        INSERT INTO orders (
            round_number, status, payment_status, created_at, updated_at,
            product_slug, product_name, product_short_name, product_tagline, product_price, product_image, product_category,
            size, quantity, total_amount, items_json, access_token,
            student_code, full_name, parent_phone,
            first_name, last_name, nickname, email, phone, school
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            get_current_phase(connection),
            "pending_payment",
            "awaiting_payment",
            now,
            now,
            payload["product"]["slug"],
            payload["product"]["name"],
            payload["product"]["shortName"],
            payload["product"]["tagline"],
            int(payload["product"]["price"]),
            payload["product"]["image"],
            payload["product"]["category"],
            payload["size"],
            payload["quantity"],
            payload["total_amount"],
            json.dumps(payload["items"], ensure_ascii=False),
            access_token,
            payload["customer"]["studentCode"],
            payload["customer"]["fullName"],
            payload["customer"]["parentPhone"],
            payload["customer"]["fullName"],
            "",
            "",
            payload["customer"]["email"],
            payload["customer"]["phone"],
            payload["customer"]["school"],
        ),
    )
    sequence_number = int(cursor.lastrowid)
    order_code = create_order_code(sequence_number, connection)
    connection.execute(
        "UPDATE orders SET order_code = ? WHERE internal_id = ?",
        (order_code, sequence_number),
    )
    items_for_check = payload.get("items") or []
    is_headband_only = bool(items_for_check) and all(
        (i.get("product") or {}).get("slug") == "fresh-headband" for i in items_for_check
    )
    if is_headband_only:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed, khantok_ticket_value = False, None, False, None
    else:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed, khantok_ticket_value = reserve_khantok_ticket(
            connection, sequence_number, payload["customer"]["studentCode"]
        )
    connection.execute(
        "UPDATE orders SET khantok_ticket = ?, khantok_ticket_claimed_at = ?, khantok_ticket_already_claimed = ?, khantok_ticket_value = ? WHERE internal_id = ?",
        (1 if khantok_ticket else 0, khantok_ticket_claimed_at, 1 if khantok_ticket_already_claimed else 0, khantok_ticket_value, sequence_number),
    )
    if is_headband_only:
        connection.execute(
            "UPDATE orders SET status = 'refund', payment_status = 'refund_pending', updated_at = ? WHERE internal_id = ?",
            (now, sequence_number),
        )
        try:
            connection.execute(
                "INSERT INTO order_audit_log(order_code, event, detail, created_at) VALUES (?,?,?,?)",
                (order_code, "auto_refund_headband", "headband-only order auto-refunded on creation", now),
            )
        except sqlite3.Error:
            pass
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row, include_access_token=True)


def update_order(connection: sqlite3.Connection, order_code: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    existing_order = fetch_order_by_code(connection, order_code)
    if existing_order is None:
        return None

    delete_local_slip_file(existing_order["slip_stored_name"], existing_order["slip_storage_path"])
    now = now_iso()
    connection.execute(
        """
        UPDATE orders
        SET
            status = ?,
            payment_status = ?,
            updated_at = ?,
            product_slug = ?,
            product_name = ?,
            product_short_name = ?,
            product_tagline = ?,
            product_price = ?,
            product_image = ?,
            product_category = ?,
            size = ?,
            quantity = ?,
            total_amount = ?,
            items_json = ?,
            student_code = ?,
            full_name = ?,
            parent_phone = ?,
            first_name = ?,
            last_name = ?,
            nickname = ?,
            email = ?,
            phone = ?,
            school = ?,
            slip_original_name = NULL,
            slip_stored_name = NULL,
            slip_storage_path = NULL,
            slip_mime_type = NULL,
            slip_size = NULL,
            slip_uploaded_at = NULL
        WHERE order_code = ?
        """,
        (
            "pending_payment",
            "awaiting_payment",
            now,
            payload["product"]["slug"],
            payload["product"]["name"],
            payload["product"]["shortName"],
            payload["product"]["tagline"],
            int(payload["product"]["price"]),
            payload["product"]["image"],
            payload["product"]["category"],
            payload["size"],
            payload["quantity"],
            payload["total_amount"],
            json.dumps(payload["items"], ensure_ascii=False),
            payload["customer"]["studentCode"],
            payload["customer"]["fullName"],
            payload["customer"]["parentPhone"],
            payload["customer"]["fullName"],
            "",
            "",
            payload["customer"]["email"],
            payload["customer"]["phone"],
            payload["customer"]["school"],
            order_code,
        ),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def update_order_slip(connection: sqlite3.Connection, order_code: str, slip: dict[str, Any]) -> dict[str, Any] | None:
    existing_order = fetch_order_by_code(connection, order_code)
    if existing_order is None:
        return None

    now = now_iso()
    connection.execute(
        """
        UPDATE orders
        SET
            status = ?,
            payment_status = ?,
            updated_at = ?,
            slip_original_name = ?,
            slip_stored_name = ?,
            slip_storage_path = ?,
            slip_mime_type = ?,
            slip_size = ?,
            slip_uploaded_at = ?
        WHERE order_code = ?
        """,
        (
            "waiting_confirm",
            "waiting_confirm",
            now,
            slip["originalName"],
            slip["storedName"],
            slip["storedPath"],
            slip["mimeType"],
            int(slip["size"]),
            slip["uploadedAt"],
            order_code,
        ),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


# ── Slip OCR ──────────────────────────────────────────────────────────────────

def _run_ocr_for_slip(order_code: str, slip_path: str, expected_amount: float | None) -> None:
    try:
        with open_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO slip_ocr_results (order_code, status, checked_at) VALUES (?, 'pending', ?)",
                (order_code, now_iso()),
            )
            conn.commit()

        if slip_path.lower().endswith(".pdf"):
            with open_db() as conn:
                conn.execute(
                    "UPDATE slip_ocr_results SET status='skipped', raw_reason='PDF ไม่รองรับ OCR', checked_at=? WHERE order_code=?",
                    (now_iso(), order_code),
                )
                conn.commit()
            return

        import ocr as _ocr
        data = _ocr.extract_slip_data(slip_path)

        status = "rejected"
        raw_reason: str | None = None
        duplicate_of: str | None = None
        ref = data.get("ref_number")
        amount = data.get("amount")

        if not data.get("is_slip"):
            raw_reason = "ไม่พบข้อมูลสลิปในรูปภาพ"
        elif not ref:
            raw_reason = "ไม่พบเลขที่รายการในสลิป"
        else:
            with open_db() as conn:
                dup_row = conn.execute(
                    "SELECT order_code FROM slip_ocr_results WHERE ref_number = ? AND order_code != ? AND status NOT IN ('rejected','error','skipped','pending')",
                    (ref, order_code),
                ).fetchone()
            if dup_row:
                status = "duplicate"
                duplicate_of = dup_row["order_code"]
                raw_reason = f"ref ซ้ำกับออเดอร์ {duplicate_of}"
            elif expected_amount is not None and amount is not None and abs(amount - expected_amount) > 0.5:
                status = "amount_mismatch"
                raw_reason = f"จำนวนเงินไม่ตรง (สลิป: {amount:.2f}, ออเดอร์: {expected_amount:.2f})"
            else:
                status = "approved"

        with open_db() as conn:
            conn.execute(
                """UPDATE slip_ocr_results
                   SET status=?, ref_number=?, amount=?, date=?, sender=?, bank=?,
                       duplicate_of=?, raw_reason=?, checked_at=?
                   WHERE order_code=?""",
                (status, ref, amount, data.get("date"), data.get("sender"), data.get("bank"),
                 duplicate_of, raw_reason, now_iso(), order_code),
            )
            log_audit(conn, order_code, "slip_ocr_checked",
                      f"status={status}" + (f" ref={ref}" if ref else ""))
            conn.commit()
    except Exception as exc:
        import sys
        print(f"[OCR] ERROR order={order_code}: {exc}", file=sys.stderr)
        try:
            with open_db() as conn:
                conn.execute(
                    "UPDATE slip_ocr_results SET status='error', raw_reason=?, checked_at=? WHERE order_code=?",
                    (str(exc)[:300], now_iso(), order_code),
                )
                log_audit(conn, order_code, "slip_ocr_error", str(exc)[:200])
                conn.commit()
        except Exception as db_exc:
            print(f"[OCR] failed to persist error for order={order_code}: {db_exc}", file=sys.stderr)


def trigger_ocr_async(order_code: str, slip_path: str | None, expected_amount: float | None = None) -> None:
    import os, sys
    if not slip_path:
        return
    if not os.path.exists(slip_path):
        print(f"[OCR] slip not found on disk, skipping: {slip_path}", file=sys.stderr)
        return
    threading.Thread(
        target=_run_ocr_for_slip,
        args=(order_code, slip_path, expected_amount),
        daemon=True,
    ).start()


# ── Product management ────────────────────────────────────────────────────────

def serialize_product(row: sqlite3.Row) -> dict[str, Any]:
    image = row["image_path"] or "/images/POLP_post/Artboard 4.png"
    return {
        "slug": row["slug"],
        "name": row["name"],
        "shortName": row["short_name"],
        "tagline": row["tagline"],
        "description": row["description"],
        "price": row["price"],
        "category": row["category"],
        "requiresSize": bool(row["requires_size"]),
        "requiresSchool": bool(row["requires_school"]),
        "available": bool(row["available"]),
        "image": image,
        "images": [image, image],
        "sortOrder": row["sort_order"],
    }


def get_all_products(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM products ORDER BY sort_order ASC, id ASC"
    ).fetchall()
    return [serialize_product(row) for row in rows]


def get_product(connection: sqlite3.Connection, slug: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM products WHERE slug = ?", (slug,)).fetchone()
    return serialize_product(row) if row else None


def update_product(connection: sqlite3.Connection, slug: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        """
        UPDATE products
        SET name = ?, short_name = ?, tagline = ?, description = ?, price = ?, updated_at = ?
        WHERE slug = ?
        """,
        (
            str(payload.get("name", row["name"])).strip(),
            str(payload.get("shortName", row["short_name"])).strip(),
            str(payload.get("tagline", row["tagline"])).strip(),
            str(payload.get("description", row["description"])).strip(),
            max(0, int(payload.get("price", row["price"]))),
            now_iso(),
            slug,
        ),
    )
    return get_product(connection, slug)


def toggle_product_available(connection: sqlite3.Connection, slug: str, available: bool) -> dict[str, Any] | None:
    row = connection.execute("SELECT id FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        "UPDATE products SET available = ?, updated_at = ? WHERE slug = ?",
        (1 if available else 0, now_iso(), slug),
    )
    return get_product(connection, slug)


def update_product_image(connection: sqlite3.Connection, slug: str, image_path: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT id FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        "UPDATE products SET image_path = ?, updated_at = ? WHERE slug = ?",
        (image_path, now_iso(), slug),
    )
    return get_product(connection, slug)


def save_product_image_file(slug: str, original_name: str, mime_type: str, content: bytes) -> tuple[str | None, str | None]:
    if mime_type not in ALLOWED_IMAGE_TYPES:
        return None, "unsupported image type (use JPEG, PNG, or WebP)"
    if len(content) < 1 or len(content) > MAX_PRODUCT_IMAGE_SIZE_BYTES:
        return None, "image must be between 1 byte and 10 MB"
    PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(original_name).suffix.lower()
    if not suffix:
        suffix = ".jpg" if "jpeg" in mime_type else ".png"
    filename = f"{slug}-{int(datetime.now(timezone.utc).timestamp())}{suffix}"
    (PRODUCT_IMAGES_DIR / filename).write_bytes(content)
    return filename, None


# ── Site settings ─────────────────────────────────────────────────────────────

def get_site_settings(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = connection.execute("SELECT key, value FROM site_settings").fetchall()
    settings: dict[str, str] = {row["key"]: row["value"] for row in rows}
    phase_override_raw = settings.get("phase_override", "")
    phase_override = int(phase_override_raw) if phase_override_raw not in ("", None) else None
    phase_configs_raw = settings.get("phase_configs", "")
    try:
        phase_configs: dict = json.loads(phase_configs_raw) if phase_configs_raw else {}
    except (json.JSONDecodeError, TypeError):
        phase_configs = {}
    if not phase_configs:
        phase_configs = {
            "1": {"start": "2026-05-18", "end": "2026-05-23"},
            "2": {"start": "2026-05-25", "end": "2026-05-30"},
            "3": {"start": "2026-06-01", "end": "2026-06-07"},
        }
    max_phases = max((int(k) for k in phase_configs.keys()), default=3)
    return {
        "announcementBanner": settings.get("announcement_banner", ""),
        "announcementBannerEnabled": settings.get("announcement_banner_enabled", "0") == "1",
        "storeOpen": settings.get("store_open", "1") == "1",
        "siteClosed": settings.get("site_closed", "0") == "1",
        "scheduleEnabled": settings.get("schedule_enabled", "0") == "1",
        "scheduleWarningMessage": settings.get("schedule_warning_message", "เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59"),
        "orderDeadline": settings.get("order_deadline", ""),
        "phaseOverride": phase_override,
        "currentPhase": get_current_phase(connection),
        "phaseConfigs": phase_configs,
        "maxPhases": max_phases,
        "khantokQuota100": int(settings.get("khantok_quota_100") or KHANTOK_QUOTA_100),
        "khantokQuota50": int(settings.get("khantok_quota_50") or KHANTOK_QUOTA_50),
        "beRightBackDates": settings.get("be_right_back_dates", "2026-05-24,2026-05-31,2026-06-07"),
        "beRightBackActive": settings.get("be_right_back_active", "0") == "1",
        "bypassToken": BYPASS_TOKEN,
    }


def upsert_site_setting(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, now_iso()),
    )


# ── CSV export ────────────────────────────────────────────────────────────────

def export_orders_csv(orders: list[dict[str, Any]], ocr_map: dict[str, dict] | None = None) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "order_id", "status", "payment_status", "order_total_amount",
        "item_product_name", "item_category", "item_size", "item_quantity", "item_unit_price", "item_total_amount",
        "created_at", "full_name", "student_code", "phone", "email", "school", "parent_phone",
        "khantok_ticket", "ocr_status", "ocr_ref",
    ])
    for order in orders:
        c = order.get("customer") or {}
        ocr = (ocr_map or {}).get(order.get("id", ""), {})
        common = [
            order.get("id", ""),
            order.get("status", ""),
            order.get("paymentStatus", ""),
            order.get("totalAmount", ""),
        ]
        common_tail = [
            order.get("createdAt", ""),
            c.get("fullName", ""),
            c.get("studentCode", ""),
            c.get("phone", ""),
            c.get("email", ""),
            c.get("school", ""),
            c.get("parentPhone", ""),
            "yes" if order.get("khantokTicket") else "no",
            ocr.get("status", ""),
            ocr.get("ref_number", ""),
        ]
        items = order.get("items") or []
        if not items:
            p = order.get("product") or {}
            writer.writerow(common + [
                p.get("name", ""), p.get("category", ""),
                order.get("size", ""), order.get("quantity", ""),
                "", order.get("totalAmount", ""),
            ] + common_tail)
        else:
            for item in items:
                ip = item.get("product") or {}
                writer.writerow(common + [
                    ip.get("name", ""), ip.get("category", ""),
                    item.get("size", ""), item.get("quantity", ""),
                    item.get("unitPrice", ""), item.get("totalAmount", ""),
                ] + common_tail)
    return output.getvalue()


# ── Backup ────────────────────────────────────────────────────────────────────

def create_backup(connection: sqlite3.Connection) -> dict[str, Any]:
    orders, _ = list_orders(connection, page=1, per_page=999999)
    now = now_iso()
    orders_json = json.dumps(orders, ensure_ascii=False)
    cursor = connection.execute(
        "INSERT INTO order_backups (created_at, order_count, orders_json) VALUES (?, ?, ?)",
        (now, len(orders), orders_json),
    )
    connection.commit()
    return {"id": cursor.lastrowid, "createdAt": now, "label": "", "orderCount": len(orders)}


def list_backups(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT id, created_at, label, order_count FROM order_backups ORDER BY id DESC"
    ).fetchall()
    return [
        {"id": r["id"], "createdAt": r["created_at"], "label": r["label"], "orderCount": r["order_count"]}
        for r in rows
    ]


def get_backup(connection: sqlite3.Connection, backup_id: int) -> dict[str, Any] | None:
    row = connection.execute(
        "SELECT id, created_at, label, order_count, orders_json FROM order_backups WHERE id = ?",
        (backup_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "label": row["label"],
        "orderCount": row["order_count"],
        "orders": json.loads(row["orders_json"]),
    }


def delete_backup(connection: sqlite3.Connection, backup_id: int) -> bool:
    result = connection.execute("DELETE FROM order_backups WHERE id = ?", (backup_id,))
    connection.commit()
    return result.rowcount > 0


def get_product_breakdown(connection: sqlite3.Connection, category: str, round_filter: int = 0) -> dict[str, Any]:
    SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"]
    COLOR_ORDER = ["Blue", "Red", "White"]
    COLOR_THAI = {"Blue": "สีน้ำเงิน", "Red": "สีแดง", "White": "สีขาว"}
    # map legacy product_category values (shirt/jacket/headband) to slugs (single/jacket/headband)
    CATEGORY_TO_SLUG = {"shirt": "single", "jacket": "jacket", "headband": "headband"}
    rw = "WHERE status NOT IN ('rejected', 'cancelled')" + (" AND round_number = ?" if round_filter > 0 else "")
    rp: list[Any] = [round_filter] if round_filter > 0 else []

    if category == "jacket":
        # color → size → count
        color_size: dict[str, dict[str, int]] = {}
        for row in connection.execute(f"SELECT items_json, product_category, size, quantity FROM orders {rw}", rp).fetchall():
            items_processed = False
            if row["items_json"]:
                try:
                    parsed = json.loads(row["items_json"])
                    if isinstance(parsed, list):
                        for item in parsed:
                            raw_cat = (item.get("product") or {}).get("category") or ""
                            if CATEGORY_TO_SLUG.get(raw_cat, raw_cat) != "jacket":
                                continue
                            qty = int(item.get("quantity") or 0)
                            raw_size = (item.get("size") or "").strip()
                            parts = raw_size.split(" / ")
                            sz = parts[0].strip() or "ONE SIZE"
                            color = parts[1].strip() if len(parts) > 1 else "(ไม่ระบุสี)"
                            color_size.setdefault(color, {})
                            color_size[color][sz] = color_size[color].get(sz, 0) + qty
                        items_processed = True
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass
            if not items_processed and CATEGORY_TO_SLUG.get(row["product_category"] or "", row["product_category"] or "") == "jacket":
                qty = int(row["quantity"] or 0)
                raw_size = (row["size"] or "").strip()
                parts = raw_size.split(" / ")
                sz = parts[0].strip() or "ONE SIZE"
                color = parts[1].strip() if len(parts) > 1 else "(ไม่ระบุสี)"
                color_size.setdefault(color, {})
                color_size[color][sz] = color_size[color].get(sz, 0) + qty

        groups = []
        for color in COLOR_ORDER + [c for c in color_size if c not in COLOR_ORDER]:
            if color not in color_size:
                continue
            sz_map = color_size[color]
            sorted_sizes = sorted(sz_map.keys(), key=lambda k: SIZE_ORDER.index(k) if k in SIZE_ORDER else 99)
            rows = [{"label": sz, "count": sz_map[sz]} for sz in sorted_sizes]
            groups.append({
                "color": color,
                "colorThai": COLOR_THAI.get(color, color),
                "total": sum(sz_map.values()),
                "rows": rows,
            })
        return {"category": category, "groups": groups}

    # single / headband — flat rows
    counts: dict[str, int] = {}
    for row in connection.execute(f"SELECT items_json, product_category, size, quantity FROM orders {rw}", rp).fetchall():  # noqa: E501
        items_processed = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list):
                    for item in parsed:
                        raw_cat = (item.get("product") or {}).get("category") or ""
                        item_slug = CATEGORY_TO_SLUG.get(raw_cat, raw_cat)
                        if item_slug != category:
                            continue
                        qty = int(item.get("quantity") or 0)
                        if category == "headband":
                            key = (item.get("school") or "").strip() or "(ไม่ระบุสำนัก)"
                        else:
                            key = (item.get("size") or "").strip() or "ONE SIZE"
                        counts[key] = counts.get(key, 0) + qty
                    items_processed = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        pc = row["product_category"] or ""
        pc_slug = CATEGORY_TO_SLUG.get(pc, pc)
        if not items_processed and (row["product_slug"] == category or pc_slug == category):
            qty = int(row["quantity"] or 0)
            key = "(ไม่ระบุสำนัก)" if category == "headband" else (row["size"] or "").strip() or "ONE SIZE"
            counts[key] = counts.get(key, 0) + qty

    if category == "single":
        sorted_keys = sorted(counts.keys(), key=lambda k: SIZE_ORDER.index(k) if k in SIZE_ORDER else 99)
    else:
        sorted_keys = sorted(counts.keys(), key=lambda k: -counts[k])

    return {"category": category, "rows": [{"label": k, "count": counts[k]} for k in sorted_keys]}


PRODUCT_COST: dict[str, int] = {"single": 158, "jacket": 685, "headband": 20}

def get_analytics(connection: sqlite3.Connection) -> dict[str, Any]:
    exclude_refund = "status NOT IN ('refund','refunded')"
    total_row = connection.execute(f"SELECT COUNT(*) AS cnt FROM orders WHERE {exclude_refund}").fetchone()
    total = int(total_row["cnt"] if total_row else 0)
    school_count_row = connection.execute(f"SELECT COUNT(DISTINCT school) AS cnt FROM orders WHERE {exclude_refund}").fetchone()
    school_count = int(school_count_row["cnt"] if school_count_row else 0)
    student_count_row = connection.execute(
        f"SELECT COUNT(DISTINCT student_code) AS cnt FROM orders WHERE student_code IS NOT NULL AND student_code != '' AND {exclude_refund}"
    ).fetchone()
    student_count = int(student_count_row["cnt"] if student_count_row else 0)
    by_school = connection.execute(
        f"SELECT school, COUNT(*) AS cnt FROM orders WHERE {exclude_refund} GROUP BY school ORDER BY cnt DESC"
    ).fetchall()
    by_product = connection.execute(
        f"SELECT product_name, COUNT(*) AS cnt FROM orders WHERE {exclude_refund} GROUP BY product_name ORDER BY cnt DESC"
    ).fetchall()
    by_status = connection.execute(
        "SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status ORDER BY cnt DESC"
    ).fetchall()
    by_size = connection.execute(
        f"SELECT size, COUNT(*) AS cnt FROM orders WHERE size != '' AND {exclude_refund} GROUP BY size ORDER BY cnt DESC LIMIT 20"
    ).fetchall()
    by_day = connection.execute(
        f"SELECT DATE(created_at, '+7 hours') AS day, COUNT(*) AS cnt FROM orders WHERE DATE(created_at, '+7 hours') != '2026-05-17' AND {exclude_refund} GROUP BY day ORDER BY day"
    ).fetchall()
    # Revenue + cost: exclude headband items (refund) and exclude refund/refunded orders
    confirmed_rows = connection.execute(
        "SELECT items_json, product_category, product_price, quantity, total_amount FROM orders WHERE status IN ('paid','preparing','shipped','received')"
    ).fetchall()
    revenue = 0
    cost_qty: dict[str, int] = {}
    for row in confirmed_rows:
        counted = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list) and parsed:
                    for item in parsed:
                        cat = (item.get("product") or {}).get("category") or ""
                        qty = int(item.get("quantity") or 0)
                        up = int(item.get("unitPrice") or (item.get("product") or {}).get("price") or 0)
                        if cat == "headband":
                            continue
                        revenue += up * qty
                        if cat:
                            cost_qty[cat] = cost_qty.get(cat, 0) + qty
                    counted = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if not counted:
            cat = row["product_category"] or ""
            if cat != "headband":
                revenue += int(row["total_amount"] or 0)
                if cat:
                    cost_qty[cat] = cost_qty.get(cat, 0) + int(row["quantity"] or 0)
    refunded_row = connection.execute(
        "SELECT COALESCE(SUM(total_amount), 0) AS r, COUNT(*) AS c FROM orders WHERE status IN ('refund','refunded')"
    ).fetchone()
    refunded_amount = int(refunded_row["r"] if refunded_row else 0)
    refunded_count = int(refunded_row["c"] if refunded_row else 0)
    total_cost = sum(cost_qty.get(cat, 0) * price for cat, price in PRODUCT_COST.items())
    profit = revenue - total_cost
    return {
        "total": total,
        "revenue": revenue,
        "schoolCount": school_count,
        "studentCount": student_count,
        "profit": profit,
        "refundedAmount": refunded_amount,
        "refundedCount": refunded_count,
        "bySchool": [[row["school"], row["cnt"]] for row in by_school],
        "byProduct": [[row["product_name"], row["cnt"]] for row in by_product],
        "byStatus": [[row["status"], row["cnt"]] for row in by_status],
        "bySize": [[row["size"], row["cnt"]] for row in by_size],
        "byDay": [[row["day"], row["cnt"]] for row in by_day],
    }


class OrderRequestHandler(BaseHTTPRequestHandler):
    server_version = "SUOrderAPI/1.0"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        response_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _send_html(self, status: int, body: str) -> None:
        response_body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(response_body)

    def _send_file(self, path: Path, mime_type: str, file_name: str) -> None:
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "slip file not found"})
            return

        safe_file_name = sanitize_file_name(Path(file_name).name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header(
            "Content-Disposition",
            f'inline; filename="{html.escape(safe_file_name, quote=True)}"',
        )
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self) -> Any:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return None
        raw_body = self.rfile.read(content_length)
        return json.loads(raw_body.decode("utf-8"))

    def _read_multipart_slip(self, order_code: str) -> tuple[dict[str, Any] | None, str | None]:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            return None, "multipart/form-data content type is required"

        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return None, "request body is empty"

        raw_body = self.rfile.read(content_length)
        message = BytesParser(policy=default).parsebytes(
            (
                f"Content-Type: {content_type}\r\n"
                "MIME-Version: 1.0\r\n"
                "\r\n"
            ).encode("utf-8")
            + raw_body
        )

        if not message.is_multipart():
            return None, "multipart form data is invalid"

        slip_filename = ""
        slip_mime_type = "application/octet-stream"
        file_content = b""
        uploaded_at = now_iso()
        slip_count = 0

        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue

            field_name = str(part.get_param("name", header="content-disposition") or "")
            filename = part.get_filename()

            if field_name != "slip":
                continue

            slip_count += 1
            if slip_count > 1:
                return None, "multiple slip files are not supported"

            if not filename:
                return None, "slip filename is required"

            slip_filename = str(filename)
            slip_mime_type = str(part.get_content_type() or "application/octet-stream")
            file_content = part.get_payload(decode=True) or b""

        if slip_count == 0:
            return None, "slip is required"

        return persist_slip_file(
            order_code,
            slip_filename,
            slip_mime_type,
            uploaded_at,
            file_content,
        )

    def _has_global_authorization(self) -> bool:
        incoming = self.headers.get("Authorization", "")
        expected = f"Bearer {ORDER_API_TOKEN}"
        return bool(ORDER_API_TOKEN) and hmac.compare_digest(incoming, expected)

    def _has_claim_station_authorization(self) -> bool:
        incoming = self.headers.get("Authorization", "")
        if not incoming.startswith("Claim "):
            return False
        token = incoming[6:]
        with open_db() as conn:
            row = conn.execute("SELECT 1 FROM admin_users WHERE claim_token=?", (token,)).fetchone()
        return row is not None

    def _get_claim_station_user(self):
        incoming = self.headers.get("Authorization", "")
        if not incoming.startswith("Claim "):
            return None
        token = incoming[6:]
        with open_db() as conn:
            row = conn.execute(
                "SELECT username FROM admin_users WHERE claim_token=?",
                (token,),
            ).fetchone()
        return row["username"] if row else None

    def _has_superadmin_authorization(self) -> bool:
        incoming = self.headers.get("Authorization", "")
        if not incoming.startswith("Superadmin "):
            return False
        token = incoming[11:]
        with open_db() as conn:
            row = conn.execute(
                "SELECT 1 FROM admin_users WHERE super_token=? AND is_superadmin=1",
                (token,),
            ).fetchone()
        return row is not None

    def _is_authorized_for_order(self, row: sqlite3.Row) -> bool:
        if self._has_global_authorization():
            return True
        incoming = self.headers.get("X-Order-Token") or ""
        expected = row["access_token"] or ""
        return bool(expected) and hmac.compare_digest(incoming, expected)

    def _deny_unauthorized(self) -> bool:
        self._send_json(HTTPStatus.UNAUTHORIZED, {"message": "unauthorized"})
        return False

    def _require_admin_authorization(self) -> bool:
        if self._has_global_authorization():
            return True
        self._deny_unauthorized()
        return False

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "GET", sys.modules[__name__])
            return
        if path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return

        if path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/admin")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if path == "/admin/users":
            if not self._has_superadmin_authorization():
                self._deny_unauthorized()
                return
            with open_db() as conn:
                rows = conn.execute(
                    "SELECT username, is_superadmin, created_by, created_at FROM admin_users ORDER BY is_superadmin DESC, created_at ASC"
                ).fetchall()
            self._send_json(HTTPStatus.OK, {"users": [
                {"username": r["username"], "isSuperadmin": bool(r["is_superadmin"]),
                 "createdBy": r["created_by"], "createdAt": r["created_at"]}
                for r in rows
            ]})
            return

        if path == "/admin":
            self._send_html(HTTPStatus.OK, ADMIN_HTML)
            return

        if path == "/docs":
            spec_path = Path(__file__).parent / "openapi.yaml"
            spec_url = "/openapi.yaml"
            swagger_html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>SU Order API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({{url:"{spec_url}",dom_id:"#swagger-ui",presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:"BaseLayout"}});</script>
</body></html>"""
            self._send_html(HTTPStatus.OK, swagger_html)
            return

        if path == "/openapi.yaml":
            spec_path = Path(__file__).parent / "openapi.yaml"
            try:
                content = spec_path.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/yaml")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except FileNotFoundError:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "openapi.yaml not found"})
            return

        if path == "/admin/receipt-template":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
            self.send_header("Content-Length", str(len(RECEIPT_SVG)))
            self.end_headers()
            self.wfile.write(RECEIPT_SVG)
            return

        if path == "/orders":
            self._send_html(HTTPStatus.OK, ORDER_VIEW_HTML)
            return

        if path == "/claim-station":
            self._send_html(HTTPStatus.OK, CLAIM_STATION_HTML)
            return

        if path == "/display1":
            self._send_html(HTTPStatus.OK, DISPLAY_HTML)
            return

        if path == "/display2":
            self._send_html(HTTPStatus.OK, DISPLAY2_HTML)
            return

        if path == "/dis3":
            self._send_html(HTTPStatus.OK, DISPLAY3_HTML)
            return

        if path == "/dis3/data":
            # Public live sales counts for the /dis3 venue screen (qty only, not sensitive).
            # หน้านี้ poll ทุก 3 วินาทีต่อ 1 จอ จึงต้องใช้ตัว cached
            with open_db() as connection:
                summary = create_orders_summary_cached(connection)
            self._send_json(HTTPStatus.OK, {
                "polo": summary["qtySingle"],
                "jacket": summary["qtyJacket"],
            })
            return

        _asset_match = re.fullmatch(r"/assets/(slides/[a-zA-Z0-9_.\-]+|[a-zA-Z0-9_.\-]+)", path)
        if _asset_match:
            _rel = _asset_match.group(1)
            if _rel.startswith("slides/"):
                _asset_file = _slides_dir / _rel[7:]
            else:
                _asset_file = _TEMPLATES_DIR / "assets" / _rel
            if _asset_file.exists():
                _ext = _asset_file.suffix.lower()
                _mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "svg": "image/svg+xml"}.get(_ext.lstrip("."), "application/octet-stream")
                _data = _asset_file.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", _mime)
                self.send_header("Content-Length", str(len(_data)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(_data)
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        if path == "/fonts/SukhumvitSet.ttc":
            if _FONT_PATH.exists():
                data = _FONT_PATH.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "font/ttf")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "font not found"})
            return

        if path == "/display1/users":
            self._send_json(HTTPStatus.OK, display_state_users())
            return

        if path == "/display1/state":
            from urllib.parse import parse_qs as _pqs
            _qs = _pqs(urlparse(self.path).query)
            user = (_qs.get("user") or [""])[0].strip()
            self._send_json(HTTPStatus.OK, display_state_get(user))
            return

        if path == "/display1/slides":
            _ok_exts = {".png", ".jpg", ".jpeg", ".webp"}
            _slide_files = sorted([f.name for f in _slides_dir.iterdir() if f.is_file() and f.suffix.lower() in _ok_exts])
            self._send_json(HTTPStatus.OK, {"slides": [{"name": f, "url": f"/assets/slides/{f}"} for f in _slide_files]})
            return

        if path == "/display2/queue":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            from urllib.parse import parse_qs as _pqs
            _qs = _pqs(urlparse(self.path).query)
            station = (_qs.get("station") or [""])[0].strip().lower()
            if station not in {"polo", "jacket", "headband", "khantok"}:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid station"})
                return
            with open_db() as connection:
                rows = connection.execute(
                    """SELECT p.id, p.order_code, p.size, p.quantity, p.student_code,
                              p.nickname, p.full_name, p.queued_at, p.queued_by, p.undone_at,
                              p.item_index, o.items_json, o.status AS order_status
                         FROM display2_picks p
                         LEFT JOIN orders o ON o.internal_id = p.order_internal_id
                        WHERE p.station = ? AND p.picked_at IS NULL
                        ORDER BY p.queued_at DESC
                        LIMIT 50""",
                    (station,),
                ).fetchall()
            items = []
            for r in rows:
                school = ""
                line_total = 0
                unit_price = 0
                if station == "headband":
                    try:
                        parsed = json.loads(r["items_json"] or "[]")
                        if 0 <= r["item_index"] < len(parsed):
                            item = parsed[r["item_index"]] or {}
                            school = item.get("school") or ""
                            product = item.get("product") or {}
                            qty = int(item.get("quantity", 1) or 1)
                            unit_price = int(item.get("unitPrice") or product.get("price") or 35)
                            raw_total = item.get("totalAmount")
                            if raw_total:
                                line_total = int(raw_total)
                            else:
                                line_total = unit_price * qty
                    except (TypeError, json.JSONDecodeError, ValueError):
                        pass
                items.append({
                    "id": r["id"],
                    "orderCode": r["order_code"],
                    "size": r["size"],
                    "quantity": r["quantity"],
                    "studentCode": r["student_code"],
                    "nickname": r["nickname"],
                    "fullName": r["full_name"],
                    "queuedAt": r["queued_at"],
                    "queuedBy": r["queued_by"],
                    "undone": r["undone_at"] is not None,
                    "school": school,
                    "unitPrice": unit_price,
                    "lineTotal": line_total,
                    "orderStatus": r["order_status"],
                })
            with open_db() as conn2:
                today_count = conn2.execute(
                    """SELECT COUNT(*) AS c FROM display2_picks
                        WHERE station = ?
                          AND picked_at IS NOT NULL
                          AND DATE(picked_at, '+7 hours') = DATE('now', '+7 hours')""",
                    (station,),
                ).fetchone()["c"]
            self._send_json(HTTPStatus.OK, {"items": items, "todayPicked": today_count})
            return

        asset_serve_match = re.fullmatch(r"/display2/assets/([A-Za-z0-9_.-]+)", path)
        if asset_serve_match:
            fname = asset_serve_match.group(1)
            fpath = _assets_dir / fname
            if not fpath.exists() or not fpath.is_file():
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "asset not found"})
                return
            ext = fpath.suffix.lower()
            mime = {".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp",".gif":"image/gif"}.get(ext, "application/octet-stream")
            data = fpath.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/display2/admin/assets":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            with open_db() as connection:
                rows = connection.execute(
                    "SELECT id, station, category, filename, uploaded_at, uploaded_by"
                    " FROM display2_assets ORDER BY station, category, id"
                ).fetchall()
            grouped: dict = {"polo": [], "jacket": {}, "khantok": [], "headband": {}}
            for r in rows:
                entry = {
                    "id": r["id"],
                    "url": f"/display2/assets/{r['filename']}",
                    "filename": r["filename"],
                    "uploadedAt": r["uploaded_at"],
                    "uploadedBy": r["uploaded_by"],
                }
                st = r["station"]
                if st in ("headband", "jacket"):
                    cat = r["category"] or ""
                    grouped[st].setdefault(cat, []).append(entry)
                elif st in grouped:
                    grouped[st].append(entry)
            self._send_json(HTTPStatus.OK, grouped)
            return

        if path == "/display2/history":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            from urllib.parse import parse_qs as _pqs
            _qs = _pqs(urlparse(self.path).query)
            station = (_qs.get("station") or [""])[0].strip().lower()
            q = (_qs.get("q") or [""])[0].strip()
            if station not in {"polo", "jacket", "headband", "khantok"}:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid station"})
                return
            like = f"%{q}%"
            with open_db() as connection:
                rows = connection.execute(
                    """SELECT id, order_code, size, nickname, student_code,
                              picked_at, picked_by, undone_at
                         FROM display2_picks
                        WHERE station = ?
                          AND picked_at IS NOT NULL
                          AND DATE(picked_at, '+7 hours') = DATE('now', '+7 hours')
                          AND (? = ''
                               OR order_code LIKE ?
                               OR student_code LIKE ?
                               OR nickname LIKE ?)
                        ORDER BY picked_at DESC
                        LIMIT 200""",
                    (station, q, like, like, like),
                ).fetchall()
            items = [
                {
                    "id": r["id"],
                    "orderCode": r["order_code"],
                    "size": r["size"],
                    "nickname": r["nickname"],
                    "studentCode": r["student_code"],
                    "pickedAt": r["picked_at"],
                    "pickedBy": r["picked_by"],
                    "undone": r["undone_at"] is not None,
                }
                for r in rows
            ]
            self._send_json(HTTPStatus.OK, {"items": items})
            return

        if path == "/claim-station/stats":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            with open_db() as connection:
                today_bkk = datetime.now(TZ_BANGKOK).strftime("%Y-%m-%d")
                received_today = connection.execute(
                    "SELECT COUNT(*) AS c FROM orders WHERE status='received' AND DATE(received_at,'+7 hours')=?",
                    (today_bkk,),
                ).fetchone()["c"]
                received_total = connection.execute(
                    "SELECT COUNT(*) AS c FROM orders WHERE status='received'"
                ).fetchone()["c"]
                pending_pickup = connection.execute(
                    "SELECT COUNT(*) AS c FROM orders WHERE status='shipped'"
                ).fetchone()["c"]
            self._send_json(HTTPStatus.OK, {
                "receivedToday": received_today,
                "receivedTotal": received_total,
                "pendingPickup": pending_pickup,
            })
            return

        if path == "/claim-station/orders":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            from urllib.parse import parse_qs
            qs = parse_qs(urlparse(self.path).query)
            student_code = (qs.get("studentCode") or [""])[0].strip()
            phone = (qs.get("phone") or [""])[0].strip()
            full_name = (qs.get("name") or [""])[0].strip()
            if not student_code and not phone and not full_name:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "studentCode, phone หรือ name is required"})
                return
            with open_db() as connection:
                if student_code:
                    rows = connection.execute(
                        "SELECT * FROM orders WHERE student_code=? AND status IN ('shipped','refund','received') ORDER BY created_at DESC",
                        (student_code,),
                    ).fetchall()
                    not_found_msg = "ไม่พบออเดอร์พร้อมรับสำหรับรหัสนักศึกษานี้"
                elif phone:
                    rows = connection.execute(
                        "SELECT * FROM orders WHERE phone=? AND status IN ('shipped','refund','received') ORDER BY created_at DESC",
                        (phone,),
                    ).fetchall()
                    not_found_msg = "ไม่พบออเดอร์พร้อมรับสำหรับเบอร์โทรนี้"
                else:
                    pat = f"%{full_name}%"
                    rows = connection.execute(
                        "SELECT * FROM orders WHERE (full_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?) AND status IN ('shipped','refund','received') ORDER BY created_at DESC",
                        (pat, pat),
                    ).fetchall()
                    not_found_msg = "ไม่พบออเดอร์พร้อมรับสำหรับชื่อนี้"
            if not rows:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": not_found_msg})
                return
            self._send_json(HTTPStatus.OK, {"orders": [serialize_order(r) for r in rows]})
            return

        if path == "/claim-station/orders-pending":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            with open_db() as connection:
                rows = connection.execute(
                    "SELECT * FROM orders WHERE status='shipped' ORDER BY created_at ASC"
                ).fetchall()
            self._send_json(HTTPStatus.OK, {"orders": [serialize_order(r) for r in rows]})
            return

        claim_slip_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)/slip", path)
        if claim_slip_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            order_code = claim_slip_match.group(1)
            with open_db() as connection:
                row = fetch_order_by_code(connection, order_code)
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                return
            slip_path = resolve_stored_slip_path(row["slip_stored_name"], row["slip_storage_path"] if "slip_storage_path" in row.keys() else None)
            if slip_path is None or not slip_path.exists():
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบสลิป"})
                return
            mime = row["slip_mime_type"] or "image/jpeg"
            data = slip_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, max-age=300")
            self.end_headers()
            self.wfile.write(data)
            return

        claim_order_get_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)", path)
        if claim_order_get_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            from urllib.parse import parse_qs
            qs = parse_qs(urlparse(self.path).query)
            qr_token = (qs.get("qrToken") or [""])[0].strip()
            order_code = claim_order_get_match.group(1)
            if qr_token and ORDER_API_TOKEN:
                expected = compute_qr_token(order_code)
                if not hmac.compare_digest(qr_token, expected):
                    self._send_json(HTTPStatus.FORBIDDEN, {"message": "QR code ไม่ถูกต้อง — สแกนใหม่อีกครั้ง"})
                    return
            cache_key = f"cs_order:{order_code}"
            cached = cache_get(cache_key)
            if cached is not None:
                self._send_json(HTTPStatus.OK, cached)
                return
            with open_db() as connection:
                row = fetch_order_by_code(connection, order_code)
                ocr_row = connection.execute(
                    "SELECT amount, date, sender, bank, status, ref_number FROM slip_ocr_results WHERE order_code = ?",
                    (order_code,),
                ).fetchone()
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                return
            order_data = serialize_order(row)
            if ocr_row:
                order_data["slipOcr"] = {
                    "amount": ocr_row["amount"],
                    "date": ocr_row["date"],
                    "sender": ocr_row["sender"],
                    "bank": ocr_row["bank"],
                    "status": ocr_row["status"],
                    "refNumber": ocr_row["ref_number"],
                }
            response = {"order": order_data}
            cache_set(cache_key, response)
            self._send_json(HTTPStatus.OK, response)
            return

        if path == "/check-order":
            from urllib.parse import parse_qs
            qs = parse_qs(urlparse(self.path).query)
            code = (qs.get("code") or [""])[0].strip().upper()
            student_code = (qs.get("studentCode") or [""])[0].strip()
            if not code and not student_code:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "code หรือ studentCode is required"})
                return
            with open_db() as connection:
                if code:
                    row = fetch_order_by_code(connection, code)
                    rows = [row] if row else []
                else:
                    rows = [
                        serialize_order(r)
                        for r in connection.execute(
                            "SELECT * FROM orders WHERE student_code = ? ORDER BY internal_id DESC",
                            (student_code,),
                        ).fetchall()
                    ]
            if code and not rows:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                return
            def public_order(o: dict) -> dict:
                if isinstance(o, sqlite3.Row):
                    o = serialize_order(o)
                return {
                    "id": o.get("id"),
                    "status": o.get("status"),
                    "paymentStatus": o.get("paymentStatus"),
                    "totalAmount": o.get("totalAmount"),
                    "size": o.get("size"),
                    "quantity": o.get("quantity"),
                    "createdAt": o.get("createdAt"),
                    "updatedAt": o.get("updatedAt"),
                    "product": o.get("product"),
                    "items": o.get("items"),
                    "khantokTicket": o.get("khantokTicket"),
                    "khantokTicketValue": o.get("khantokTicketValue"),
                    "khantokTicketAlreadyClaimed": o.get("khantokTicketAlreadyClaimed"),
                    "customer": {
                        "fullName": (o.get("customer") or {}).get("fullName"),
                        "studentCode": (o.get("customer") or {}).get("studentCode"),
                        "school": (o.get("customer") or {}).get("school"),
                    },
                    "slip": {"uploadedAt": (o.get("slip") or {}).get("uploadedAt")} if o.get("slip") else None,
                    "qrToken": o.get("qrToken") if o.get("status") == "shipped" else None,
                }
            if code:
                self._send_json(HTTPStatus.OK, {"order": public_order(rows[0])})
            else:
                self._send_json(HTTPStatus.OK, {"orders": [public_order(o) for o in rows]})
            return

        if path == "/admin/stats-stream":
            if not self._require_admin_authorization():
                return
            if not _stats_stream_acquire():
                self._send_json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"message": "stats stream busy, try again later"},
                )
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            last_hash = None
            tick = 0
            started_at = time.monotonic()
            try:
                while (time.monotonic() - started_at) < _STATS_STREAM_MAX_SECONDS:
                    cutoff = time.time() - _VISITOR_ACTIVE_SECONDS
                    with _global_lock:
                        visitors = sum(1 for t in list(_visitor_registry.values()) if t >= cutoff)
                    payload = {"visitors": visitors, **get_stats_snapshot()}
                    h = hash(json.dumps(payload, sort_keys=True))
                    if h != last_hash:
                        self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
                        last_hash = h
                    else:
                        # heartbeat: ต้องเขียนทุก tick แม้ข้อมูลไม่เปลี่ยน ไม่งั้น client
                        # ที่ปิดแท็บไปแล้วจะไม่ถูกตรวจเจอ (รู้ได้ทาง BrokenPipe ตอนเขียน
                        # เท่านั้น) แล้ว thread นี้จะวนกิน CPU ไปจนกว่า process จะตาย
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    time.sleep(1 if tick < 10 else 5)
                    tick += 1
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                _stats_stream_release()
            return

        if path == "/admin/orders":
            if not self._require_admin_authorization():
                return
            from urllib.parse import parse_qs as _parse_qs
            qs = _parse_qs(urlparse(self.path).query)
            page = max(1, int((qs.get("page") or ["1"])[0]))
            per_page = min(max(1, int((qs.get("per_page") or ["50"])[0])), 200)
            search = (qs.get("search") or [""])[0].strip()
            status_f = (qs.get("status") or [""])[0].strip()
            student_code_f = (qs.get("studentCode") or [""])[0].strip()
            round_f = int((qs.get("round") or ["0"])[0]) if (qs.get("round") or ["0"])[0].isdigit() else 0
            with open_db() as connection:
                orders, total = list_orders(connection, page=page, per_page=per_page, search=search, status_filter=status_f, round_filter=round_f, student_code_filter=student_code_f)
                summary = create_orders_summary_cached(connection, round_filter=round_f)
            self._send_json(
                HTTPStatus.OK,
                {
                    "orders": orders,
                    "summary": summary,
                    "total": total,
                    "page": page,
                    "perPage": per_page,
                    "pages": max(1, (total + per_page - 1) // per_page),
                },
            )
            return

        extra_slip_file_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/extra-slips/(\d+)", path)
        if extra_slip_file_match:
            if not self._require_admin_authorization():
                return
            order_code = extra_slip_file_match.group(1)
            slip_id = int(extra_slip_file_match.group(2))
            with open_db() as connection:
                row = connection.execute(
                    "SELECT * FROM order_extra_slips WHERE id = ? AND order_code = ?",
                    (slip_id, order_code),
                ).fetchone()
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "extra slip not found"})
                return
            slip_path = resolve_stored_slip_path(row["stored_name"], row["storage_path"])
            if slip_path is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "file not found"})
                return
            self._send_file(
                slip_path,
                row["mime_type"] or "application/octet-stream",
                row["original_name"] or row["stored_name"] or "slip",
            )
            return

        extra_slips_list_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/extra-slips", path)
        if extra_slips_list_match:
            if not self._require_admin_authorization():
                return
            order_code = extra_slips_list_match.group(1)
            with open_db() as connection:
                rows = connection.execute(
                    "SELECT * FROM order_extra_slips WHERE order_code = ? ORDER BY id",
                    (order_code,),
                ).fetchall()
            slips = [
                {
                    "id": r["id"],
                    "originalName": r["original_name"],
                    "mimeType": r["mime_type"],
                    "fileSize": r["file_size"],
                    "uploadedAt": r["uploaded_at"],
                    "url": f"/admin/orders/{order_code}/extra-slips/{r['id']}",
                }
                for r in rows
            ]
            self._send_json(HTTPStatus.OK, slips)
            return

        slip_check_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/slip-check", path)
        if slip_check_match:
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                row = connection.execute(
                    "SELECT * FROM slip_ocr_results WHERE order_code = ?",
                    (slip_check_match.group(1),),
                ).fetchone()
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "no OCR data"})
                return
            self._send_json(HTTPStatus.OK, dict(row))
            return

        slip_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/slip", path)
        if slip_match:
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                row = fetch_order_by_code(connection, slip_match.group(1))
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            slip_path = resolve_stored_slip_path(row["slip_stored_name"], row["slip_storage_path"])
            if slip_path is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "slip not found"})
                return
            self._send_file(
                slip_path,
                row["slip_mime_type"] or "application/octet-stream",
                row["slip_original_name"] or row["slip_stored_name"] or "slip",
            )
            return

        if path == "/products":
            with open_db() as connection:
                self._send_json(HTTPStatus.OK, get_all_products(connection))
            return

        if path == "/site-settings":
            with open_db() as connection:
                data = get_site_settings(connection)
                data.pop("bypassToken", None)
                self._send_json(HTTPStatus.OK, data)
            return

        if path == "/site-status":
            from urllib.parse import parse_qs as _parse_qs_ss
            qs_ss = _parse_qs_ss(urlparse(self.path).query)
            visitor_ip = (qs_ss.get("ip") or [""])[0].strip()
            if visitor_ip:
                with _global_lock:
                    _visitor_registry[visitor_ip] = time.time()
            cutoff = time.time() - _VISITOR_ACTIVE_SECONDS
            with _global_lock:
                active_count = sum(1 for t in list(_visitor_registry.values()) if t >= cutoff)
            with open_db() as connection:
                rows = connection.execute(
                    "SELECT key, value FROM site_settings WHERE key IN ('site_closed','schedule_enabled','schedule_warning_message','be_right_back_dates','be_right_back_active')"
                ).fetchall()
                s = {r["key"]: r["value"] for r in rows}
                site_closed = s.get("site_closed", "0") == "1"
                schedule_enabled = s.get("schedule_enabled", "0") == "1"
                warning_message = s.get("schedule_warning_message", "เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59")
                be_right_back_dates_str = s.get("be_right_back_dates", "2026-05-24,2026-05-31,2026-06-07")
                be_right_back_dates = [d.strip() for d in be_right_back_dates_str.split(",") if d.strip()]
                be_right_back_active = s.get("be_right_back_active", "0") == "1"
                _TZ_BKK = timezone(timedelta(hours=7))
                today_bkk = datetime.now(_TZ_BKK).strftime("%Y-%m-%d")
                be_right_back = be_right_back_active or (today_bkk in be_right_back_dates)
            sched = get_schedule_status(schedule_enabled, warning_message)
            with _global_lock:
                test_warn = time.time() < _test_warning_until
            self._send_json(HTTPStatus.OK, {
                "siteClosed": site_closed,
                "scheduleEnabled": schedule_enabled,
                "scheduleClosed": sched["scheduleClosed"],
                "scheduleWarning": sched["scheduleWarning"] or test_warn,
                "scheduleWarningMessage": sched["scheduleWarningMessage"],
                "activeVisitors": active_count,
                "beRightBack": be_right_back,
            })
            return

        if path == "/admin/orders/export.csv":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                orders, _ = list_orders(connection, page=1, per_page=999999)
                ocr_rows = connection.execute(
                    "SELECT order_code, status, ref_number FROM slip_ocr_results"
                ).fetchall()
            ocr_map = {r["order_code"]: {"status": r["status"], "ref_number": r["ref_number"]} for r in ocr_rows}
            csv_content = export_orders_csv(orders, ocr_map)
            from datetime import date
            filename = f"orders-{date.today().isoformat()}.csv"
            response_body = ("﻿" + csv_content).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(response_body)
            return

        if path == "/admin/product-breakdown":
            if not self._require_admin_authorization():
                return
            from urllib.parse import parse_qs as _parse_qs_pb
            qs = _parse_qs_pb(urlparse(self.path).query)
            category = (qs.get("category") or ["single"])[0].strip()
            if category not in ("single", "jacket", "headband"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid category"})
                return
            breakdown_round = int((qs.get("round") or ["0"])[0]) if (qs.get("round") or ["0"])[0].isdigit() else 0
            with open_db() as connection:
                result = get_product_breakdown(connection, category, round_filter=breakdown_round)
            self._send_json(HTTPStatus.OK, result)
            return

        if path == "/admin/analytics":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                analytics = get_analytics(connection)
            self._send_json(HTTPStatus.OK, analytics)
            return

        if path == "/admin/audit-log":
            if not self._require_admin_authorization():
                return
            from urllib.parse import parse_qs as _parse_qs2
            qs = _parse_qs2(urlparse(self.path).query)
            order_code = (qs.get("orderCode") or [""])[0].strip().upper()
            student_code = (qs.get("studentCode") or [""])[0].strip()
            limit = min(max(1, int((qs.get("limit") or ["200"])[0])), 1000)
            with open_db() as connection:
                if order_code:
                    rows = connection.execute(
                        "SELECT * FROM order_audit_log WHERE order_code = ? ORDER BY created_at DESC LIMIT ?",
                        (order_code, limit),
                    ).fetchall()
                elif student_code:
                    rows = connection.execute(
                        """SELECT al.* FROM order_audit_log al
                           JOIN orders o ON o.order_code = al.order_code
                           WHERE o.student_code = ?
                           ORDER BY al.created_at DESC LIMIT ?""",
                        (student_code, limit),
                    ).fetchall()
                else:
                    rows = connection.execute(
                        "SELECT * FROM order_audit_log ORDER BY created_at DESC LIMIT ?",
                        (limit,),
                    ).fetchall()
            self._send_json(HTTPStatus.OK, {
                "log": [
                    {"id": row["id"], "orderCode": row["order_code"], "event": row["event"],
                     "detail": row["detail"], "createdAt": row["created_at"]}
                    for row in rows
                ]
            })
            return

        if path == "/admin/feedback":
            if not self._require_admin_authorization():
                return
            from urllib.parse import parse_qs as _pqs_fb
            qs = _pqs_fb(urlparse(self.path).query)
            limit = min(max(1, int((qs.get("limit") or ["500"])[0])), 2000)
            with open_db() as connection:
                rows = connection.execute(
                    """SELECT f.id, f.order_code, f.rating, f.comment, f.created_at,
                              o.full_name, o.student_code, o.school
                       FROM order_feedback f
                       LEFT JOIN orders o ON o.order_code = f.order_code
                       ORDER BY f.created_at DESC LIMIT ?""",
                    (limit,),
                ).fetchall()
                summary_row = connection.execute(
                    "SELECT COUNT(*) AS total, AVG(rating) AS avg_rating FROM order_feedback"
                ).fetchone()
                dist_rows = connection.execute(
                    "SELECT rating, COUNT(*) AS n FROM order_feedback GROUP BY rating"
                ).fetchall()
            distribution = {str(i): 0 for i in range(1, 6)}
            for r in dist_rows:
                distribution[str(int(r["rating"]))] = int(r["n"])
            self._send_json(HTTPStatus.OK, {
                "feedback": [
                    {
                        "id": row["id"],
                        "orderCode": row["order_code"],
                        "rating": int(row["rating"]),
                        "comment": row["comment"] or "",
                        "createdAt": row["created_at"],
                        "fullName": row["full_name"] or "",
                        "studentCode": row["student_code"] or "",
                        "school": row["school"] or "",
                    }
                    for row in rows
                ],
                "summary": {
                    "total": int(summary_row["total"] or 0),
                    "avgRating": float(summary_row["avg_rating"]) if summary_row["avg_rating"] is not None else 0.0,
                    "distribution": distribution,
                },
            })
            return

        if path == "/admin/site-settings":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                self._send_json(HTTPStatus.OK, get_site_settings(connection))
            return

        if path == "/admin/backups":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                backups = list_backups(connection)
            self._send_json(HTTPStatus.OK, {"backups": backups})
            return

        backup_detail_match = re.fullmatch(r"/admin/backups/(\d+)", path)
        if backup_detail_match:
            if not self._require_admin_authorization():
                return
            backup_id = int(backup_detail_match.group(1))
            with open_db() as connection:
                backup = get_backup(connection, backup_id)
            if backup is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "backup not found"})
                return
            self._send_json(HTTPStatus.OK, backup)
            return

        product_image_match = re.fullmatch(r"/product-images/([^/]+)", path)
        if product_image_match:
            raw_filename = product_image_match.group(1)
            safe_filename = re.sub(r"[^a-zA-Z0-9._-]", "", raw_filename)
            if not safe_filename or safe_filename != raw_filename:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid filename"})
                return
            image_path = PRODUCT_IMAGES_DIR / safe_filename
            if not image_path.exists():
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "image not found"})
                return
            suffix = Path(safe_filename).suffix.lower()
            mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
            mime = mime_map.get(suffix, "image/jpeg")
            content = image_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(content)
            return

        order_match = re.fullmatch(r"/orders/([A-Z0-9-]+)", path)
        if not order_match:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        order_code = order_match.group(1)
        if not ORDER_ID_PATTERN.match(order_code):
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid order id"})
            return

        with open_db() as connection:
            row = fetch_order_by_code(connection, order_code)
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            # Require authorization: the master Bearer (attached by the Next.js proxy)
            # OR the per-order X-Order-Token. Without this, order codes are enumerable
            # and this endpoint would leak every customer's PII + qrToken.
            if not self._is_authorized_for_order(row):
                self._deny_unauthorized()
                return
            self._send_json(HTTPStatus.OK, serialize_order(row))

    def do_POST(self) -> None:
        global _test_warning_until
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "POST", sys.modules[__name__])
            return

        if path == "/admin/users":
            if not self._has_superadmin_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            new_username = ((payload or {}).get("username") or "").strip() if isinstance(payload, dict) else ""
            new_password = ((payload or {}).get("password") or "") if isinstance(payload, dict) else ""
            if not new_username or not new_password:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "username and password required"})
                return
            if len(new_username) > 64 or len(new_password) > 128:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "username/password too long"})
                return
            claim_tok = compute_claim_token(new_username, new_password)
            with open_db() as conn:
                existing = conn.execute("SELECT 1 FROM admin_users WHERE username=?", (new_username,)).fetchone()
                if existing:
                    self._send_json(HTTPStatus.CONFLICT, {"message": f"username '{new_username}' มีอยู่แล้ว"})
                    return
                superadmin_row = conn.execute("SELECT username FROM admin_users WHERE super_token=? AND is_superadmin=1",
                    (self.headers.get("Authorization","")[11:],)).fetchone()
                created_by = superadmin_row["username"] if superadmin_row else "superadmin"
                conn.execute(
                    "INSERT INTO admin_users (username,claim_token,super_token,is_superadmin,created_by,created_at) VALUES (?,?,NULL,0,?,?)",
                    (new_username, claim_tok, created_by, now_iso()),
                )
                conn.commit()
            self._send_json(HTTPStatus.OK, {"ok": True, "username": new_username})
            return

        admin_slip_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/slip", path)
        if admin_slip_match:
            if not self._require_admin_authorization():
                return
            order_code = admin_slip_match.group(1)
            with open_db() as connection:
                existing_order = fetch_order_by_code(connection, order_code)
                if existing_order is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                previous_slip_stored_name = existing_order["slip_stored_name"]
                previous_slip_storage_path = existing_order["slip_storage_path"]
                materialized_slip, error_message = self._read_multipart_slip(order_code)
                if error_message:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                    return
                connection.execute(
                    """UPDATE orders SET slip_original_name=?, slip_stored_name=?, slip_storage_path=?,
                       slip_mime_type=?, slip_size=?, slip_uploaded_at=?, updated_at=? WHERE order_code=?""",
                    (
                        materialized_slip["originalName"], materialized_slip["storedName"],
                        materialized_slip["storedPath"], materialized_slip["mimeType"],
                        int(materialized_slip["size"]), materialized_slip["uploadedAt"],
                        now_iso(), order_code,
                    ),
                )
                log_audit(connection, order_code, "admin_slip_uploaded", "admin replaced slip")
                connection.commit()
                if previous_slip_stored_name and previous_slip_stored_name != materialized_slip["storedName"]:
                    delete_local_slip_file(previous_slip_stored_name, previous_slip_storage_path)
                row = fetch_order_by_code(connection, order_code)
            serialized = serialize_order(row)
            trigger_ocr_async(order_code, materialized_slip.get("storedPath"), serialized.get("totalAmount"))
            self._send_json(HTTPStatus.OK, serialized)
            return

        extra_slips_post_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/extra-slips", path)
        if extra_slips_post_match:
            if not self._require_admin_authorization():
                return
            order_code = extra_slips_post_match.group(1)
            with open_db() as connection:
                if fetch_order_by_code(connection, order_code) is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                materialized_slip, error_message = self._read_multipart_slip(order_code)
                if error_message:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                    return
                uploaded_at = now_iso()
                connection.execute(
                    """INSERT INTO order_extra_slips
                       (order_code, original_name, stored_name, storage_path, mime_type, file_size, uploaded_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        order_code,
                        materialized_slip["originalName"],
                        materialized_slip["storedName"],
                        materialized_slip["storedPath"],
                        materialized_slip["mimeType"],
                        int(materialized_slip["size"]),
                        uploaded_at,
                    ),
                )
                new_id = connection.execute("SELECT last_insert_rowid()").fetchone()[0]
                log_audit(connection, order_code, "admin_extra_slip_uploaded", f"extra slip {new_id} uploaded")
                connection.commit()
            self._send_json(HTTPStatus.OK, {
                "id": new_id,
                "originalName": materialized_slip["originalName"],
                "mimeType": materialized_slip["mimeType"],
                "fileSize": int(materialized_slip["size"]),
                "uploadedAt": uploaded_at,
                "url": f"/admin/orders/{order_code}/extra-slips/{new_id}",
            })
            return

        feedback_match = re.fullmatch(r"/orders/([A-Z0-9-]+)/feedback", path)
        if feedback_match:
            order_code = feedback_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid payload"})
                return
            try:
                rating = int(payload.get("rating", 0))
            except (TypeError, ValueError):
                rating = 0
            if rating < 1 or rating > 5:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "rating must be 1-5"})
                return
            comment = str(payload.get("comment") or "").strip()[:500]
            with open_db() as connection:
                existing_order = fetch_order_by_code(connection, order_code)
                if existing_order is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                if existing_order["status"] != "received":
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": "order not received yet"})
                    return
                existing_fb = connection.execute(
                    "SELECT 1 FROM order_feedback WHERE order_code=?", (order_code,)
                ).fetchone()
                if existing_fb:
                    self._send_json(HTTPStatus.CONFLICT, {"message": "feedback already submitted"})
                    return
                connection.execute(
                    "INSERT INTO order_feedback (order_code, rating, comment, created_at) VALUES (?, ?, ?, ?)",
                    (order_code, rating, comment, now_iso()),
                )
                log_audit(connection, order_code, "feedback_submitted", f"rating={rating}")
                connection.commit()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/display1/update":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if isinstance(payload, dict):
                username = str(payload.get("username") or "").strip()
                if username:
                    display_state_set(username, payload)
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/display1/slides/upload":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            _sname = re.sub(r"[^a-zA-Z0-9_.\-]", "_", str(payload.get("name", "")).strip())
            _sdata = str(payload.get("data", ""))
            if not _sname or not _sdata:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "missing name or data"})
                return
            if not re.search(r"\.(png|jpe?g|webp)$", _sname, re.IGNORECASE):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "unsupported type"})
                return
            import base64 as _b64
            try:
                _raw = _b64.b64decode(_sdata)
            except Exception:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid base64"})
                return
            if len(_raw) > 10 * 1024 * 1024:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "file too large (max 10MB)"})
                return
            (_slides_dir / _sname).write_bytes(_raw)
            self._send_json(HTTPStatus.OK, {"ok": True, "url": f"/assets/slides/{_sname}"})
            return

        if path == "/display1/slides/delete":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            _dname = str(payload.get("name", "")).strip()
            if not _dname or not re.fullmatch(r"[a-zA-Z0-9_.\-]+", _dname):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid name"})
                return
            _dtarget = _slides_dir / _dname
            if _dtarget.exists():
                _dtarget.unlink()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/display2/pick":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            pick_id = (payload or {}).get("pick_id") if isinstance(payload, dict) else None
            if not isinstance(pick_id, int):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "pick_id required"})
                return
            picker = self._get_claim_station_user() or "staff"
            ts = now_iso()
            with open_db() as connection:
                cursor = connection.execute(
                    "UPDATE display2_picks SET picked_at=?, picked_by=? "
                    "WHERE id=? AND picked_at IS NULL",
                    (ts, picker, pick_id),
                )
                if cursor.rowcount == 0:
                    row = connection.execute(
                        "SELECT picked_by, order_code, station FROM display2_picks WHERE id=?",
                        (pick_id,),
                    ).fetchone()
                    if row is None:
                        self._send_json(HTTPStatus.NOT_FOUND, {"message": "pick not found"})
                    else:
                        self._send_json(HTTPStatus.CONFLICT, {
                            "ok": False,
                            "reason": "already_picked",
                            "pickedBy": row["picked_by"] or "",
                        })
                    return
                row = connection.execute(
                    "SELECT order_code, order_internal_id, station FROM display2_picks WHERE id=?",
                    (pick_id,),
                ).fetchone()
                log_audit(connection, row["order_code"], "display2_picked",
                          f"station={row['station']} by={picker}")
                auto_refunded = False
                if row["station"] == "headband":
                    order_row = connection.execute(
                        "SELECT status, items_json FROM orders WHERE internal_id=?",
                        (row["order_internal_id"],),
                    ).fetchone()
                    if order_row:
                        try:
                            _items = json.loads(order_row["items_json"] or "[]")
                        except (TypeError, json.JSONDecodeError):
                            _items = []
                        def _slug(it):
                            p = it.get("product") or {}
                            return (it.get("slug") or p.get("slug") or "").lower()
                        headband_only = bool(_items) and all(
                            "headband" in _slug(i) for i in _items
                        )
                        if headband_only and order_row["status"] not in ("refunded", "cancelled", "rejected"):
                            remaining = connection.execute(
                                "SELECT COUNT(*) AS c FROM display2_picks "
                                "WHERE order_internal_id=? AND station='headband' AND picked_at IS NULL",
                                (row["order_internal_id"],),
                            ).fetchone()["c"]
                            if remaining == 0:
                                connection.execute(
                                    "UPDATE orders SET status='refunded', payment_status='refunded', updated_at=?"
                                    " WHERE internal_id=? AND status NOT IN ('refunded','cancelled','rejected')",
                                    (ts, row["order_internal_id"]),
                                )
                                log_audit(connection, row["order_code"], "refund_completed",
                                          f"auto set by headband station by={picker} (prev={order_row['status']})")
                                auto_refunded = True
                connection.commit()
            resp = {"ok": True}
            if auto_refunded:
                resp["autoRefunded"] = True
            self._send_json(HTTPStatus.OK, resp)
            return

        if path == "/display2/undo":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            pick_id = (payload or {}).get("pick_id") if isinstance(payload, dict) else None
            if not isinstance(pick_id, int):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "pick_id required"})
                return
            undoer = self._get_claim_station_user() or "staff"
            ts = now_iso()
            with open_db() as connection:
                cursor = connection.execute(
                    """UPDATE display2_picks
                          SET undone_at=?, picked_at=NULL, picked_by=NULL
                        WHERE id=?
                          AND picked_at IS NOT NULL
                          AND julianday(picked_at) >= julianday('now', '-1 hour')""",
                    (ts, pick_id),
                )
                if cursor.rowcount == 0:
                    row = connection.execute(
                        "SELECT picked_at FROM display2_picks WHERE id=?",
                        (pick_id,),
                    ).fetchone()
                    if row is None:
                        self._send_json(HTTPStatus.NOT_FOUND, {"message": "pick not found"})
                    else:
                        self._send_json(422, {"ok": False, "reason": "window_expired"})
                    return
                row = connection.execute(
                    "SELECT order_code, station FROM display2_picks WHERE id=?",
                    (pick_id,),
                ).fetchone()
                log_audit(connection, row["order_code"], "display2_undone",
                          f"station={row['station']} by={undoer}")
                connection.commit()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/claim-station/login":
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            username = (payload or {}).get("username", "") if isinstance(payload, dict) else ""
            password = (payload or {}).get("password", "") if isinstance(payload, dict) else ""
            if not (isinstance(username, str) and username and isinstance(password, str) and password):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "username and password required"})
                return
            token = compute_claim_token(username, password)
            with open_db() as conn:
                row = conn.execute("SELECT 1 FROM admin_users WHERE username=? AND claim_token=?", (username, token)).fetchone()
            if row:
                self._send_json(HTTPStatus.OK, {"token": token, "username": username})
            else:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"message": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"})
            return

        if path == "/admin/superlogin":
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            username = (payload or {}).get("username", "") if isinstance(payload, dict) else ""
            password = (payload or {}).get("password", "") if isinstance(payload, dict) else ""
            if not (isinstance(username, str) and username and isinstance(password, str) and password):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "username and password required"})
                return
            token = compute_super_token(username, password)
            with open_db() as conn:
                row = conn.execute(
                    "SELECT 1 FROM admin_users WHERE username=? AND super_token=? AND is_superadmin=1",
                    (username, token),
                ).fetchone()
            if row:
                self._send_json(HTTPStatus.OK, {"token": token, "username": username})
            else:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"message": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"})
            return

        if path == "/admin/test-warning":
            if not self._require_admin_authorization():
                return
            with _global_lock:
                _test_warning_until = time.time() + 60
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/admin/stop-test-warning":
            if not self._require_admin_authorization():
                return
            with _global_lock:
                _test_warning_until = 0
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/admin/backups":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                backup = create_backup(connection)
            self._send_json(HTTPStatus.CREATED, backup)
            return

        product_image_match = re.fullmatch(r"/admin/products/([a-z0-9-]+)/image", path)
        if product_image_match:
            if not self._require_admin_authorization():
                return
            slug = product_image_match.group(1)
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "multipart/form-data required"})
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "empty body"})
                return
            raw_body = self.rfile.read(content_length)
            message = BytesParser(policy=default).parsebytes(
                (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode("utf-8") + raw_body
            )
            if not message.is_multipart():
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid multipart data"})
                return
            image_content = b""
            image_filename = ""
            image_mime = ""
            for part in message.iter_parts():
                if part.get_content_disposition() != "form-data":
                    continue
                field_name = str(part.get_param("name", header="content-disposition") or "")
                if field_name != "image":
                    continue
                filename = part.get_filename()
                if not filename:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": "image filename required"})
                    return
                image_filename = str(filename)
                image_mime = str(part.get_content_type() or "image/jpeg")
                image_content = part.get_payload(decode=True) or b""
            if not image_content:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "image field is required"})
                return
            filename, error = save_product_image_file(slug, image_filename, image_mime, image_content)
            if error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": error})
                return
            with open_db() as connection:
                product = update_product_image(connection, slug, f"/product-images/{filename}")
                if product is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "product not found"})
                    return
                connection.commit()
            self._send_json(HTTPStatus.OK, product)
            return

        if path == "/display2/admin/assets":
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data"):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "multipart/form-data required"})
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 10 * 1024 * 1024:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid size (max 10MB)"})
                return
            raw_body = self.rfile.read(content_length)
            message = BytesParser(policy=default).parsebytes(
                (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode("utf-8") + raw_body
            )
            if not message.is_multipart():
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid multipart"})
                return
            station = ""
            category = ""
            img_bytes = b""
            img_ext = ".jpg"
            for part in message.iter_parts():
                if part.get_content_disposition() != "form-data":
                    continue
                name = str(part.get_param("name", header="content-disposition") or "")
                if name == "station":
                    station = (part.get_payload(decode=True) or b"").decode("utf-8", "ignore").strip().lower()
                elif name == "category":
                    category = (part.get_payload(decode=True) or b"").decode("utf-8", "ignore").strip()
                elif name == "image":
                    img_bytes = part.get_payload(decode=True) or b""
                    fn = str(part.get_filename() or "")
                    ext = Path(fn).suffix.lower()
                    if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                        img_ext = ext
            if station not in {"polo", "jacket", "headband", "khantok"}:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid station"})
                return
            if not img_bytes:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "image required"})
                return
            uploader = self._get_claim_station_user() or "staff"
            import uuid as _uuid
            new_name = f"{station}_{_uuid.uuid4().hex[:12]}{img_ext}"
            (_assets_dir / new_name).write_bytes(img_bytes)
            with open_db() as connection:
                cur = connection.execute(
                    "INSERT INTO display2_assets (station, category, filename, uploaded_at, uploaded_by)"
                    " VALUES (?,?,?,?,?)",
                    (station, category or None, new_name, now_iso(), uploader),
                )
                connection.commit()
                asset_id = cur.lastrowid
            self._send_json(HTTPStatus.CREATED, {
                "id": asset_id, "url": f"/display2/assets/{new_name}",
                "filename": new_name, "station": station, "category": category or None,
            })
            return

        if path != "/orders":
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
            return

        validated_payload, error_message = validate_order_payload(payload)
        if error_message:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
            return

        with open_db() as connection:
            connection.execute("BEGIN IMMEDIATE")
            slugs = {item["product"]["slug"] for item in validated_payload.get("items", []) if isinstance(item.get("product"), dict)}
            slugs.add(validated_payload["product"]["slug"])
            for slug in slugs:
                row = connection.execute("SELECT available FROM products WHERE slug = ?", (slug,)).fetchone()
                if row and not row["available"]:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": f"สินค้า {slug} ไม่เปิดจำหน่ายในขณะนี้"})
                    return
            order = create_order(connection, validated_payload)
            connection.commit()
            sync_order_to_google_sheets(order, "order_created")
            self._send_json(
                HTTPStatus.CREATED,
                {
                    **order,
                    "success": True,
                    "khantokTicket": bool(order.get("khantokTicket")),
                    "message": "ได้รับ Khantok ticket" if order.get("khantokTicket") else ("รับไปแล้ว " + str(order.get("customer", {}).get("studentCode", "") or "")) if order.get("khantokTicketAlreadyClaimed") else "สิทธิ์ Khantok ticket เต็มแล้ว",
                },
            )

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "PUT", sys.modules[__name__])
            return

        admin_product_match = re.fullmatch(r"/admin/products/([a-z0-9-]+)", path)
        if admin_product_match:
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid payload"})
                return
            with open_db() as connection:
                product = update_product(connection, admin_product_match.group(1), payload)
                if product is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "product not found"})
                    return
                connection.commit()
            self._send_json(HTTPStatus.OK, product)
            return

        admin_user_pw_match = re.fullmatch(r"/admin/users/([^/]+)/password", path)
        if admin_user_pw_match:
            if not self._has_superadmin_authorization():
                self._deny_unauthorized()
                return
            username = admin_user_pw_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            new_password = ((payload or {}).get("password") or "") if isinstance(payload, dict) else ""
            if not new_password or len(new_password) < 4:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"})
                return
            if len(new_password) > 128:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "รหัสผ่านยาวเกินไป"})
                return
            with open_db() as conn:
                row = conn.execute("SELECT is_superadmin FROM admin_users WHERE username=?", (username,)).fetchone()
                if not row:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": f"ไม่พบ user '{username}'"})
                    return
                new_claim = compute_claim_token(username, new_password)
                if row["is_superadmin"]:
                    new_super = compute_super_token(username, new_password)
                    conn.execute(
                        "UPDATE admin_users SET claim_token=?, super_token=? WHERE username=?",
                        (new_claim, new_super, username),
                    )
                else:
                    conn.execute(
                        "UPDATE admin_users SET claim_token=? WHERE username=?",
                        (new_claim, username),
                    )
                conn.commit()
            self._send_json(HTTPStatus.OK, {"ok": True, "username": username})
            return

        order_match = re.fullmatch(r"/orders/([A-Z0-9-]+)", path)
        if not order_match:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        with open_db() as connection:
            existing_order = fetch_order_by_code(connection, order_match.group(1))
            if existing_order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            if not self._is_authorized_for_order(existing_order):
                self._deny_unauthorized()
                return
            previous_slip_stored_name = existing_order["slip_stored_name"]
            previous_slip_storage_path = existing_order["slip_storage_path"]

            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return

            validated_payload, error_message = validate_order_payload(payload)
            if error_message:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                return

            order = update_order(connection, order_match.group(1), validated_payload)
            if order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            connection.commit()
            delete_local_slip_file(previous_slip_stored_name, previous_slip_storage_path)
            sync_order_to_google_sheets(order, "order_updated")
            self._send_json(HTTPStatus.OK, order)

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "PATCH", sys.modules[__name__])
            return

        claim_received_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)/received", path)
        if claim_received_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            order_code = claim_received_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                payload = {}
            received_by = (payload or {}).get("receivedBy", "") if isinstance(payload, dict) else ""
            with open_db() as connection:
                ts = now_iso()
                existing = fetch_order_by_code(connection, order_code)
                if existing is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                    return
                prev_status = existing["status"]
                if prev_status == "received":
                    self._send_json(HTTPStatus.CONFLICT, {"message": "ออเดอร์นี้ถูกรับสินค้าไปแล้ว", "alreadyReceived": True})
                    return
                if prev_status == "refunded":
                    self._send_json(HTTPStatus.CONFLICT, {"message": "ออเดอร์นี้คืนเงินไปแล้ว", "alreadyReceived": True})
                    return
                if prev_status == "shipped":
                    connection.execute(
                        "UPDATE orders SET status='received', payment_status='paid', received_at=?, received_by=?, updated_at=?"
                        " WHERE order_code=? AND status='shipped'",
                        (ts, received_by or "staff", ts, order_code),
                    )
                    log_audit(connection, order_code, "claim_received", f"received by {received_by or 'staff'}")
                elif prev_status == "refund":
                    log_audit(connection, order_code, "claim_refund_init",
                              f"queued to headband station by {received_by or 'staff'}")
                else:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": f"ออเดอร์มีสถานะ '{prev_status}' ยังไม่พร้อมรับ"})
                    return
                updated_row = fetch_order_by_code(connection, order_code)
                claim_user = self._get_claim_station_user() or received_by or "staff"
                try:
                    enqueue_display2(connection, updated_row, claim_user)
                except Exception as exc:
                    log_audit(connection, order_code,
                              "display2_enqueue_failed", f"{type(exc).__name__}: {exc}")
                connection.commit()
                updated = updated_row
            cache_invalidate(f"cs_order:{order_code}")
            self._send_json(HTTPStatus.OK, {"order": serialize_order(updated), "prevStatus": prev_status})
            return

        khantok_claim_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)/khantok-claimed", path)
        if khantok_claim_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            order_code = khantok_claim_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                payload = {}
            claimed_by = (payload or {}).get("claimedBy", "") if isinstance(payload, dict) else ""
            with open_db() as connection:
                claim_user = self._get_claim_station_user() or claimed_by or "staff"
                status_code, body = mark_khantok_station_claimed(connection, order_code, claim_user)
                if status_code == HTTPStatus.OK:
                    connection.commit()
                else:
                    # _PooledConnection.__exit__ auto-commits on clean exit; roll back
                    # explicitly so failure paths can never persist stray writes.
                    connection.rollback()
            cache_invalidate(f"cs_order:{order_code}")
            self._send_json(status_code, body)
            return

        claim_name_match = re.fullmatch(r"/claim-station/orders/([A-Z0-9-]+)/name", path)
        if claim_name_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            order_code = claim_name_match.group(1)
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            new_name = str((payload or {}).get("fullName", "")).strip() if isinstance(payload, dict) else ""
            if not new_name:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "fullName required"})
                return
            with open_db() as connection:
                ts = now_iso()
                cursor = connection.execute(
                    "UPDATE orders SET full_name=?, updated_at=? WHERE order_code=?",
                    (new_name, ts, order_code),
                )
                if cursor.rowcount == 0:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                    return
                connection.execute(
                    "UPDATE display2_picks SET full_name=? WHERE order_code=?",
                    (new_name, order_code),
                )
                log_audit(connection, order_code, "claim_rename", f"name → {new_name}")
                connection.commit()
            cache_invalidate(f"cs_order:{order_code}")
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        status_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/status", path)
        if status_match:
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            status = payload.get("status") if isinstance(payload, dict) else None
            if not isinstance(status, str) or status not in ORDER_STATUSES:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid status"})
                return
            with open_db() as connection:
                order = update_order_status(connection, status_match.group(1), status)
                if order is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                connection.commit()
            sync_order_to_google_sheets(order, "admin_status_updated")
            self._send_json(HTTPStatus.OK, order)
            return

        order_edit_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)", path)
        if order_edit_match:
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid payload"})
                return
            expected_updated_at = payload.pop("expectedUpdatedAt", None)
            with open_db() as connection:
                order = update_order_fields(connection, order_edit_match.group(1), payload, expected_updated_at)
                if order is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                if order is False:
                    self._send_json(HTTPStatus.CONFLICT, {"message": "ออเดอร์ถูกแก้ไขโดยผู้ใช้อื่นระหว่างที่คุณกำลังแก้ไข — กรุณารีโหลดและลองใหม่"})
                    return
                connection.commit()
            cache_invalidate(f"cs_order:{order_edit_match.group(1)}")
            self._send_json(HTTPStatus.OK, order)
            return

        if path == "/admin/orders/bulk-status":
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid payload"})
                return
            order_ids = payload.get("orderIds")
            status = payload.get("status")
            if not isinstance(order_ids, list) or not order_ids:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "orderIds must be a non-empty list"})
                return
            if not isinstance(status, str) or status not in ORDER_STATUSES:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid status"})
                return
            updated = []
            failed = []
            with open_db() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for oid in order_ids[:100]:
                    order = update_order_status(connection, str(oid), status)
                    if order:
                        updated.append(oid)
                    else:
                        failed.append(oid)
                connection.commit()
            for oid in updated:
                pass  # could sync sheets here if needed
            self._send_json(HTTPStatus.OK, {"updated": updated, "failed": failed})
            return

        product_avail_match = re.fullmatch(r"/admin/products/([a-z0-9-]+)/available", path)
        if product_avail_match:
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            available = payload.get("available") if isinstance(payload, dict) else None
            if not isinstance(available, bool):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "available must be a boolean"})
                return
            with open_db() as connection:
                product = toggle_product_available(connection, product_avail_match.group(1), available)
                if product is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "product not found"})
                    return
                connection.commit()
            self._send_json(HTTPStatus.OK, product)
            return

        if path == "/admin/site-settings":
            if not self._require_admin_authorization():
                return
            try:
                payload = self._read_json()
            except json.JSONDecodeError:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                return
            if not isinstance(payload, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid payload"})
                return
            with open_db() as connection:
                if "announcementBanner" in payload:
                    upsert_site_setting(connection, "announcement_banner", str(payload["announcementBanner"]))
                if "announcementBannerEnabled" in payload:
                    upsert_site_setting(connection, "announcement_banner_enabled", "1" if payload["announcementBannerEnabled"] else "0")
                if "storeOpen" in payload:
                    upsert_site_setting(connection, "store_open", "1" if payload["storeOpen"] else "0")
                if "orderDeadline" in payload:
                    upsert_site_setting(connection, "order_deadline", str(payload["orderDeadline"] or ""))
                if "phaseOverride" in payload:
                    v = payload["phaseOverride"]
                    upsert_site_setting(connection, "phase_override", str(int(v)) if v is not None else "")
                if "maxPhases" in payload:
                    upsert_site_setting(connection, "max_phases", str(max(1, int(payload["maxPhases"]))))
                if "phaseConfigs" in payload and isinstance(payload["phaseConfigs"], dict):
                    upsert_site_setting(connection, "phase_configs", json.dumps(payload["phaseConfigs"]))
                if "siteClosed" in payload:
                    upsert_site_setting(connection, "site_closed", "1" if payload["siteClosed"] else "0")
                if "scheduleEnabled" in payload:
                    upsert_site_setting(connection, "schedule_enabled", "1" if payload["scheduleEnabled"] else "0")
                if "scheduleWarningMessage" in payload:
                    upsert_site_setting(connection, "schedule_warning_message", str(payload["scheduleWarningMessage"]))
                if "khantokQuota100" in payload:
                    upsert_site_setting(connection, "khantok_quota_100", str(int(payload["khantokQuota100"])))
                if "khantokQuota50" in payload:
                    upsert_site_setting(connection, "khantok_quota_50", str(int(payload["khantokQuota50"])))
                if "beRightBackDates" in payload:
                    upsert_site_setting(connection, "be_right_back_dates", str(payload["beRightBackDates"]))
                if "beRightBackActive" in payload:
                    upsert_site_setting(connection, "be_right_back_active", "1" if payload["beRightBackActive"] else "0")
                connection.commit()
                settings = get_site_settings(connection)
            self._send_json(HTTPStatus.OK, settings)
            return

        order_match = re.fullmatch(r"/orders/([A-Z0-9-]+)/slip", path)
        if not order_match:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        with open_db() as connection:
            existing_order = fetch_order_by_code(connection, order_match.group(1))
            if existing_order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            # Require the master Bearer or the per-order X-Order-Token before accepting
            # a slip, matching the do_PUT /orders/{code} path. Without it, anyone could
            # overwrite a pending order's slip and trigger server-side OCR unauthenticated.
            if not self._is_authorized_for_order(existing_order):
                self._deny_unauthorized()
                return
            if existing_order["status"] != "pending_payment":
                self._send_json(HTTPStatus.FORBIDDEN, {"message": "slip upload is only allowed for pending_payment orders"})
                return
            previous_slip_stored_name = existing_order["slip_stored_name"]
            previous_slip_storage_path = existing_order["slip_storage_path"]

            content_type = self.headers.get("Content-Type", "")
            if content_type.lower().startswith("multipart/form-data"):
                materialized_slip, error_message = self._read_multipart_slip(order_match.group(1))
                if error_message:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                    return
            else:
                try:
                    payload = self._read_json()
                except json.JSONDecodeError:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
                    return

                slip_payload, error_message = validate_slip_payload(payload)
                if error_message:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                    return

                materialized_slip, error_message = materialize_slip_payload(order_match.group(1), slip_payload)
                if error_message:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
                    return

            order = update_order_slip(connection, order_match.group(1), materialized_slip)
            if order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            connection.commit()
            if (
                materialized_slip is not None
                and materialized_slip.get("storedName") != previous_slip_stored_name
            ):
                delete_local_slip_file(previous_slip_stored_name, previous_slip_storage_path)
            trigger_ocr_async(order_match.group(1), materialized_slip.get("storedPath") if materialized_slip else None, order.get("totalAmount"))
            sync_order_to_google_sheets(order, "payment_slip_uploaded")
            self._send_json(HTTPStatus.OK, order)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "DELETE", sys.modules[__name__])
            return

        asset_del_match = re.fullmatch(r"/display2/admin/assets/(\d+)", path)
        if asset_del_match:
            if not self._has_claim_station_authorization():
                self._deny_unauthorized()
                return
            aid = int(asset_del_match.group(1))
            with open_db() as connection:
                row = connection.execute("SELECT filename FROM display2_assets WHERE id=?", (aid,)).fetchone()
                if not row:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
                    return
                connection.execute("DELETE FROM display2_assets WHERE id=?", (aid,))
                connection.commit()
            try:
                fp = _assets_dir / row["filename"]
                if fp.exists(): fp.unlink()
            except Exception:
                pass
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        admin_user_del_match = re.fullmatch(r"/admin/users/([^/]+)", path)
        if admin_user_del_match:
            if not self._has_superadmin_authorization():
                self._deny_unauthorized()
                return
            username = admin_user_del_match.group(1)
            with open_db() as conn:
                row = conn.execute("SELECT is_superadmin FROM admin_users WHERE username=?", (username,)).fetchone()
                if not row:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": f"ไม่พบ user '{username}'"})
                    return
                if row["is_superadmin"]:
                    self._send_json(HTTPStatus.FORBIDDEN, {"message": "ไม่สามารถลบ superadmin ได้"})
                    return
                conn.execute("DELETE FROM admin_users WHERE username=?", (username,))
                conn.commit()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        main_slip_del_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/slip", path)
        if main_slip_del_match:
            if not self._require_admin_authorization():
                return
            order_code = main_slip_del_match.group(1)
            with open_db() as connection:
                row = fetch_order_by_code(connection, order_code)
                if row is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                stored_name = row["slip_stored_name"]
                stored_path = row["slip_storage_path"]
                if not stored_name:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "no slip to delete"})
                    return
                connection.execute(
                    """UPDATE orders SET slip_original_name=NULL, slip_stored_name=NULL,
                       slip_storage_path=NULL, slip_mime_type=NULL, slip_size=NULL,
                       slip_uploaded_at=NULL, updated_at=? WHERE order_code=?""",
                    (now_iso(), order_code),
                )
                log_audit(connection, order_code, "admin_slip_deleted", "admin deleted slip")
                connection.commit()
                updated_row = fetch_order_by_code(connection, order_code)
            delete_local_slip_file(stored_name, stored_path)
            self._send_json(HTTPStatus.OK, serialize_order(updated_row))
            return

        extra_slip_del_match = re.fullmatch(r"/admin/orders/([A-Z0-9-]+)/extra-slips/(\d+)", path)
        if extra_slip_del_match:
            if not self._require_admin_authorization():
                return
            order_code = extra_slip_del_match.group(1)
            slip_id = int(extra_slip_del_match.group(2))
            with open_db() as connection:
                row = connection.execute(
                    "SELECT * FROM order_extra_slips WHERE id = ? AND order_code = ?",
                    (slip_id, order_code),
                ).fetchone()
                if row is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "extra slip not found"})
                    return
                connection.execute("DELETE FROM order_extra_slips WHERE id = ?", (slip_id,))
                log_audit(connection, order_code, "admin_extra_slip_deleted", f"extra slip {slip_id} deleted")
                connection.commit()
            delete_local_slip_file(row["stored_name"], row["storage_path"])
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        backup_del_match = re.fullmatch(r"/admin/backups/(\d+)", path)
        if backup_del_match:
            if not self._require_admin_authorization():
                return
            backup_id = int(backup_del_match.group(1))
            with open_db() as connection:
                found = delete_backup(connection, backup_id)
            if not found:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "backup not found"})
                return
            self._send_json(HTTPStatus.OK, {"ok": True})
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        timestamp = datetime.now(TZ_BANGKOK).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.client_address[0]} {format % args}")


def _run_scheduled_backup() -> None:
    """Daemon thread: create one automatic backup per day at midnight Bangkok time, keep last 30."""
    import time, sys
    last_backup_date: str | None = None
    while True:
        try:
            now_bkk = datetime.now(TZ_BANGKOK)
            today = now_bkk.strftime("%Y-%m-%d")
            # trigger between 00:00 and 00:05
            if now_bkk.hour == 0 and now_bkk.minute < 5 and last_backup_date != today:
                with open_db() as conn:
                    # prune: keep most recent 30 auto-backups
                    rows = conn.execute(
                        "SELECT id FROM order_backups WHERE label LIKE 'auto-%' ORDER BY id DESC LIMIT -1 OFFSET 30"
                    ).fetchall()
                    for row in rows:
                        conn.execute("DELETE FROM order_backups WHERE id = ?", (row["id"],))
                    backup = create_backup(conn)
                    conn.execute(
                        "UPDATE order_backups SET label = ? WHERE id = ?",
                        (f"auto-{today}", backup["id"]),
                    )
                    conn.commit()
                last_backup_date = today
                print(f"[backup] auto backup created for {today} (id={backup['id']}, orders={backup['orderCount']})")
        except Exception as exc:
            import sys as _sys
            print(f"[backup] scheduled backup failed: {exc}", file=_sys.stderr)
        time.sleep(60)


class _ReusePortHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that enables SO_REUSEPORT so multiple worker
    processes can listen on the same port. Kernel load-balances accepts."""

    def server_bind(self) -> None:
        import socket as _sk
        try:
            self.socket.setsockopt(_sk.SOL_SOCKET, _sk.SO_REUSEADDR, 1)
            if hasattr(_sk, "SO_REUSEPORT"):
                self.socket.setsockopt(_sk.SOL_SOCKET, _sk.SO_REUSEPORT, 1)
        except OSError:
            pass
        super().server_bind()


if __name__ == "__main__":
    ensure_db()

    workers = max(1, int(os.environ.get("ORDER_API_WORKERS", "1")))
    # Fork workers-1 children *before* opening the socket so each process
    # binds independently with SO_REUSEPORT.
    is_primary = True
    for _ in range(workers - 1):
        pid = os.fork()
        if pid == 0:
            is_primary = False
            break

    # Only the primary process runs the scheduled backup thread — otherwise
    # every worker would race to write the same daily snapshot.
    if is_primary:
        threading.Thread(target=_run_scheduled_backup, daemon=True, name="scheduled-backup").start()

    server = _ReusePortHTTPServer((HOST, PORT), OrderRequestHandler)
    role = "primary" if is_primary else "worker"
    print(f"Order API [{role} pid={os.getpid()}] listening on http://{HOST}:{PORT}")
    server.serve_forever()
