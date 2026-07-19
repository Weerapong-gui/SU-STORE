"""Integration tests for the phase-4 khantok station-claim flow.

Uses a real schema via ensure_db() pointed at a pytest tmp_path.
"""
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

# Stub out OCR module so order_api imports cleanly even without Tesseract
sys.modules.setdefault("ocr", MagicMock())

# Set temp directories to avoid permission errors at module import time
_tmp_for_import = TemporaryDirectory()
os.environ.setdefault("ORDER_API_SLIDES_DIR", str(Path(_tmp_for_import.name) / "slides"))
os.environ.setdefault("ORDER_API_ASSETS_DIR", str(Path(_tmp_for_import.name) / "assets"))

import order_api


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(order_api, "DB_PATH", tmp_path / "orders.db")
    monkeypatch.setattr(order_api, "SLIPS_DIR", tmp_path / "slips")
    monkeypatch.setattr(order_api, "PRODUCT_IMAGES_DIR", tmp_path / "product-images")
    # _CONN_POOL is module-global and path-unaware: a connection pooled by a previous
    # test would be handed out here still attached to that test's DB file. Give each
    # test its own pool and drain it on teardown.
    pool = []
    monkeypatch.setattr(order_api, "_CONN_POOL", pool)
    order_api.ensure_db()
    pooled = order_api.open_db()
    connection = pooled.__enter__()
    yield connection
    pooled.__exit__(None, None, None)
    for leftover in pool:
        leftover.close()


class TestStationClaimedColumn:
    def test_column_exists_after_ensure_db(self, temp_db):
        columns = {
            row["name"]
            for row in temp_db.execute("PRAGMA table_info(orders)").fetchall()
        }
        assert "khantok_station_claimed_at" in columns

    def test_serializer_exposes_station_claimed_at(self, temp_db):
        temp_db.execute(
            "INSERT INTO orders ("
            "  round_number, status, payment_status, created_at, updated_at,"
            "  order_code, khantok_station_claimed_at,"
            "  product_slug, product_name, product_short_name, product_tagline,"
            "  product_price, product_image, product_category,"
            "  size, quantity, total_amount,"
            "  first_name, last_name, nickname, email, phone, school, access_token"
            ") VALUES ("
            "  4, 'paid', 'paid', '2026-07-19T00:00:00Z', '2026-07-19T00:00:00Z',"
            "  'FP2899994', '2026-07-19T05:00:00Z',"
            "  'single', 'Test Product', 'Test', 'tagline',"
            "  100, 'image.png', 'category',"
            "  'M', 1, 100,"
            "  'John', 'Doe', 'nick', 'test@example.com', '0123456789', 'school', 'token'"
            ")"
        )
        row = order_api.fetch_order_by_code(temp_db, "FP2899994")
        data = order_api.serialize_order(row)
        assert data["khantokStationClaimedAt"] == "2026-07-19T05:00:00Z"


def _order_payload(student_code="6935001234", slug="single"):
    product = {
        "slug": slug, "name": "FRESHER POLO SHIRT", "shortName": "POLO",
        "tagline": "x", "price": 399, "image": "/p.png", "category": "shirt",
    }
    return {
        "product": product,
        "customer": {
            "studentCode": student_code, "email": "a@b.c", "fullName": "Test User",
            "phone": "0800000000", "school": "MFU", "parentPhone": "0811111111",
        },
        "size": "M", "quantity": 1, "totalAmount": 399,
        "items": [{"product": product, "size": "M", "quantity": 1,
                   "unitPrice": 399, "totalAmount": 399}],
    }


def _create_phase4_order(connection, student_code="6935001234", status="paid"):
    connection.execute(
        "INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('phase_override', '4', '2026-07-19T00:00:00Z')"
    )
    validated, error = order_api.validate_order_payload(_order_payload(student_code))
    assert error is None, error
    order = order_api.create_order(connection, validated)
    connection.execute(
        "UPDATE orders SET status=?, payment_status='paid' WHERE order_code=?",
        (status, order["id"]),
    )
    connection.commit()
    return order["id"]


def _quota_count(connection):
    return connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims"
    ).fetchone()["c"]


class TestMarkKhantokStationClaimed:
    def test_success_sets_timestamp_enqueues_and_keeps_quota(self, temp_db):
        code = _create_phase4_order(temp_db)
        quota_before = _quota_count(temp_db)
        status, body = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        temp_db.commit()
        assert status == 200
        assert body["order"]["khantokStationClaimedAt"]
        picks = temp_db.execute(
            "SELECT station, item_index FROM display2_picks WHERE order_code=?", (code,)
        ).fetchall()
        assert [(p["station"], p["item_index"]) for p in picks] == [("khantok", -1)]
        assert _quota_count(temp_db) == quota_before

    def test_double_claim_returns_409(self, temp_db):
        code = _create_phase4_order(temp_db)
        order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        temp_db.commit()
        status, body = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 409
        assert body["claimedAt"]

    def test_order_without_ticket_returns_400(self, temp_db):
        # student code without the 693 prefix -> no ticket reserved
        code = _create_phase4_order(temp_db, student_code="6805001234")
        status, _ = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 400

    def test_unpaid_order_returns_400(self, temp_db):
        code = _create_phase4_order(temp_db, status="pending_payment")
        status, _ = order_api.mark_khantok_station_claimed(temp_db, code, "staff1")
        assert status == 400

    def test_unknown_order_returns_404(self, temp_db):
        status, _ = order_api.mark_khantok_station_claimed(temp_db, "FP2800000", "staff1")
        assert status == 404


class TestAdminStationClaimedToggle:
    def test_true_sets_timestamp_and_quota_unchanged(self, temp_db):
        code = _create_phase4_order(temp_db)
        quota_before = _quota_count(temp_db)
        result = order_api.update_order_fields(
            temp_db, code, {"khantokStationClaimed": True}
        )
        temp_db.commit()
        assert result not in (None, False)
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"]
        assert _quota_count(temp_db) == quota_before

    def test_true_again_does_not_overwrite_timestamp(self, temp_db):
        code = _create_phase4_order(temp_db)
        temp_db.execute(
            "UPDATE orders SET khantok_station_claimed_at='2026-07-01T00:00:00Z'"
            " WHERE order_code=?", (code,),
        )
        order_api.update_order_fields(temp_db, code, {"khantokStationClaimed": True})
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"] == "2026-07-01T00:00:00Z"

    def test_false_clears_timestamp(self, temp_db):
        code = _create_phase4_order(temp_db)
        temp_db.execute(
            "UPDATE orders SET khantok_station_claimed_at='2026-07-01T00:00:00Z'"
            " WHERE order_code=?", (code,),
        )
        order_api.update_order_fields(temp_db, code, {"khantokStationClaimed": False})
        row = order_api.fetch_order_by_code(temp_db, code)
        assert row["khantok_station_claimed_at"] is None
