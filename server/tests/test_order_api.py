"""Unit tests for order_api.py — pure logic functions only (no DB, no HTTP)."""
import sys
import os
from datetime import datetime
import pytest

# Add server directory to path so we can import order_api
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Stub out OCR module so order_api imports cleanly even without Tesseract
from unittest.mock import MagicMock
sys.modules["ocr"] = MagicMock()

import order_api


class TestGetScheduleStatus:
    """Tests for get_schedule_status — schedule open/closed/warning logic."""

    def test_disabled_schedule_always_open(self):
        result = order_api.get_schedule_status(False, "warning")
        assert result["scheduleClosed"] is False
        assert result["scheduleWarning"] is False

    def test_disabled_schedule_passes_through_message(self):
        result = order_api.get_schedule_status(False, "custom message")
        assert result["scheduleWarningMessage"] == "custom message"

    def test_enabled_schedule_returns_required_keys(self):
        result = order_api.get_schedule_status(True, "msg")
        assert "scheduleClosed" in result
        assert "scheduleWarning" in result
        assert "scheduleWarningMessage" in result


class TestOrderStatuses:
    """Verify ORDER_STATUSES and PAYMENT_STATUS_BY_ORDER_STATUS are consistent."""

    def test_all_order_statuses_have_payment_mapping(self):
        for status in order_api.ORDER_STATUSES:
            assert status in order_api.PAYMENT_STATUS_BY_ORDER_STATUS, (
                f"Order status '{status}' has no payment status mapping"
            )

    def test_payment_statuses_are_valid_values(self):
        valid_payment_statuses = {
            "awaiting_payment", "waiting_confirm", "paid", "rejected",
            "refund_pending", "refunded",
        }
        for order_status, payment_status in order_api.PAYMENT_STATUS_BY_ORDER_STATUS.items():
            assert payment_status in valid_payment_statuses, (
                f"Order status '{order_status}' maps to unknown payment status '{payment_status}'"
            )


class TestProductCost:
    """Tests for PRODUCT_COST — used in profit calculations."""

    def test_all_product_slugs_have_cost(self):
        expected_slugs = {"single", "jacket", "headband"}
        assert set(order_api.PRODUCT_COST.keys()) == expected_slugs

    def test_costs_are_positive(self):
        for slug, cost in order_api.PRODUCT_COST.items():
            assert cost > 0, f"Cost for '{slug}' must be positive"


class TestNowIso:
    """Tests for now_iso helper."""

    def test_returns_iso_string(self):
        result = order_api.now_iso()
        assert isinstance(result, str)
        assert "T" in result  # ISO 8601 format

    def test_ends_with_utc_marker(self):
        result = order_api.now_iso()
        assert result.endswith("Z") or "+" in result


class TestKhantokPrefix:
    """Tests for khantok ticket eligibility prefix."""

    def test_prefix_is_string(self):
        assert isinstance(order_api.KHANTOK_STUDENT_CODE_PREFIX, str)
        assert len(order_api.KHANTOK_STUDENT_CODE_PREFIX) > 0

    def test_quotas_are_positive(self):
        assert order_api.KHANTOK_QUOTA_100 > 0
        assert order_api.KHANTOK_QUOTA_50 > 0


