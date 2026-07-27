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
    """รับของไปคนละวันไทยกับวันนี้ = เตือน staff ว่าอาจเคยได้บัตรไปพร้อมของแล้ว

    หรือรับของไปแล้ว (status == 'received') แต่ received_at พิสูจน์ไม่ได้ว่าเป็นวันนี้
    (admin กดสถานะ 'received' ตรงๆ ไม่ผ่าน claim station จึงไม่มี timestamp)
    """

    def _now(self):
        return datetime(2026, 7, 27, 9, 0, tzinfo=order_api.TZ_BANGKOK)

    def test_received_today_does_not_warn(self):
        # flow ปกติ: กดรับของแล้วกดรับบัตรต่อในนาทีเดียวกัน ต้องเงียบ
        now = datetime(2026, 7, 27, 14, 0, tzinfo=order_api.TZ_BANGKOK)
        assert order_api.khantok_claim_warning("2026-07-27T09:30:00+07:00", now=now) is False

    def test_received_yesterday_warns(self):
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", now=self._now()) is True

    def test_missing_value_does_not_warn(self):
        assert order_api.khantok_claim_warning(None, now=self._now()) is False
        assert order_api.khantok_claim_warning("", now=self._now()) is False

    def test_naive_utc_row_is_read_as_utc(self):
        # 2026-07-26T17:30Z == 2026-07-27T00:30 +07 -> วันไทยเดียวกับ now -> ไม่เตือน
        assert order_api.khantok_claim_warning("2026-07-26T17:30:00Z", now=self._now()) is False

    def test_naive_space_separated_value_with_no_offset_is_read_as_utc(self):
        # ไม่มีทั้ง offset และ 'Z' ต้องยังถูกอ่านเป็น UTC เหมือนกัน (ใช้ branch
        # tzinfo is None ของ _parse_stored_datetime ซึ่งก่อนหน้านี้ไม่มีเทสต์คุม)
        # UTC 17:30 26 ก.ค. == ไทย 00:30 27 ก.ค. -> วันเดียวกับ now -> ไม่เตือน
        assert order_api.khantok_claim_warning("2026-07-26 17:30:00", now=self._now()) is False

    def test_space_separated_value_is_accepted(self):
        assert order_api.khantok_claim_warning("2026-07-26 18:00:00+07:00", now=self._now()) is True

    def test_unparseable_value_does_not_warn(self):
        assert order_api.khantok_claim_warning("not a date", now=self._now()) is False

    def test_naive_now_is_assumed_bangkok(self):
        naive_now = datetime(2026, 7, 27, 9, 0)
        assert order_api.khantok_claim_warning("2026-07-26T18:00:00+07:00", now=naive_now) is True

    # --- status-aware rules (Finding 2) ---

    def test_received_status_with_null_timestamp_warns(self):
        assert order_api.khantok_claim_warning(None, status="received", now=self._now()) is True

    def test_received_status_with_empty_timestamp_warns(self):
        assert order_api.khantok_claim_warning("", status="received", now=self._now()) is True

    def test_received_status_with_unparseable_timestamp_warns(self):
        assert order_api.khantok_claim_warning("not a date", status="received", now=self._now()) is True

    def test_received_status_with_todays_timestamp_does_not_warn(self):
        assert order_api.khantok_claim_warning(
            "2026-07-27T09:30:00+07:00", status="received", now=self._now()
        ) is False

    def test_not_received_status_with_null_timestamp_does_not_warn(self):
        assert order_api.khantok_claim_warning(None, status="shipped", now=self._now()) is False


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


class TestAdminPaginationPlacement:
    def test_pagination_bar_sits_above_the_orders_table(self):
        html = order_api.ADMIN_HTML
        assert html.index('id="paginationBar"') < html.index('id="ordersBody"')

    def test_page_info_is_not_duplicated_in_the_notice_line(self):
        assert 'setOrdersNotice("Page "' not in order_api.ADMIN_HTML

    def test_pagination_bar_uses_the_new_label_format(self):
        # ต้องเป็นรูปแบบใหม่ที่ renderPagination ประกอบเอง ไม่ใช่ '(n orders)' แบบเดิม
        assert "'/' + totalPages + ' — ' + totalOrders + ' total orders'" in order_api.ADMIN_HTML
        assert "' (' + totalOrders + ' orders)'" not in order_api.ADMIN_HTML


