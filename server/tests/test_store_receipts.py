"""Frozen receipt snapshots and transactional store-wide numbering."""
import copy
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest

from server.store import db, receipts

from .test_store_v2 import CUSTOMER, _conn, _product


def _order(conn: sqlite3.Connection, status: str = "paid") -> str:
    product = _product(conn, stock=None)
    code = db.create_order(conn, {
        "items": [{"variantId": product["variants"][0]["id"], "quantity": 1}], "customer": CUSTOMER,
    })["orderCode"]
    db.update_order(conn, code, {"status": status})
    conn.commit()
    return code


def _issue(conn: sqlite3.Connection, code: str) -> dict:
    return receipts.issue_receipt(conn, code, issued_by="staff", customer=CUSTOMER)


def test_first_receipt_number():
    conn = _conn()
    assert receipts.next_receipt_no(conn) == "SU-R2569-0001"
    assert receipts.next_receipt_no(conn) == "SU-R2569-0001"
    assert _issue(conn, _order(conn))["receiptNo"] == "SU-R2569-0001"
    assert _issue(conn, _order(conn))["receiptNo"] == "SU-R2569-0002"


def test_issue_is_idempotent_per_order():
    conn = _conn()
    code = _order(conn)
    first = _issue(conn, code)
    assert _issue(conn, code) == first
    assert conn.execute("SELECT COUNT(*) FROM store_receipts").fetchone()[0] == 1


def test_concurrent_issue_no_duplicates(tmp_path):
    path = str(tmp_path / "store.db")
    setup = _conn(path)
    codes = [_order(setup) for _ in range(8)]

    def issue(code: str) -> str:
        with sqlite3.connect(path, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            return _issue(conn, code)["receiptNo"]

    with ThreadPoolExecutor(max_workers=8) as pool:
        numbers = list(pool.map(issue, codes))
    assert sorted(numbers) == [f"SU-R2569-{i:04d}" for i in range(1, 9)]


@pytest.mark.parametrize("status", ["pending_payment", "waiting_confirm", "cancelled"])
def test_unpaid_order_rejected(status):
    conn = _conn()
    with pytest.raises(db.StoreError) as error:
        _issue(conn, _order(conn, status))
    assert error.value.status == 400
    assert error.value.message == "ออกใบเสร็จได้เฉพาะออเดอร์ที่ชำระเงินแล้ว"
    assert receipts.next_receipt_no(conn) == "SU-R2569-0001"


def test_snapshot_frozen():
    conn = _conn()
    code = _order(conn)
    snapshot = _issue(conn, code)["snapshot"]
    product_id = conn.execute("SELECT product_id FROM store_order_items").fetchone()[0]
    db.update_product(conn, product_id, {"name": "Changed"})
    receipts.save_receipt_settings(conn, {"payeeName": "New Payee"})
    assert receipts.list_order_receipts(conn, code)[0]["snapshot"] == snapshot
    assert snapshot["lines"] == [{"no": 1, "name": "SU Tote Bag · Black", "quantity": 1,
                                  "unitPrice": 150, "amount": 150}]
    assert snapshot["total"] == 150
    assert datetime.fromisoformat(snapshot["issuedAt"]).utcoffset() == timedelta(0)


def test_staff_customer_fields_not_written_to_order():
    conn = _conn()
    code = _order(conn)
    before = conn.execute("SELECT customer_json FROM store_orders").fetchone()[0]
    receipt = receipts.issue_receipt(conn, code, issued_by="staff", customer={**CUSTOMER, "studentCode": "6931501178"})
    assert receipt["snapshot"]["customer"]["studentCode"] == "6931501178"
    after = conn.execute("SELECT customer_json FROM store_orders").fetchone()[0]
    assert before == after and "studentCode" not in json.loads(after)


def test_cancel_then_reissue_next_number():
    conn = _conn()
    code = _order(conn)
    first = _issue(conn, code)
    with pytest.raises(db.StoreError) as error:
        receipts.cancel_receipt(conn, first["id"], cancelled_by="admin", reason="  ")
    assert error.value.status == 400
    cancelled = receipts.cancel_receipt(conn, first["id"], cancelled_by="admin", reason="แก้ชื่อ")
    assert cancelled["cancelReason"] == "แก้ชื่อ" and cancelled["cancelledBy"] == "admin"
    assert cancelled["cancelledAt"]
    with pytest.raises(db.StoreError, match="ใบเสร็จนี้ถูกยกเลิกแล้ว"):
        receipts.cancel_receipt(conn, first["id"], cancelled_by="admin", reason="ซ้ำ")
    assert _issue(conn, code)["receiptNo"] == "SU-R2569-0002"
    assert [r["receiptNo"] for r in receipts.list_order_receipts(conn, code)] == ["SU-R2569-0002", "SU-R2569-0001"]


def test_warning_when_order_cancelled_after_receipt():
    conn = _conn()
    code = _order(conn)
    assert receipts.receipt_warning(conn, code) is None
    receipt = _issue(conn, code)
    assert receipts.receipt_warning(conn, code) is None
    db.update_order(conn, code, {"status": "cancelled"})
    assert receipts.receipt_warning(conn, code) == (
        "ออเดอร์นี้ไม่ได้อยู่ในสถานะชำระแล้ว แต่ใบเสร็จ SU-R2569-0001 ยังใช้งานอยู่"
    )
    assert _issue(conn, code) == receipt
    receipts.cancel_receipt(conn, receipt["id"], cancelled_by="admin", reason="ยกเลิก")
    assert receipts.receipt_warning(conn, code) is None


def test_baht_text_examples():
    for amount, words in [(158, "หนึ่งร้อยห้าสิบแปดบาทถ้วน"), (0, "ศูนย์บาทถ้วน"),
                          (21, "ยี่สิบเอ็ดบาทถ้วน"), (1000000, "หนึ่งล้านบาทถ้วน")]:
        assert receipts.baht_text(amount) == words


def test_settings_defaults_and_validation():
    conn = _conn()
    assert receipts.get_receipt_settings(conn) == receipts.DEFAULT_RECEIPT_SETTINGS
    bad_size = copy.deepcopy(receipts.DEFAULT_LAYOUT)
    bad_size["fields"]["date"]["size"] = 99
    for payload in [{"prefix": "SU R"}, {"signatureUrl": "https://outside.example/sign.png"}, {"layout": bad_size}]:
        with pytest.raises(db.StoreError) as error:
            receipts.save_receipt_settings(conn, payload)
        assert error.value.status == 400
    saved = receipts.save_receipt_settings(conn, {"payeeName": " ผู้รับเงิน ", "signatureUrl": "/product-images/sign.png"})
    assert saved["payeeName"] == "ผู้รับเงิน"
    assert receipts.get_receipt_settings(conn) == saved


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, 1001, 10**400, True, "20"])
def test_layout_rejects_invalid_numbers(value):
    layout = copy.deepcopy(receipts.DEFAULT_LAYOUT)
    layout["table"]["cols"]["name"]["width"] = value
    with pytest.raises(db.StoreError):
        receipts.save_receipt_settings(_conn(), {"layout": layout})