class TestOrdersSummaryCache:
    """create_orders_summary_cached must not rescan orders for every caller.

    The uncached summary scans the whole orders table and json.loads every row,
    so concurrent admin pages / stat streams recomputing it is what starved the
    server of CPU.
    """

    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        order_api._SUMMARY_CACHE.clear()
        monkeypatch.setattr(order_api, "_SUMMARY_CACHE_TTL", 60.0)
        yield
        order_api._SUMMARY_CACHE.clear()

    def test_second_call_within_ttl_does_not_recompute(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            order_api,
            "create_orders_summary",
            lambda conn, round_filter=0: calls.append(round_filter) or {"total": 1},
        )
        assert order_api.create_orders_summary_cached(None) == {"total": 1}
        assert order_api.create_orders_summary_cached(None) == {"total": 1}
        assert len(calls) == 1

    def test_different_round_filters_cached_separately(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            order_api,
            "create_orders_summary",
            lambda conn, round_filter=0: calls.append(round_filter) or {"total": round_filter},
        )
        order_api.create_orders_summary_cached(None, 1)
        order_api.create_orders_summary_cached(None, 2)
        order_api.create_orders_summary_cached(None, 1)
        assert calls == [1, 2]

    def test_caller_cannot_mutate_cached_value(self, monkeypatch):
        monkeypatch.setattr(
            order_api, "create_orders_summary", lambda conn, round_filter=0: {"total": 1}
        )
        first = order_api.create_orders_summary_cached(None)
        first["total"] = 999
        assert order_api.create_orders_summary_cached(None)["total"] == 1

    def test_zero_ttl_disables_cache(self, monkeypatch):
        monkeypatch.setattr(order_api, "_SUMMARY_CACHE_TTL", 0.0)
        calls = []
        monkeypatch.setattr(
            order_api,
            "create_orders_summary",
            lambda conn, round_filter=0: calls.append(1) or {"total": 1},
        )
        order_api.create_orders_summary_cached(None)
        order_api.create_orders_summary_cached(None)
        assert len(calls) == 2


class TestStatsSnapshot:
    """get_stats_snapshot is shared by every open /admin/stats-stream connection."""

    @pytest.fixture(autouse=True)
    def _reset(self, monkeypatch):
        order_api._STATS_SNAPSHOT = None
        monkeypatch.setattr(order_api, "_STATS_SNAPSHOT_TTL", 60.0)
        yield
        order_api._STATS_SNAPSHOT = None

    def test_snapshot_computed_once_within_ttl(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            order_api,
            "_compute_stats_snapshot",
            lambda: calls.append(1) or {"summary": {}, "analytics": {}},
        )
        order_api.get_stats_snapshot()
        order_api.get_stats_snapshot()
        order_api.get_stats_snapshot()
        assert len(calls) == 1

    def test_snapshot_recomputed_after_ttl(self, monkeypatch):
        calls = []
        monkeypatch.setattr(order_api, "_STATS_SNAPSHOT_TTL", -1.0)
        monkeypatch.setattr(
            order_api,
            "_compute_stats_snapshot",
            lambda: calls.append(1) or {"summary": {}, "analytics": {}},
        )
        order_api.get_stats_snapshot()
        order_api.get_stats_snapshot()
        assert len(calls) == 2


class TestStatsStreamLimit:
    """Concurrent stat streams are capped so leaked threads cannot pile up again."""

    @pytest.fixture(autouse=True)
    def _reset(self):
        order_api._stats_stream_count = 0
        yield
        order_api._stats_stream_count = 0

    def test_acquire_up_to_max_then_refuses(self, monkeypatch):
        monkeypatch.setattr(order_api, "_STATS_STREAM_MAX", 2)
        assert order_api._stats_stream_acquire() is True
        assert order_api._stats_stream_acquire() is True
        assert order_api._stats_stream_acquire() is False

    def test_release_frees_a_slot(self, monkeypatch):
        monkeypatch.setattr(order_api, "_STATS_STREAM_MAX", 1)
        assert order_api._stats_stream_acquire() is True
        assert order_api._stats_stream_acquire() is False
        order_api._stats_stream_release()
        assert order_api._stats_stream_acquire() is True

    def test_release_never_goes_negative(self):
        order_api._stats_stream_release()
        order_api._stats_stream_release()
        assert order_api._stats_stream_count == 0