class TestAdminSingleDarkTheme:
    """หน้า admin เหลือธีมเดียว — ร่องรอยของระบบสองธีมต้องไม่เหลือ"""

    def test_no_light_theme_machinery_remains(self):
        html = order_api.ADMIN_HTML
        for leftover in ("prefers-color-scheme", 'data-theme', "suStoreTheme",
                         "theme-btn", "themeToggleBtn", "initTheme"):
            assert leftover not in html, "ยังเหลือร่องรอยระบบสองธีม: " + leftover

    def test_root_declares_dark_color_scheme(self):
        # ถ้าไม่ประกาศ scrollbar/dropdown/date picker ของเบราว์เซอร์จะเป็นกล่องขาว
        assert "color-scheme: dark" in order_api.ADMIN_HTML
        assert "color-scheme: light dark" not in order_api.ADMIN_HTML

    def test_new_tokens_are_declared(self):
        html = order_api.ADMIN_HTML
        for token in ("--surface-2:", "--line-strong:", "--faint:", "--ok-bg:",
                      "--warn-bg:", "--danger-bg:", "--accent-bg:", "--purple-bg:",
                      "--neutral-bg:", "--r-sm:", "--r-md:", "--r-lg:", "--r-pill:",
                      "--shadow-1:", "--shadow-2:"):
            assert token in html, "ไม่พบ token: " + token

    def test_legacy_token_names_still_resolve(self):
        # โค้ดส่วนอื่นยังอ้างชื่อเดิมอยู่ ลบทิ้งแล้วสีจะหายเป็นช่วงๆ
        html = order_api.ADMIN_HTML
        for legacy in ("--surface2:", "--header-bg:", "--badge-default:", "--badge-warn:",
                       "--badge-ok:", "--badge-danger:", "--badge-purple:",
                       "--editing-row:", "--toggle-track:", "--bar-track:", "--img-bg:"):
            assert legacy in html, "ลบ token เดิมที่ยังมีคนใช้: " + legacy


class TestAdminComponentLayer:
    """คอมโพเนนต์ที่ Task 3-5 จะใช้ ต้องมี rule รองรับก่อน"""

    def test_new_component_rules_exist(self):
        html = order_api.ADMIN_HTML
        for rule in (".card {", ".card.tight {", ".chip {", ".pager {"):
            assert rule in html, "ไม่พบ rule: " + rule

    def test_active_chip_matches_the_class_js_actually_toggles(self):
        # JS สลับ active-phase ถ้า CSS รับแต่ .active ชิปที่เลือกจะไม่เปลี่ยนสี
        assert ".chip.active-phase" in order_api.ADMIN_HTML

    def test_badge_status_modifiers_exist(self):
        html = order_api.ADMIN_HTML
        for mod in (".badge.ok", ".badge.warn", ".badge.danger",
                    ".badge.accent", ".badge.purple", ".badge.neutral"):
            assert mod in html, "ไม่พบ badge modifier: " + mod

    def test_large_radius_is_used_for_cards(self):
        assert "border-radius: var(--r-lg)" in order_api.ADMIN_HTML

    def test_stat_cards_wide_enough_for_hero_numerals(self):
        # 44px/800 hero numerals (e.g. "3,158") need more room than the old
        # 130px grid floor gave near auto-fit's minimum — the number bled into
        # the next card. Floor was widened to 190px, and .stat > strong got
        # overflow-wrap as a second line of defence. Both must hold.
        html = order_api.ADMIN_HTML
        assert "minmax(190px, 1fr)" in html, "grid floor ไม่ได้ถูกขยายเป็น 190px"
        assert "minmax(130px, 1fr)" not in html, "grid floor เก่า (130px) ยังเหลืออยู่"
        idx = html.index(".stat > strong {")
        rule = html[idx:html.index("}", idx)]
        assert "overflow-wrap: anywhere" in rule, "ไม่มี overflow-wrap guard ใน .stat > strong"


