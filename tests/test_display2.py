import json
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

import order_api  # type: ignore


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE orders (
            internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_code TEXT,
            items_json TEXT NOT NULL DEFAULT '[]',
            product_slug TEXT NOT NULL DEFAULT '',
            product_name TEXT NOT NULL DEFAULT '',
            size TEXT NOT NULL DEFAULT '',
            quantity INTEGER NOT NULL DEFAULT 0,
            student_code TEXT NOT NULL DEFAULT '',
            nickname TEXT NOT NULL DEFAULT '',
            full_name TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE order_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_code TEXT,
            event TEXT,
            detail TEXT,
            created_at TEXT
        );
        CREATE TABLE display2_picks (
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
            undone_at TEXT
        );
        """
    )
    return conn


def _insert_order(conn, code, items, **extra):
    defaults = dict(
        order_code=code,
        items_json=json.dumps(items),
        product_slug=items[0]["slug"] if items else "",
        product_name=items[0].get("name", "") if items else "",
        size=items[0].get("size", "") if items else "",
        quantity=items[0].get("quantity", 1) if items else 0,
        student_code="6931501178",
        nickname="นัท",
        full_name="Park Test",
    )
    defaults.update(extra)
    cols = ",".join(defaults.keys())
    qs = ",".join("?" for _ in defaults)
    conn.execute(f"INSERT INTO orders ({cols}) VALUES ({qs})", tuple(defaults.values()))
    return conn.execute("SELECT * FROM orders WHERE order_code=?", (code,)).fetchone()


class StationMappingTest(unittest.TestCase):
    def test_known_slugs_map_to_stations(self):
        self.assertEqual(order_api.STATION_BY_SLUG["single"], "polo")
        self.assertEqual(order_api.STATION_BY_SLUG["jacket"], "jacket")
        self.assertEqual(order_api.STATION_BY_SLUG["headband"], "headband")

    def test_unknown_slug_returns_none(self):
        self.assertIsNone(order_api.STATION_BY_SLUG.get("unknown_product"))


class EnqueueDisplay2Test(unittest.TestCase):
    def test_multi_item_order_splits_into_three_rows(self):
        conn = _make_conn()
        items = [
            {"slug": "single", "name": "Polo", "size": "M", "quantity": 1},
            {"slug": "jacket", "name": "Jacket", "size": "L", "quantity": 1},
            {"slug": "headband", "name": "Headband", "size": "FREE", "quantity": 1},
        ]
        row = _insert_order(conn, "FP280001", items)

        inserted = order_api.enqueue_display2(conn, row, "park")

        self.assertEqual(inserted, 3)
        picks = conn.execute(
            "SELECT station, item_index, queued_by FROM display2_picks ORDER BY item_index"
        ).fetchall()
        self.assertEqual([p["station"] for p in picks], ["polo", "jacket", "headband"])
        self.assertEqual([p["item_index"] for p in picks], [0, 1, 2])
        self.assertTrue(all(p["queued_by"] == "park" for p in picks))

    def test_unknown_slug_is_skipped_and_audit_logged(self):
        conn = _make_conn()
        items = [
            {"slug": "single", "size": "M", "quantity": 1},
            {"slug": "mystery_box", "size": "X", "quantity": 1},
        ]
        row = _insert_order(conn, "FP280002", items)

        inserted = order_api.enqueue_display2(conn, row, "park")

        self.assertEqual(inserted, 1)
        events = {
            r["event"] for r in conn.execute(
                "SELECT event FROM order_audit_log WHERE order_code=?",
                ("FP280002",),
            )
        }
        self.assertIn("display2_enqueued", events)
        self.assertIn("display2_skipped", events)

    def test_empty_items_json_falls_back_to_order_columns(self):
        conn = _make_conn()
        row = _insert_order(
            conn,
            "FP280003",
            items=[],
            product_slug="single",
            product_name="Polo",
            size="L",
            quantity=2,
        )

        inserted = order_api.enqueue_display2(conn, row, "park2")

        self.assertEqual(inserted, 1)
        pick = conn.execute("SELECT * FROM display2_picks").fetchone()
        self.assertEqual(pick["station"], "polo")
        self.assertEqual(pick["size"], "L")
        self.assertEqual(pick["quantity"], 2)

    def test_idempotent_on_repeated_call(self):
        conn = _make_conn()
        items = [{"slug": "single", "size": "M", "quantity": 1}]
        row = _insert_order(conn, "FP280004", items)

        first = order_api.enqueue_display2(conn, row, "park")
        second = order_api.enqueue_display2(conn, row, "park")

        self.assertEqual(first, 1)
        self.assertEqual(second, 0)
        count = conn.execute("SELECT COUNT(*) AS c FROM display2_picks").fetchone()["c"]
        self.assertEqual(count, 1)


class ReceivedHookEnqueuesTest(unittest.TestCase):
    """Direct call confirming the helper produces the row the handler expects."""

    def test_received_triggers_enqueue(self):
        conn = _make_conn()
        items = [{"slug": "single", "size": "M", "quantity": 1}]
        row = _insert_order(conn, "FP280010", items)

        count = order_api.enqueue_display2(conn, row, "park2")

        self.assertEqual(count, 1)
        queued = conn.execute(
            "SELECT queued_by FROM display2_picks WHERE order_code=?",
            ("FP280010",),
        ).fetchone()
        self.assertEqual(queued["queued_by"], "park2")


if __name__ == "__main__":
    unittest.main()