class TestKhantokClaimWarning:
    """รับของไปคนละวันไทยกับวันนี้ = เตือน staff ว่าอาจเคยได้บัตรไปพร้อมของแล้ว"""

    def _now(self):
        return datetime(2026, 7, 27, 9, 0, tzinfo=order_api.TZ_BANGKOK)

    def test_received_today_does_not_warn(self):
        # flow ปกติ: กดรับของแล้วกดรับบัตรต่อในนาทีเดียวกัน ต้องเงียบ
        now = datetime(2026, 7, 27, 14, 0, tzinfo=order_api.TZ_BANGKOK)
        assert order_api.khantok_claim_warning("2026-07-27T09:30:00+07:00", now) is False

    def test_received_yesterday_warns(self):
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", self._now()) is True

    def test_missing_value_does_not_warn(self):
        assert order_api.khantok_claim_warning(None, self._now()) is False
        assert order_api.khantok_claim_warning("", self._now()) is False

    def test_naive_utc_row_is_read_as_utc(self):
        # 2026-07-26T17:30Z == 2026-07-27T00:30 +07 -> วันไทยเดียวกับ now -> ไม่เตือน
        assert order_api.khantok_claim_warning("2026-07-26T17:30:00Z", self._now()) is False

    def test_space_separated_value_is_accepted(self):
        assert order_api.khantok_claim_warning("2026-07-26 18:00:00+07:00", self._now()) is True

    def test_unparseable_value_does_not_warn(self):
        assert order_api.khantok_claim_warning("not a date", self._now()) is False

    def test_naive_now_is_assumed_bangkok(self):
        naive_now = datetime(2026, 7, 27, 9, 0)
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", naive_now) is True


class TestClaimStationTemplate:
    def test_phase_four_gate_is_removed(self):
        # ด่านเดิมคือ Number(order.roundNumber) === 4 ต้องไม่เหลืออยู่
        assert "roundNumber) === 4" not in order_api.CLAIM_STATION_HTML

    def test_claim_button_passes_the_warning_flag(self):
        assert "khantokClaimWarning" in order_api.CLAIM_STATION_HTML
        assert "doClaimKhantok(code, needConfirm)" in order_api.CLAIM_STATION_HTML

    def test_warning_panel_uses_the_existing_warn_palette(self):
        # ต้องเลือกสีตาม warning state จริง ไม่ใช่แค่มีคำว่า var(--warn-bg) ลอยอยู่ที่ไหนก็ได้ในไฟล์
        # (ตัวแปรนี้มีอยู่แล้วใน CSS :root ก่อนหน้า task นี้ด้วย จึงต้องล็อกไปที่ ternary ที่เลือกสีจริง)
        assert "accent = warn ? 'var(--warn)' : 'var(--ok)'" in order_api.CLAIM_STATION_HTML
        assert "accentBg = warn ? 'var(--warn-bg)' : 'var(--ok-bg)'" in order_api.CLAIM_STATION_HTML

    def test_timestamp_helper_reads_utc_getters(self):
        # กันการกลับไปใช้ .getHours() ซึ่งบวก offset ซ้ำบนเครื่องที่ตั้งเวลาไทย
        assert "function _fmtBkkShort(" in order_api.CLAIM_STATION_HTML
        assert "getUTCHours()" in order_api.CLAIM_STATION_HTML


class TestAdminKhantokStationCards:
    def test_both_cards_are_rendered(self):
        assert 'id="statKhantokClaimed"' in order_api.ADMIN_HTML
        assert 'id="statKhantokOnly"' in order_api.ADMIN_HTML

    def test_both_cards_are_wired_for_live_updates(self):
        # setOdom ถูกนิยามเฉพาะใน updateOrderStats() การเจอคู่นี้จึงพิสูจน์ว่า
        # การ์ดอัปเดตตอน stats-stream ส่งค่าใหม่ ไม่ใช่แค่ตอน render ครั้งแรก
        assert "setOdom('statKhantokClaimed'" in order_api.ADMIN_HTML
        assert "setOdom('statKhantokOnly'" in order_api.ADMIN_HTML
