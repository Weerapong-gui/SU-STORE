#!/usr/bin/env python3
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HOST = os.environ.get("ORDER_API_HOST", "0.0.0.0")
PORT = int(os.environ.get("ORDER_API_PORT", "3010"))
DB_PATH = Path(os.environ.get("ORDER_API_DB_PATH", str(Path.home() / "su-order-api" / "data" / "orders.db")))
ORDER_PREFIX = os.environ.get("ORDER_PREFIX", "FP28")
ORDER_ROUND = int(os.environ.get("ORDER_ROUND", "1"))
ORDER_API_TOKEN = os.environ.get("ORDER_API_TOKEN", "")
ORDER_ID_PATTERN = re.compile(r"^[A-Z0-9-]+$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS orders (
              internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT UNIQUE,
              round_number INTEGER NOT NULL,
              status TEXT NOT NULL,
              payment_status TEXT NOT NULL,
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
              first_name TEXT NOT NULL,
              last_name TEXT NOT NULL,
              nickname TEXT NOT NULL,
              email TEXT NOT NULL,
              phone TEXT NOT NULL,
              school TEXT NOT NULL,
              slip_original_name TEXT,
              slip_stored_name TEXT,
              slip_mime_type TEXT,
              slip_size INTEGER,
              slip_uploaded_at TEXT
          )
          """
      )
      connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)")


def open_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def create_order_code(sequence_number: int) -> str:
    return f"{ORDER_PREFIX}{sequence_number:04d}{ORDER_ROUND}"


def serialize_order(row: sqlite3.Row) -> dict[str, Any]:
    slip = None
    if row["slip_stored_name"]:
        slip = {
            "originalName": row["slip_original_name"],
            "storedName": row["slip_stored_name"],
            "mimeType": row["slip_mime_type"],
            "size": row["slip_size"],
            "uploadedAt": row["slip_uploaded_at"],
        }

    return {
        "id": row["order_code"],
        "sequenceNumber": row["internal_id"],
        "roundNumber": row["round_number"],
        "status": row["status"],
        "paymentStatus": row["payment_status"],
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
        "customer": {
            "firstName": row["first_name"],
            "lastName": row["last_name"],
            "nickname": row["nickname"],
            "email": row["email"],
            "phone": row["phone"],
            "school": row["school"],
        },
        "slip": slip,
    }


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

    required_customer_fields = ["firstName", "lastName", "nickname", "email", "phone", "school"]
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

    return {
        "product": product,
        "customer": customer,
        "size": size.strip(),
        "quantity": quantity,
        "total_amount": total_amount,
    }, None


def validate_slip_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "payload ต้องเป็น JSON object"
    slip = payload.get("slip")
    if not isinstance(slip, dict):
        return None, "payload ต้องมี slip"

    required_fields = ["originalName", "storedName", "mimeType", "size", "uploadedAt"]
    for field in required_fields:
        if field not in slip or slip[field] in (None, ""):
            return None, f"slip.{field} is required"

    return slip, None


def fetch_order_by_code(connection: sqlite3.Connection, order_code: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM orders WHERE order_code = ?",
        (order_code,),
    ).fetchone()


def create_order(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    now = now_iso()
    cursor = connection.execute(
        """
        INSERT INTO orders (
            round_number, status, payment_status, created_at, updated_at,
            product_slug, product_name, product_short_name, product_tagline, product_price, product_image, product_category,
            size, quantity, total_amount,
            first_name, last_name, nickname, email, phone, school
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            ORDER_ROUND,
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
            payload["customer"]["firstName"],
            payload["customer"]["lastName"],
            payload["customer"]["nickname"],
            payload["customer"]["email"],
            payload["customer"]["phone"],
            payload["customer"]["school"],
        ),
    )
    sequence_number = int(cursor.lastrowid)
    order_code = create_order_code(sequence_number)
    connection.execute(
        "UPDATE orders SET order_code = ? WHERE internal_id = ?",
        (order_code, sequence_number),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def update_order(connection: sqlite3.Connection, order_code: str, payload: dict[str, Any]) -> dict[str, Any] | None:
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
            first_name = ?,
            last_name = ?,
            nickname = ?,
            email = ?,
            phone = ?,
            school = ?,
            slip_original_name = NULL,
            slip_stored_name = NULL,
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
            payload["customer"]["firstName"],
            payload["customer"]["lastName"],
            payload["customer"]["nickname"],
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
            slip_mime_type = ?,
            slip_size = ?,
            slip_uploaded_at = ?
        WHERE order_code = ?
        """,
        (
            "payment_submitted",
            "slip_uploaded",
            now,
            slip["originalName"],
            slip["storedName"],
            slip["mimeType"],
            int(slip["size"]),
            slip["uploadedAt"],
            order_code,
        ),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


class OrderRequestHandler(BaseHTTPRequestHandler):
    server_version = "SUOrderAPI/1.0"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        response_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _read_json(self) -> Any:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return None
        raw_body = self.rfile.read(content_length)
        return json.loads(raw_body.decode("utf-8"))

    def _is_authorized(self) -> bool:
        if not ORDER_API_TOKEN:
            return True
        return self.headers.get("Authorization") == f"Bearer {ORDER_API_TOKEN}"

    def _require_authorization(self) -> bool:
        if self._is_authorized():
            return True
        self._send_json(HTTPStatus.UNAUTHORIZED, {"message": "unauthorized"})
        return False

    def do_GET(self) -> None:
        if not self._require_authorization():
            return

        path = urlparse(self.path).path
        if path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
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
            self._send_json(HTTPStatus.OK, serialize_order(row))

    def do_POST(self) -> None:
        if not self._require_authorization():
            return

        path = urlparse(self.path).path
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
            order = create_order(connection, validated_payload)
            connection.commit()
            self._send_json(HTTPStatus.CREATED, order)

    def do_PUT(self) -> None:
        if not self._require_authorization():
            return

        path = urlparse(self.path).path
        order_match = re.fullmatch(r"/orders/([A-Z0-9-]+)", path)
        if not order_match:
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
            order = update_order(connection, order_match.group(1), validated_payload)
            if order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            connection.commit()
            self._send_json(HTTPStatus.OK, order)

    def do_PATCH(self) -> None:
        if not self._require_authorization():
            return

        path = urlparse(self.path).path
        order_match = re.fullmatch(r"/orders/([A-Z0-9-]+)/slip", path)
        if not order_match:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "not found"})
            return

        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": "invalid json"})
            return

        slip_payload, error_message = validate_slip_payload(payload)
        if error_message:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": error_message})
            return

        with open_db() as connection:
            order = update_order_slip(connection, order_match.group(1), slip_payload)
            if order is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                return
            connection.commit()
            self._send_json(HTTPStatus.OK, order)

    def log_message(self, format: str, *args: Any) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.client_address[0]} {format % args}")


if __name__ == "__main__":
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), OrderRequestHandler)
    print(f"Order API listening on http://{HOST}:{PORT}")
    server.serve_forever()
