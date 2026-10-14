"""Design catalog validation and preservation of ordered options."""
import pytest
from store import db

from .test_store_v2 import CUSTOMER, _conn, _product


def _designs() -> list[dict]:
    return [
        {"designCode": "scs", "designName": "วิทยาศาสตร์เครื่องสำอาง", "designNameEn": "Cosmetic Science", "image": "/product-images/scs.png", "price": 150, "size": "M", "color": "Black"},
        {"designCode": "AI", "designName": "ปัญญาประดิษฐ์", "price": 150},
    ]


def test_design_product_round_trip():
    conn = _conn()
    product = db.create_product(conn, {"name": "เสื้อ", "nameEn": "Shirt", "optionKind": "designs", "variants": _designs()})
    assert product["nameEn"] == "Shirt"
    assert product["optionKind"] == "designs"
    assert product["categoryId"] is None
    assert [v["designCode"] for v in product["variants"]] == ["SCS", "AI"]
    assert product["variants"][0]["label"] == "SCS · วิทยาศาสตร์เครื่องสำอาง"
    assert product["variants"][0]["designNameEn"] == "Cosmetic Science"
    assert product["variants"][0]["image"] == "/product-images/scs.png"
    assert all(v["size"] == v["color"] == "" for v in product["variants"])
    updated = db.update_product(conn, product["id"], {"nameEn": "New Shirt", "variants": [{**product["variants"][0], "designName": "ลายใหม่"}]})
    assert updated["nameEn"] == "New Shirt"
    assert updated["variants"][0]["label"] == "SCS · ลายใหม่"


def test_duplicate_design_code_rejected_case_insensitive():
    variants = _designs()
    variants[0]["designCode"], variants[1]["designCode"] = " scs ", "SCS"
    with pytest.raises(db.StoreError, match="ตัวย่อ SCS ซ้ำกัน") as error:
        db.create_product(_conn(), {"name": "เสื้อ", "optionKind": "designs", "variants": variants})
    assert error.value.status == 400


def test_design_requires_thai_name():
    with pytest.raises(db.StoreError) as error:
        db.create_product(_conn(), {"name": "เสื้อ", "optionKind": "designs", "variants": [{"designCode": "AI", "price": 150}]})
    assert error.value.status == 400


def test_designs_must_share_one_price():
    variants = _designs()
    variants[1]["price"] = 200
    with pytest.raises(db.StoreError, match="ทุกลายต้องราคาเดียวกัน") as error:
        db.create_product(_conn(), {"name": "เสื้อ", "optionKind": "designs", "variants": variants})
    assert error.value.status == 400


def test_switching_kind_deactivates_ordered_variants():
    conn = _conn()
    product = _product(conn)
    variant_id = product["variants"][0]["id"]
    order = db.create_order(conn, {"items": [{"variantId": variant_id, "quantity": 1}], "customer": CUSTOMER})
    updated = db.update_product(conn, product["id"], {"optionKind": "designs", "variants": _designs()})
    assert updated["optionKind"] == "designs"
    assert next(v for v in updated["variants"] if v["id"] == variant_id)["active"] is False
    assert all(v["active"] for v in updated["variants"] if v["id"] != variant_id)
    assert db.get_order(conn, order["orderCode"])["items"][0]["variantLabel"] == "Black"


def test_kind_change_without_variants_rejected():
    conn = _conn()
    product = _product(conn)
    with pytest.raises(db.StoreError, match="เปลี่ยนแบบตัวเลือกต้องส่งรายการตัวเลือกมาด้วย") as error:
        db.update_product(conn, product["id"], {"optionKind": "designs"})
    assert error.value.status == 400
    assert db.get_product(conn, product["id"], public=False) == product


