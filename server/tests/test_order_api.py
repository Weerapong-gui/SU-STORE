"""Unit tests for order_api.py — pure logic functions only (no DB, no HTTP)."""
import sys
import os
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