def test_prefix_change_only_affects_new_receipts():
    conn = _conn()
    first = _issue(conn, _order(conn))
    receipts.save_receipt_settings(conn, {"prefix": "NEW-"})
    assert receipts.next_receipt_no(conn) == "NEW-0002"
    assert _issue(conn, _order(conn))["receiptNo"] == "NEW-0002"
    assert receipts.list_order_receipts(conn, first["orderCode"])[0] == first


def test_concurrent_issue_same_order_is_idempotent(tmp_path):
    path = str(tmp_path / "store.db")
    setup = _conn(path)
    code = _order(setup)

    def issue(_: int) -> dict:
        with sqlite3.connect(path, timeout=30) as conn:
            conn.row_factory = sqlite3.Row
            return _issue(conn, code)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(issue, range(8)))
    assert all(receipt == results[0] for receipt in results)
    assert setup.execute("SELECT COUNT(*) FROM store_receipts").fetchone()[0] == 1
    assert receipts.next_receipt_no(setup) == "SU-R2569-0002"


def test_failed_insert_rolls_back_counter():
    conn = _conn()
    code = _order(conn)
    conn.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON store_receipts "
                 "BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END")
    with pytest.raises(sqlite3.IntegrityError, match="injected insert failure"):
        _issue(conn, code)
    assert receipts.next_receipt_no(conn) == "SU-R2569-0001"
    conn.execute("DROP TRIGGER fail_receipt")
    assert _issue(conn, code)["receiptNo"] == "SU-R2569-0001"


@pytest.mark.parametrize("status", ["ready", "completed"])
def test_other_issuable_statuses(status):
    conn = _conn()
    assert _issue(conn, _order(conn, status))["receiptNo"] == "SU-R2569-0001"
