"""Additive catalog migrations preserve existing order snapshots."""
import sqlite3

from server.store import db

from .test_store_v2 import CUSTOMER, _conn, _product


def test_migration_adds_columns_and_keeps_old_rows() -> None:
    conn = _conn()
    product = _product(conn)
    db.create_order(conn, {"items": [{"variantId": product["variants"][0]["id"], "quantity": 1}], "customer": CUSTOMER})
    db.ensure_store_db(conn)
    row = conn.execute("SELECT product_name, variant_label, product_name_en, variant_label_en FROM store_order_items").fetchone()
    assert row["product_name"] == "SU Tote Bag"
    assert row["product_name_en"] is None
    assert row["variant_label_en"] is None
    cols = {r[1] for r in conn.execute("PRAGMA table_info(store_products)")}
    assert {"name_en", "category_id", "option_kind"} <= cols
    assert db.get_product(conn, product["id"], public=True)["optionKind"] == "options"
    assert db.get_product(conn, product["id"], public=False)["optionKind"] == "options"
    variant = conn.execute("SELECT design_name, design_name_en, design_code, image FROM store_variants").fetchone()
    assert tuple(variant) == ("", "", "", "")
    conn.execute("INSERT INTO store_categories (slug, name, created_at, updated_at) VALUES ('bags', 'กระเป๋า', 'now', 'now')")
    category = conn.execute("SELECT * FROM store_categories").fetchone()
    assert dict(category) == {
        "id": 1, "slug": "bags", "name": "กระเป๋า", "name_en": "", "tagline": "",
        "tagline_en": "", "cover_image": "", "visible": 1, "sort_order": 0,
        "created_at": "now", "updated_at": "now",
    }
    indexes = {r[1] for r in conn.execute("PRAGMA index_list(store_products)")}
    assert "idx_store_products_category" in indexes


def test_migration_on_legacy_schema() -> None:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
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
        """
    )
    conn.execute(
        "INSERT INTO store_order_items "
        "(id, order_id, variant_id, product_id, product_name, variant_label, unit_price, quantity) "
        "VALUES (1, 2, 3, 4, 'Original bag', 'M / Blue', 150, 2)"
    )
    original = dict(conn.execute("SELECT * FROM store_order_items").fetchone())
    db.ensure_store_db(conn)
    db.ensure_store_db(conn)
    migrated = dict(conn.execute("SELECT * FROM store_order_items").fetchone())
    assert migrated == {**original, "product_name_en": None, "variant_label_en": None}
    columns = {r[1]: r for r in conn.execute("PRAGMA table_info(store_order_items)")}
    for name in ("product_name_en", "variant_label_en"):
        assert columns[name][2] == "TEXT"
        assert columns[name][3] == 0
        assert columns[name][4] is None