def test_designs_to_options_keeps_order_label():
    conn = _conn()
    product = db.create_product(conn, {"name": "เสื้อ", "optionKind": "designs", "variants": _designs(), "status": "active"})
    design_id = product["variants"][0]["id"]
    order = db.create_order(conn, {"items": [{"variantId": design_id, "quantity": 1}], "customer": CUSTOMER})
    label = db.get_order(conn, order["orderCode"])["items"][0]["variantLabel"]
    updated = db.update_product(conn, product["id"], {"optionKind": "options", "variants": [{"size": "M", "color": "", "price": 150}]})
    assert updated["optionKind"] == "options"
    assert next(v for v in updated["variants"] if v["id"] == design_id)["active"] is False
    assert [v["size"] for v in updated["variants"] if v["active"]] == ["M"]
    assert db.get_order(conn, order["orderCode"])["items"][0]["variantLabel"] == label


def test_same_kind_without_variants_allowed():
    conn = _conn()
    product = _product(conn)
    updated = db.update_product(conn, product["id"], {"optionKind": "options", "nameEn": "Tote"})
    assert updated["nameEn"] == "Tote"


def test_options_product_unchanged():
    product = _product(_conn())
    assert product["optionKind"] == "options"
    assert product["nameEn"] == ""
    assert product["variants"][0]["label"] == "Black"
    assert product["variants"][0]["designCode"] == ""


def test_order_snapshots_both_languages() -> None:
    conn = _conn()
    product = db.create_product(conn, {
        "name": "พวงกุญแจ", "nameEn": "Keychain", "status": "active",
        "optionKind": "designs", "variants": _designs(),
    })
    order = db.create_order(conn, {
        "items": [{"variantId": v["id"], "quantity": 1} for v in product["variants"]],
        "customer": CUSTOMER,
    })
    item = order["items"][0]
    assert item["productNameEn"] == "Keychain"
    assert item["variantLabelEn"] == "SCS · Cosmetic Science"
    assert item["productName"] == "พวงกุญแจ"
    assert item["variantLabel"] == "SCS · วิทยาศาสตร์เครื่องสำอาง"
    assert order["items"][1]["variantLabelEn"] is None
    db.update_product(conn, product["id"], {
        "name": "ชื่อใหม่", "nameEn": "New Keychain",
        "variants": [{**v, "designName": "ลายใหม่", "designNameEn": "New Design"} for v in product["variants"]],
    })
    assert db.get_order(conn, order["orderCode"])["items"] == order["items"]


def test_old_order_item_has_null_english() -> None:
    conn = _conn()
    product = _product(conn)
    order = db.create_order(conn, {
        "items": [{"variantId": product["variants"][0]["id"], "quantity": 1}],
        "customer": CUSTOMER,
    })
    item = db.get_order(conn, order["orderCode"])["items"][0]
    assert item["productNameEn"] is None
    assert item["variantLabelEn"] is None


@pytest.mark.parametrize("code", ["", "A B", "ไทย", "A_", "A" * 13, 123])
def test_invalid_design_code(code):
    with pytest.raises(db.StoreError, match="ตัวย่อใช้ได้เฉพาะ A-Z, 0-9 และ -"):
        db.create_product(_conn(), {"name": "เสื้อ", "optionKind": "designs", "variants": [{"designCode": code, "designName": "ลาย", "price": 150}]})


@pytest.mark.parametrize("field,value", [("designName", "ก" * 81), ("designNameEn", "a" * 81), ("image", "https://example.com/a.png")])
def test_invalid_design_fields(field, value):
    variant = {**_designs()[0], field: value}
    with pytest.raises(db.StoreError):
        db.create_product(_conn(), {"name": "เสื้อ", "optionKind": "designs", "variants": [variant]})


@pytest.mark.parametrize("payload", [{"nameEn": "a" * 121}, {"optionKind": "other"}, {"optionKind": []}])
def test_invalid_product_fields(payload):
    with pytest.raises(db.StoreError):
        db.create_product(_conn(), {"name": "เสื้อ", **payload})
