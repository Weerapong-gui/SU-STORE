from __future__ import annotations

import hmac
import html
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fp28 import config, slips
from fp28.auth import compute_claim_token, compute_qr_token, compute_super_token
from fp28.backups import create_backup, delete_backup, get_backup, list_backups, run_scheduled_backup
from fp28.config import HOST, ORDER_ID_PATTERN, ORDER_STATUSES, PORT
from fp28.database import cache_get, cache_invalidate, cache_set, ensure_db, log_audit, open_db
from fp28.display import display_state_get, display_state_set, display_state_users, enqueue_display2
from fp28.orders import (
    create_order,
    fetch_order_by_code,
    list_orders,
    mark_khantok_station_claimed,
    serialize_order,
    update_order,
    update_order_fields,
    update_order_slip,
    update_order_status,
    validate_order_payload,
    validate_slip_payload,
)
from fp28.pages import (
    ADMIN_HTML,
    CLAIM_STATION_HTML,
    DISPLAY2_HTML,
    DISPLAY3_HTML,
    DISPLAY_HTML,
    FONT_PATH,
    ORDER_VIEW_HTML,
    RECEIPT_SVG,
    TEMPLATES_DIR,
)
from fp28.products import (
    get_all_products,
    save_product_image_file,
    toggle_product_available,
    update_product,
    update_product_image,
)
from fp28.sheets import sync_order_to_google_sheets
from fp28.site import get_schedule_status, get_site_settings, upsert_site_setting
from fp28.slips import (
    delete_local_slip_file,
    materialize_slip_payload,
    persist_slip_file,
    resolve_stored_slip_path,
    sanitize_file_name,
)
from fp28.stats import (
    _STATS_STREAM_MAX_SECONDS,
    create_orders_summary_cached,
    export_orders_csv,
    get_analytics,
    get_product_breakdown,
    get_stats_snapshot,
    stats_stream_acquire,
    stats_stream_release,
)
from fp28.timeutil import TZ_BANGKOK, now_iso
from store import api as store_api

# In-memory visitor tracking (IP → last-seen timestamp)
_visitor_registry: dict[str, float] = {}


_VISITOR_ACTIVE_SECONDS = 120  # 2 minutes


# In-memory test-warning expiry (timestamp)
_test_warning_until: float = 0


_global_lock = threading.Lock()


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
            ).encode()
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
        expected = f"Bearer {config.ORDER_API_TOKEN}"
        return bool(config.ORDER_API_TOKEN) and hmac.compare_digest(incoming, expected)

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
            store_api.handle(self, "GET")
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
            _asset_file = config.SLIDES_DIR / _rel[7:] if _rel.startswith("slides/") else TEMPLATES_DIR / "assets" / _rel
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
            if FONT_PATH.exists():
                data = FONT_PATH.read_bytes()
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
            _slide_files = sorted([f.name for f in config.SLIDES_DIR.iterdir() if f.is_file() and f.suffix.lower() in _ok_exts])
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
                            line_total = int(raw_total) if raw_total else unit_price * qty
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
            fpath = config.ASSETS_DIR / fname
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
            slip_path = resolve_stored_slip_path(row["slip_stored_name"], row["slip_storage_path"] if "slip_storage_path" in row.keys() else None)  # noqa: SIM118 (sqlite3.Row)
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
            if qr_token and config.ORDER_API_TOKEN:
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
            if not stats_stream_acquire():
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
                stats_stream_release()
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
            filename = f"orders-{datetime.now(TZ_BANGKOK).date().isoformat()}.csv"
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
            image_path = config.PRODUCT_IMAGES_DIR / safe_filename
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
            store_api.handle(self, "POST")
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
            slips.trigger_ocr_async(order_code, materialized_slip.get("storedPath"), serialized.get("totalAmount"))
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
            (config.SLIDES_DIR / _sname).write_bytes(_raw)
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
            _dtarget = config.SLIDES_DIR / _dname
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
                (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw_body
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
                (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw_body
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
            (config.ASSETS_DIR / new_name).write_bytes(img_bytes)
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
            store_api.handle(self, "PUT")
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
            store_api.handle(self, "PATCH")
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
            slips.trigger_ocr_async(order_match.group(1), materialized_slip.get("storedPath") if materialized_slip else None, order.get("totalAmount"))
            sync_order_to_google_sheets(order, "payment_slip_uploaded")
            self._send_json(HTTPStatus.OK, order)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/v2/"):
            store_api.handle(self, "DELETE")
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
                fp = config.ASSETS_DIR / row["filename"]
                if fp.exists():
                    fp.unlink()
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
        threading.Thread(target=run_scheduled_backup, daemon=True, name="scheduled-backup").start()

    server = _ReusePortHTTPServer((HOST, PORT), OrderRequestHandler)
    role = "primary" if is_primary else "worker"
    print(f"Order API [{role} pid={os.getpid()}] listening on http://{HOST}:{PORT}")
    server.serve_forever()