class TestAdminSummaryZoneDeinlined:
    """โซนที่เห็นทันทีที่เปิดหน้าต้องใช้ class ไม่ใช่ inline"""

    def test_phase_chips_use_the_chip_class(self):
        assert 'class="chip active-phase phase-btn"' in order_api.ADMIN_HTML

    def test_phase_button_renderer_paints_chip_not_ghost(self):
        # #phaseBtnContainer มี chip seed อยู่ในมาร์กอัปนิ่ง แต่ renderPhase() เขียนทับ
        # innerHTML ใหม่ทุกครั้งที่โหลด phase config — ถ้าฟังก์ชันนี้ยังปั้นปุ่มด้วย
        # "ghost phase-btn" ผู้ใช้จะเห็นปุ่มเก่าทันทีที่หน้าโหลดเสร็จ ไม่ใช่แค่ตอน seed
        assert 'fhtml = \'<button class="chip' in order_api.ADMIN_HTML
        assert 'ghost phase-btn' not in order_api.ADMIN_HTML
        assert 'style="min-height:30px;font-size:12px;padding:4px 12px"' not in order_api.ADMIN_HTML

    def test_pagination_bar_has_no_inline_style(self):
        assert '<div id="paginationBar" class="pager"></div>' in order_api.ADMIN_HTML
        assert 'id="paginationBar" style=' not in order_api.ADMIN_HTML

    def test_bulk_bar_starts_hidden(self):
        # เดิมประกาศ display สองครั้งในสตริงเดียว ตัวหลังชนะ แถบเลยกางค้าง
        assert 'id="bulkBar" class="toolbar" hidden' in order_api.ADMIN_HTML
        assert 'display:none;padding:10px 0;display:flex' not in order_api.ADMIN_HTML

    def test_hidden_attribute_actually_hides(self):
        # .toolbar { display: flex } (author, normal) ชนะ [hidden]{display:none}
        # ของ UA stylesheet (user-agent, normal) เสมอ เพราะ origin ตัดสินก่อน specificity —
        # ถ้าไม่มี guard ของเราเอง #bulkBar จะกางค้างแม้ .hidden = true
        assert "[hidden] { display: none !important; }" in order_api.ADMIN_HTML

    def test_khantok_ring_track_uses_a_token(self):
        assert "#e8e8e8" not in order_api.ADMIN_HTML
        assert 'stroke="var(--surface-2)"' in order_api.ADMIN_HTML

    def test_clickable_stat_card_uses_a_class(self):
        assert 'class="stat compact clickable"' in order_api.ADMIN_HTML
        assert 'cursor:pointer;border-bottom:2px solid var(--accent)' not in order_api.ADMIN_HTML

    def test_add_phase_button_uses_a_chip_class_not_inline_style(self):
        # #addPhaseBtn ต้องแยกจากกลุ่ม chip ด้วย class ไม่ใช่ inline style เกาะเดี่ยว
        # ที่เหลืออยู่ตัวเดียวในโซนที่ de-inline ไปแล้ว
        assert 'id="addPhaseBtn" class="chip chip-add"' in order_api.ADMIN_HTML
        assert 'id="addPhaseBtn" class="ghost" style=' not in order_api.ADMIN_HTML


class TestAdminOrderRowsDeinlined:
    """แถวตารางต้องไม่มีสีสว่างฝังตรงและใช้ class แทน inline"""

    def test_no_hardcoded_light_colours_remain(self):
        html = order_api.ADMIN_HTML
        for hexcolour in ("#e5e7eb", "#fef9c3", "#ca8a04", "#e8e8e8"):
            assert hexcolour not in html, "ยังมีสีสว่างฝังตรง: " + hexcolour

    def test_item_separator_uses_a_class(self):
        assert '<hr class="item-sep">' in order_api.ADMIN_HTML
        assert 'border-top:1px solid #e5e7eb' not in order_api.ADMIN_HTML

    def test_edit_button_editing_state_uses_a_class(self):
        assert "editOrderBtn' + (isEditing ? ' editing' : '')" in order_api.ADMIN_HTML

    def test_row_action_buttons_use_a_class(self):
        assert 'class="row-actions"' in order_api.ADMIN_HTML
        assert 'font-size:12px;min-height:28px;flex:1' not in order_api.ADMIN_HTML

    def test_slip_and_ticket_markers_use_status_classes(self):
        html = order_api.ADMIN_HTML
        assert 'class="mark ok"' in html
        assert 'style="color:var(--ok)"' not in html
