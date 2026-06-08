#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import csv
import hmac
import html
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta, date
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import time
from urllib.parse import urlparse

HOST = os.environ.get("ORDER_API_HOST", "0.0.0.0")
PORT = int(os.environ.get("ORDER_API_PORT", os.environ.get("PORT", "3010")))
DB_PATH = Path(os.environ.get("ORDER_API_DB_PATH", str(Path.home() / "su-order-api" / "data" / "orders.db")))
SLIPS_DIR = Path(os.environ.get("ORDER_API_SLIPS_DIR", str(DB_PATH.parent / "slips")))
PRODUCT_IMAGES_DIR = Path(os.environ.get("PRODUCT_IMAGES_DIR", str(DB_PATH.parent / "product-images")))
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PRODUCT_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
ORDER_PREFIX = os.environ.get("ORDER_PREFIX", "FP28")
ORDER_ROUND = int(os.environ.get("ORDER_ROUND", "1"))
ORDER_API_TOKEN = os.environ.get("ORDER_API_TOKEN", "")
BYPASS_TOKEN = os.environ.get("BYPASS_TOKEN", "")
PICKUP_USERNAME = os.environ.get("PICKUP_USERNAME", "staff")
PICKUP_PASSWORD = os.environ.get("PICKUP_PASSWORD", "")
# Deterministic session token derived from credentials (survives restarts)
SUPER_TOKEN = hmac.new(
    key=(PICKUP_USERNAME + ":" + PICKUP_PASSWORD).encode("utf-8"),
    msg=b"superadmin-v1",
    digestmod="sha256",
).hexdigest() if PICKUP_PASSWORD else ""

CLAIM_STATION_TOKEN = hmac.new(
    key=(PICKUP_USERNAME + ":" + PICKUP_PASSWORD).encode("utf-8"),
    msg=b"claim-station-v1",
    digestmod="sha256",
).hexdigest() if PICKUP_PASSWORD else ""
GOOGLE_SHEETS_WEBHOOK_URL = os.environ.get("GOOGLE_SHEETS_WEBHOOK_URL", "").strip()
GOOGLE_SHEETS_WEBHOOK_TOKEN = os.environ.get("GOOGLE_SHEETS_WEBHOOK_TOKEN", "").strip()
KHANTOK_QUOTA_100 = int(os.environ.get("KHANTOK_QUOTA_100", "2000"))
KHANTOK_QUOTA_50 = int(os.environ.get("KHANTOK_QUOTA_50", "1000"))
KHANTOK_STUDENT_CODE_PREFIX = "693"
ORDER_ID_PATTERN = re.compile(r"^[A-Z0-9-]+$")
ALLOWED_SLIP_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024
ORDER_STATUSES = {
    "pending_payment",
    "waiting_confirm",
    "paid",
    "preparing",
    "shipped",
    "received",
    "cancelled",
    "rejected",
}
PAYMENT_STATUS_BY_ORDER_STATUS = {
    "pending_payment": "awaiting_payment",
    "waiting_confirm": "waiting_confirm",
    "paid": "paid",
    "preparing": "paid",
    "shipped": "paid",
    "received": "paid",
    "cancelled": "rejected",
    "rejected": "rejected",
}

# In-memory visitor tracking (IP → last-seen timestamp)
_visitor_registry: dict[str, float] = {}
_VISITOR_ACTIVE_SECONDS = 120  # 2 minutes

# In-memory test-warning expiry (timestamp)
_test_warning_until: float = 0

_global_lock = threading.Lock()


def get_schedule_status(schedule_enabled: bool, warning_message: str) -> dict[str, Any]:
    """Compute schedule open/closed/warning state from current Bangkok time."""
    if not schedule_enabled:
        return {"scheduleClosed": False, "scheduleWarning": False, "scheduleWarningMessage": warning_message}
    now = datetime.now(TZ_BANGKOK)
    total_min = now.hour * 60 + now.minute
    open_min = 6 * 60       # 06:00
    close_min = 23 * 60     # 23:00 (end of 22:59)
    warn_min = close_min - 10  # 22:50
    schedule_closed = total_min < open_min or total_min >= close_min
    schedule_warning = not schedule_closed and total_min >= warn_min
    return {
        "scheduleClosed": schedule_closed,
        "scheduleWarning": schedule_warning,
        "scheduleWarningMessage": warning_message,
    }

DEFAULT_PRODUCTS = [
    {
        "slug": "single-shirt",
        "name": "FRESHER POLO SHIRT",
        "short_name": "เสื้อเดี่ยว",
        "tagline": "Classic fresher polo for everyday campus wear.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 399,
        "category": "single",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/POLP_post/Artboard 4.png",
        "sort_order": 1,
    },
    {
        "slug": "fresh-jacket",
        "name": "FRESHER JACKET",
        "short_name": "แจ็คเก็ต",
        "tagline": "Layer up with a clean campus-ready jacket.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 899,
        "category": "jacket",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/Pr1.png",
        "sort_order": 3,
    },
    {
        "slug": "fresh-headband",
        "name": "FRESHER HEADBAND",
        "short_name": "ผ้าคาดสำนักวิชา",
        "tagline": "A lightweight accessory for sports day and activity looks.",
        "description": "FRESHER PACKAGE 28TH",
        "price": 35,
        "category": "headband",
        "requires_size": 0,
        "requires_school": 1,
        "image_path": "/images/Pr1.png",
        "sort_order": 4,
    },
]


ADMIN_HTML = r"""<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SU STORE Admin</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f4f5; --surface: #fff; --surface2: #f9f9fa; --header-bg: rgba(255,255,255,.9);
      --line: #d8d8dd; --text: #111114;
      --muted: #666a73; --accent: #0071e3; --danger: #b42318; --ok: #027a48; --warn: #b45309;
      --badge-default: #eef2ff; --badge-warn: #fff7ed; --badge-ok: #ecfdf3; --badge-danger: #fef3f2; --badge-purple: #f5f3ff; --purple: #7c3aed;
      --editing-row: #fef9c3; --toggle-track: #d0d0d5; --bar-track: #eef2ff; --img-bg: #f0f0f0;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #111113; --surface: #1c1c1e; --surface2: #2c2c2e; --header-bg: rgba(28,28,30,.9);
        --line: #38383a; --text: #f5f5f7;
        --muted: #8e8e93; --accent: #0a84ff; --danger: #ff453a; --ok: #30d158; --warn: #ff9f0a;
        --badge-default: #1e2640; --badge-warn: #2d1f00; --badge-ok: #0d2b1a; --badge-danger: #2d0c08; --badge-purple: #1e1040; --purple: #a78bfa;
        --editing-row: #2d2a00; --toggle-track: #48484a; --bar-track: #2c2c2e; --img-bg: #2c2c2e;
      }
    }
    :root[data-theme="dark"] {
      --bg: #111113; --surface: #1c1c1e; --surface2: #2c2c2e; --header-bg: rgba(28,28,30,.9);
      --line: #38383a; --text: #f5f5f7;
      --muted: #8e8e93; --accent: #0a84ff; --danger: #ff453a; --ok: #30d158; --warn: #ff9f0a;
      --badge-default: #1e2640; --badge-warn: #2d1f00; --badge-ok: #0d2b1a; --badge-danger: #2d0c08;
      --editing-row: #2d2a00; --toggle-track: #48484a; --bar-track: #2c2c2e; --img-bg: #2c2c2e;
      color-scheme: dark;
    }
    :root[data-theme="light"] { color-scheme: light; }
    .theme-btn { display:inline-flex; align-items:center; gap:7px; background:none; border:none; cursor:pointer; padding:0; min-height:unset; font-size:13px; color:var(--muted); font-weight:600; }
    .theme-btn-track { position:relative; width:44px; height:26px; background:var(--toggle-track); border-radius:999px; transition:background .25s; flex-shrink:0; }
    .theme-btn-thumb { position:absolute; top:3px; left:3px; width:20px; height:20px; background:#fff; border-radius:50%; transition:transform .25s; box-shadow:0 1px 4px rgba(0,0,0,.3); }
    [data-theme="dark"] .theme-btn-track, :root:not([data-theme="light"]) .theme-btn-track.sys-dark { background:#636366; }
    [data-theme="dark"] .theme-btn-thumb, :root:not([data-theme="light"]) .theme-btn-thumb.sys-dark { transform:translateX(18px); }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 14px clamp(16px,4vw,44px); border-bottom: 1px solid var(--line);
      background: var(--header-bg); backdrop-filter: blur(18px);
    }
    header h1 { font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
    .hdr-right { display: flex; gap: 8px; align-items: center; }
    .srv-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--muted); vertical-align:middle; margin-right:3px; transition:background .4s; }
    .srv-dot.ok   { background:#16a34a; }
    .srv-dot.warn { background:#d97706; }
    .srv-dot.err  { background:var(--danger); }
    nav.tab-bar {
      display: flex; overflow-x: auto;
      border-bottom: 1px solid var(--line); background: var(--surface);
      padding: 0 clamp(16px,4vw,44px);
    }
    .tab-btn {
      flex-shrink: 0; padding: 12px 18px; border: none; background: none;
      cursor: pointer; font: inherit; font-size: 14px; font-weight: 600;
      color: var(--muted); border-bottom: 2px solid transparent;
      transition: color .15s, border-color .15s;
    }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    /* Superadmin / Users tab */
    .sa-modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;align-items:center;justify-content:center}
    .sa-modal-backdrop.open{display:flex}
    .sa-modal{background:var(--surface);border-radius:14px;padding:28px 24px;width:min(380px,calc(100vw-32px));box-shadow:0 8px 40px rgba(0,0,0,.2)}
    .sa-modal h3{font-size:16px;font-weight:700;margin-bottom:18px;display:flex;align-items:center;gap:8px}
    .sa-field label{display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
    .sa-field{margin-bottom:14px}
    .users-tbl{width:100%;border-collapse:collapse}
    .users-tbl th{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}
    .users-tbl td{padding:9px 12px;font-size:13px;border-bottom:1px solid var(--line)}
    .users-tbl tr:last-child td{border-bottom:none}
    .badge-super{background:#fef9c3;color:#92400e;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px;letter-spacing:.04em}
    main { width: min(1280px, calc(100% - 32px)); margin: 24px auto 56px; }
    input, select, textarea, button {
      border: 1px solid var(--line); border-radius: 8px;
      background: var(--surface); color: var(--text); font: inherit; min-height: 40px;
    }
    input, select { padding: 0 12px; width: 100%; }
    textarea { padding: 8px 12px; width: 100%; resize: vertical; }
    button { cursor: pointer; padding: 0 16px; font-weight: 600; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    button.danger-btn { border-color: var(--danger); background: var(--danger); color: #fff; }
    button.ok-btn { border-color: var(--ok); background: var(--ok); color: #fff; }
    button.ghost { background: var(--surface); }
    button.active-phase { background: var(--accent); color: #fff; border-color: var(--accent); }
    button:disabled { cursor: not-allowed; opacity: .5; }
    .stats {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 1px; background: var(--line); border: 1px solid var(--line);
      border-radius: 8px; overflow: hidden; margin-bottom: 16px;
    }
    .stat { background: var(--surface); padding: 14px 16px; }
    .stat > span { display: block; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 6px; font-size: 24px; letter-spacing: -.04em; word-break: break-all; }
    .stat.compact strong { font-size: 14px; letter-spacing: 0; }
    .stat.stat-ring { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
    .stat.stat-ring span { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    .stat.stat-ring strong { font-size: 13px; margin-top: 3px; letter-spacing: 0; font-weight: 600; white-space: nowrap; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; align-items: center; }
    .toolbar input, .toolbar select { max-width: 220px; }
    .table-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; word-break: break-word; }
    th { background: var(--surface2); color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--muted); font-size: 12px; }
    .money { color: var(--accent); font-weight: 700; }
    .badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; background: var(--badge-default); font-size: 12px; font-weight: 700; white-space: nowrap; }
    .badge.waiting_confirm { background: var(--badge-warn); color: var(--warn); }
    .badge.paid, .badge.preparing, .badge.shipped { background: var(--badge-ok); color: var(--ok); }
    .badge.received { background: var(--badge-purple); color: var(--purple); }
    .badge.rejected, .badge.cancelled { background: var(--badge-danger); color: var(--danger); }
    .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 16px; }
    .product-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; transition: box-shadow .2s; }
    .product-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .product-card.unavailable { opacity: .5; filter: grayscale(.7); }
    .product-img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: var(--img-bg); display: block; }
    .product-body { padding: 14px; }
    .product-name { font-size: 15px; font-weight: 700; }
    .product-meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .product-price { font-size: 16px; font-weight: 700; color: var(--accent); margin-top: 6px; }
    .product-actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
    .toggle { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-track { position: absolute; inset: 0; background: var(--toggle-track); border-radius: 999px; transition: background .2s; }
    .toggle input:checked + .toggle-track { background: var(--ok); }
    .toggle-thumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 4px rgba(0,0,0,.2); pointer-events: none; }
    .toggle input:checked ~ .toggle-thumb { transform: translateX(20px); }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; overflow-y: auto; padding: 32px 16px; }
    .modal-backdrop.open { display: flex; align-items: flex-start; justify-content: center; }
    .modal { background: var(--surface); border-radius: 16px; width: min(520px,100%); padding: 28px; }
    .modal h2 { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 5px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .notice { padding: 6px 0; color: var(--muted); font-size: 13px; min-height: 22px; }
    .notice.err { color: var(--danger); }
    .analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .analytics-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
    .analytics-card h3 { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .bar-label { font-size: 13px; width: 150px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 8px; background: var(--bar-track); border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.7s cubic-bezier(.22,1,.36,1); }
    .bar-count { font-size: 12px; color: var(--muted); width: 32px; text-align: right; }
    .settings-card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .settings-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 14px; }
    tr.editing-row td { background: var(--editing-row) !important; }
    tr.needs-action td { background: rgba(180,83,9,.05) !important; }
    tr.needs-action td:first-child { box-shadow: inset 3px 0 0 var(--warn); }
    select.statusSelect { font-size:12px; padding:4px 8px; border-radius:8px; border:1px solid var(--line); background:var(--surface2); color:var(--text); cursor:pointer; min-height:32px; width:100%; margin-bottom:6px; }
    @media (max-width: 720px) {
      .analytics-grid { grid-template-columns: 1fr; }
      .toolbar input, .toolbar select { max-width: 100%; }
    }
    @keyframes odom-up { from { transform: translateY(60%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes odom-dn { from { transform: translateY(-60%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  </style>
</head>
<body>
  <header>
    <h1>SU STORE Admin <span id="adminClock" style="font-size:14px;font-weight:600;color:var(--muted);margin-left:10px;font-variant-numeric:tabular-nums;letter-spacing:0.03em"></span><span id="srvStatus" style="display:inline-flex;align-items:center;gap:12px;margin-left:18px;font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.02em"><span title="sumfu.store — frontend"><span class="srv-dot" id="dotStore"></span>Store <span id="msStore" style="font-variant-numeric:tabular-nums">…</span></span><span title="order-api — backend"><span class="srv-dot" id="dotApi"></span>API <span id="msApi" style="font-variant-numeric:tabular-nums">…</span></span></span></h1>
    <div class="hdr-right">
      <button class="theme-btn" id="themeToggleBtn" title="สลับโหมด">
        <span id="themeIcon" style="display:inline-flex;align-items:center;color:var(--muted)"></span>
        <span class="theme-btn-track"><span class="theme-btn-thumb" id="themeThumb"></span></span>
      </button>
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="API Token" style="max-width:200px" />
      <button class="primary" id="saveTokenBtn">บันทึก</button>
      <button class="ghost" id="clearTokenBtn">Clear</button>
      <button class="ghost" id="superAdminBtn" title="Superadmin Login" style="padding:0 10px;min-height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></button>
    </div>
  </header>

  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="orders">Orders</button>
    <button class="tab-btn" data-tab="products">Products</button>
    <button class="tab-btn" data-tab="analytics">Analytics</button>
    <button class="tab-btn" data-tab="settings">Settings</button>
    <button class="tab-btn" data-tab="audit">Audit Log</button>
    <button class="tab-btn" data-tab="backup">Backup</button>
    <button class="tab-btn" data-tab="users" id="usersTabBtn" style="display:none;color:#92400e;align-items:center;gap:6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Users</button>
    <span style="margin-left:auto;display:flex;align-items:center;gap:5px;padding:0 8px;font-size:12px;color:var(--muted);flex-shrink:0">
      <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block;flex-shrink:0"></span>
      <span id="webVisitorCount">--</span> online
    </span>
  </nav>

  <!-- ORDERS TAB -->
  <div class="tab-pane active" id="tab-orders">
    <main>
      <div id="orderStats"></div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-right:4px">Phase</span>
        <div id="phaseBtnContainer" style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="ghost phase-btn active-phase" data-round="0" style="min-height:30px;font-size:12px;padding:4px 12px">All</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="searchInput" type="search" placeholder="Search order, name, school..." />
        <input id="studentCodeInput" type="search" placeholder="Student ID" style="max-width:160px" />
        <select id="statusFilter">
          <option value="">All status</option>
          <option value="pending_payment">pending_payment</option>
          <option value="waiting_confirm">waiting_confirm</option>
          <option value="paid">paid</option>
          <option value="preparing">preparing</option>
          <option value="shipped">Ready to Receive</option>
          <option value="received">รับแล้ว (Received)</option>
          <option value="cancelled">cancelled</option>
          <option value="rejected">rejected</option>
        </select>
        <button class="ghost" id="exportCsvBtn">Export CSV</button>
        <button class="primary" id="refreshOrdersBtn">Refresh</button>
      </div>
      <div id="bulkBar" style="display:none;padding:10px 0;display:flex;gap:10px;align-items:center">
        <span id="bulkCount" style="font-size:13px;color:var(--muted)"></span>
        <select id="bulkStatusSelect">
          <option value="">-- Change status to --</option>
          <option value="pending_payment">pending_payment</option>
          <option value="waiting_confirm">waiting_confirm</option>
          <option value="paid">paid</option>
          <option value="preparing">preparing</option>
          <option value="shipped">Ready to Receive</option>
          <option value="received">รับแล้ว (Received)</option>
          <option value="cancelled">cancelled</option>
          <option value="rejected">rejected</option>
        </select>
        <button class="primary" id="bulkApplyBtn">Apply</button>
        <button class="ghost" id="bulkClearBtn">Clear</button>
      </div>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th style="width:3%"><input type="checkbox" id="selectAllOrders" /></th>
              <th style="width:10%">Order</th>
              <th style="width:15%">Customer</th>
              <th style="width:17%">Product</th>
              <th style="width:10%">Payment</th>
              <th style="width:10%">Status</th>
              <th style="width:10%">Note</th>
              <th style="width:25%">Actions</th>
            </tr>
          </thead>
          <tbody id="ordersBody"></tbody>
        </table>
      </div>
      <div id="paginationBar" style="display:flex;gap:12px;align-items:center;padding:12px 0;justify-content:center"></div>
      <p class="notice" id="ordersNotice"></p>
    </main>
  </div>

  <!-- PRODUCTS TAB -->
  <div class="tab-pane" id="tab-products">
    <main>
      <div class="toolbar">
        <button class="primary" id="refreshProductsBtn">Refresh</button>
        <span id="productsNotice" style="color:var(--muted);font-size:13px"></span>
      </div>
      <div class="products-grid" id="productsGrid"></div>
    </main>
  </div>

  <!-- ANALYTICS TAB -->
  <div class="tab-pane" id="tab-analytics">
    <main>
      <div class="toolbar">
        <button class="primary" id="refreshAnalyticsBtn">Refresh</button>
        <span id="analyticsNotice" style="color:var(--muted);font-size:13px"></span>
      </div>
      <div class="analytics-grid" id="analyticsGrid"></div>
    </main>
  </div>

  <!-- SETTINGS TAB -->
  <div class="tab-pane" id="tab-settings">
    <main>
      <div class="settings-card">
        <h3>Announcement</h3>
        <div class="field">
          <label>Banner Text</label>
          <input id="bannerText" type="text" placeholder="ข้อความประกาศ..." />
        </div>
        <div class="field" style="display:flex;gap:12px;align-items:center">
          <label style="margin:0;text-transform:none;font-size:14px;font-weight:600">Enabled</label>
          <label class="toggle">
            <input type="checkbox" id="bannerEnabled" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <h3>Daily Schedule</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">เปิดเว็บอัตโนมัติ <strong>06:00 – 22:59</strong> (เวลาไทย) ทุกวัน — นอกช่วงเวลาจะแสดงหน้า "Stay Tuned" จนกว่าจะถึงรอบเปิดถัดไป</p>
        <div class="field" style="display:flex;gap:12px;align-items:center;margin-bottom:4px">
          <label style="margin:0;font-size:14px;font-weight:600">Enable Schedule</label>
          <label class="toggle">
            <input type="checkbox" id="scheduleEnabled" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
          <span id="scheduleStatusLabel" style="font-size:13px;color:var(--muted)"></span>
        </div>
        <div class="field" style="margin-top:14px">
          <label>Warning Message (แสดง 10 นาทีก่อนปิด 22:59)</label>
          <input id="scheduleWarningMsg" type="text" placeholder="เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59" style="max-width:520px" />
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <button id="saveScheduleBtn" class="primary">Save Schedule</button>
          <button id="testWarningBtn" class="secondary">Test Warning (60s)</button>
          <button id="stopWarningBtn" class="secondary" style="display:none">Stop Test Warning</button>
          <span id="scheduleNotice" style="color:var(--muted);font-size:13px"></span>
        </div>
      </div>

      <div class="settings-card" id="closeWebsiteCard">
        <h3>Close Website</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">เมื่อปิดเว็บ ผู้เข้าชมทั้งหมดจะเห็นแค่หน้า "We'll be back" และไม่สามารถเข้าหน้าอื่นได้</p>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <button id="closeSiteBtn" class="primary" style="background:var(--danger);min-width:160px">Close Website</button>
          <button id="openSiteBtn" class="secondary" style="min-width:160px;display:none">Open Website</button>
          <span id="siteClosedStatus" style="font-size:13px;font-weight:600;color:var(--danger);display:none">⚠ Website is currently closed</span>
          <span id="activeVisitors" style="color:var(--muted);font-size:13px;margin-left:auto"></span>
        </div>
      </div>

      <!-- Confirm close dialog -->
      <div id="confirmCloseDialog" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:none;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:20px;padding:28px 32px;max-width:400px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,0.22)">
          <h3 style="margin:0 0 10px;font-size:18px">ยืนยันการปิดเว็บไซต์?</h3>
          <p style="color:var(--muted);font-size:14px;margin:0 0 22px">ผู้เข้าชมทั้งหมดจะถูก redirect ไปหน้า "We'll be back" ทันที คุณแน่ใจใช่ไหม?</p>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="confirmCancelBtn" class="secondary">ยกเลิก</button>
            <button id="confirmCloseBtn" class="primary" style="background:var(--danger)">ปิดเว็บ</button>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Be Right Back</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 12px">เมื่อถึงวันที่กำหนด (เวลาไทย) หน้าเว็บจะแสดงรูป BE_RIGHT_BACK และเข้าหน้าอื่นไม่ได้ — ใช้ "Activate Now" เพื่อเปิดทันทีโดยไม่รอวัน</p>
        <div class="field" style="margin-bottom:12px">
          <label>วันที่ (คั่นด้วย comma, รูปแบบ YYYY-MM-DD)</label>
          <input id="beRightBackDates" type="text" placeholder="2026-05-24,2026-05-31,2026-06-07" style="max-width:420px" />
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button id="saveBeRightBackBtn" class="secondary">Save Dates</button>
          <button id="activateBeRightBackBtn" class="primary" style="background:var(--danger);min-width:140px">Activate Now</button>
          <button id="deactivateBeRightBackBtn" class="secondary" style="min-width:140px;display:none">Deactivate</button>
          <span id="beRightBackStatus" style="font-size:13px;font-weight:600;color:var(--danger);display:none">⚠ Be Right Back is active</span>
          <span id="beRightBackNotice" style="color:var(--muted);font-size:13px"></span>
        </div>
      </div>
      <div class="settings-card" id="previewAccessCard" style="display:none">
        <h3>Preview Access</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">ลิงก์สำหรับเข้าเว็บได้แม้ตอน maintenance — คลิกเพื่อเปิดหรือ copy ไปแชร์</p>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <a id="previewLinkMain" href="#" target="_blank" style="font-size:13px;font-weight:600;color:var(--primary);text-decoration:none;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;white-space:nowrap">sumfu.store</a>
            <button onclick="navigator.clipboard.writeText(document.getElementById('previewLinkMain').href).then(()=>this.textContent='Copied!').catch(()=>{}); setTimeout(()=>this.textContent='Copy',1500)" class="secondary" style="padding:8px 14px;font-size:13px">Copy</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <a id="previewLinkPreview" href="#" target="_blank" style="font-size:13px;font-weight:600;color:var(--primary);text-decoration:none;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;white-space:nowrap">store.sumfu.xyz</a>
            <button onclick="navigator.clipboard.writeText(document.getElementById('previewLinkPreview').href).then(()=>this.textContent='Copied!').catch(()=>{}); setTimeout(()=>this.textContent='Copy',1500)" class="secondary" style="padding:8px 14px;font-size:13px">Copy</button>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Store Status</h3>
        <div class="field" style="display:flex;gap:12px;align-items:center">
          <label style="margin:0;text-transform:none;font-size:14px;font-weight:600">Store Open</label>
          <label class="toggle">
            <input type="checkbox" id="storeOpen" checked />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <div class="field">
          <label>Order Deadline (ว่างไว้ = ไม่มีกำหนด)</label>
          <input id="orderDeadline" type="datetime-local" style="max-width:280px" />
        </div>
      </div>
      <div class="settings-card">
        <h3>Order Phase</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 16px">Phase กำหนด digit สุดท้ายของเลขออเดอร์ (FP28XXXX<b>P</b>) — เพิ่ม/แก้ไข Phase ได้จาก Orders tab</p>
        <div>
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">Phase ปัจจุบัน (Override)</label>
          <div id="phaseSelectBtns" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          <div style="margin-top:10px;font-size:13px">
            Phase ที่ใช้อยู่: <b id="phaseDisplay">—</b>
            <span id="phaseLabel" style="color:var(--muted);margin-left:8px;font-size:12px"></span>
          </div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Khantok Ticket Quota</h3>
        <div class="field-row">
          <div class="field">
            <label>Quota ฿100</label>
            <input id="khantokQuota100" type="number" min="0" style="max-width:140px" />
          </div>
          <div class="field">
            <label>Quota ฿50</label>
            <input id="khantokQuota50" type="number" min="0" style="max-width:140px" />
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="primary" id="saveSettingsBtn">Save Settings</button>
        <span id="settingsNotice" style="color:var(--muted);font-size:13px"></span>
      </div>
    </main>
  </div>

  <!-- AUDIT LOG TAB -->
  <div class="tab-pane" id="tab-audit">
    <main>
      <div class="toolbar">
        <input id="auditSearch" type="text" placeholder="Filter by order ID..." style="max-width:220px" />
        <button class="primary" id="refreshAuditBtn">Refresh</button>
        <span id="auditNotice" style="color:var(--muted);font-size:13px"></span>
      </div>
      <div class="table-card">
        <table>
          <thead><tr>
            <th style="width:12%">Time</th>
            <th style="width:16%">Order</th>
            <th style="width:16%">Event</th>
            <th>Detail</th>
          </tr></thead>
          <tbody id="auditBody"></tbody>
        </table>
      </div>
    </main>
  </div>

  <!-- BACKUP TAB -->
  <div class="tab-pane" id="tab-backup">
    <main>
      <div class="settings-card">
        <h3>Order Backups</h3>
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">บันทึกสถานะออเดอร์ทั้งหมด ณ เวลานั้น — กดที่รายการเพื่อดูออเดอร์ที่บันทึกไว้</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <button id="createBackupBtn" class="primary">บันทึก Backup ตอนนี้</button>
          <button id="refreshBackupListBtn" class="secondary">Refresh</button>
          <span id="backupNotice" style="color:var(--muted);font-size:13px"></span>
        </div>
        <div id="backupList"><p style="color:var(--muted);font-size:13px">Loading...</p></div>
      </div>
      <div id="backupDetailCard" style="display:none" class="settings-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0" id="backupDetailTitle">Backup Detail</h3>
          <button class="secondary" id="closeBackupDetailBtn" style="font-size:12px;padding:6px 14px">ปิด</button>
        </div>
        <div class="table-card" style="overflow-x:auto">
          <table>
            <thead><tr>
              <th>Order</th>
              <th>Status</th>
              <th>ชื่อ</th>
              <th>รหัสนักศึกษา</th>
              <th>สินค้า</th>
              <th>ยอด</th>
            </tr></thead>
            <tbody id="backupDetailBody"></tbody>
          </table>
        </div>
      </div>
    </main>
  </div>

  <!-- USERS TAB -->
  <div class="tab-pane" id="tab-users">
    <main>
      <div class="settings-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <h3 style="margin:0">Claim Station Users</h3>
          <span id="userCountBadge" style="font-size:14px;font-weight:700;color:var(--accent)">— คน</span>
        </div>
        <div style="overflow-x:auto;margin-bottom:20px">
          <table class="users-tbl">
            <thead><tr>
              <th>Username</th>
              <th>สิทธิ์</th>
              <th>เพิ่มโดย</th>
              <th>วันที่เพิ่ม</th>
              <th></th>
            </tr></thead>
            <tbody id="usersTableBody"><tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Loading...</td></tr></tbody>
          </table>
        </div>
        <div style="border-top:1px solid var(--line);padding-top:16px">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:12px">เพิ่ม Admin ใหม่</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div style="flex:1;min-width:140px">
              <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;text-transform:uppercase">Username</label>
              <input id="newUserName" type="text" placeholder="username" style="height:38px" />
            </div>
            <div style="flex:1;min-width:140px">
              <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px;text-transform:uppercase">Password</label>
              <input id="newUserPass" type="password" placeholder="password" style="height:38px" />
            </div>
            <button id="addUserBtn" class="primary" style="height:38px;white-space:nowrap">+ เพิ่ม Admin</button>
          </div>
          <p id="addUserNotice" style="font-size:12px;margin-top:8px;min-height:16px"></p>
        </div>
      </div>
    </main>
  </div>

  <!-- CUSTOM DIALOG -->
  <div id="dlgBackdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:500;align-items:center;justify-content:center;padding:16px">
    <div style="position:relative;background:var(--surface);border-radius:18px;padding:32px 28px 24px;width:min(440px,100%);box-shadow:0 12px 48px rgba(0,0,0,.22);text-align:center">
      <button id="dlgCloseBtn" style="position:absolute;top:12px;right:14px;background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;line-height:1;min-height:auto;padding:4px 8px">&#215;</button>
      <div id="dlgIcon" style="width:56px;height:56px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px"></div>
      <h3 id="dlgTitle" style="font-size:17px;font-weight:700;margin-bottom:8px;color:var(--text)"></h3>
      <p id="dlgMsg" style="font-size:14px;color:var(--muted);margin-bottom:24px;line-height:1.6;white-space:pre-wrap"></p>
      <div style="display:flex;gap:10px">
        <button id="dlgConfirmBtn" style="flex:1;height:46px;border-radius:10px;font-size:14px;font-weight:700;color:#fff;border:none;cursor:pointer;transition:opacity .15s"></button>
        <button id="dlgCancelBtn" class="ghost" style="flex:1;height:46px;border-radius:10px;font-size:14px;font-weight:600">ยกเลิก</button>
      </div>
    </div>
  </div>

  <!-- SUPERADMIN LOGIN MODAL -->
  <div class="sa-modal-backdrop" id="saLoginModal">
    <div class="sa-modal">
      <h3>👑 Superadmin</h3>
      <div class="sa-field">
        <label>Username</label>
        <input id="saUser" type="text" value="park" style="height:40px" />
      </div>
      <div class="sa-field">
        <label>Password</label>
        <input id="saPass" type="password" placeholder="password" style="height:40px" />
      </div>
      <p id="saError" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:12px"></p>
      <div style="display:flex;gap:8px">
        <button id="saLoginBtn" class="primary" style="flex:1">เข้าสู่ระบบ</button>
        <button id="saCloseBtn" class="ghost">ยกเลิก</button>
      </div>
    </div>
  </div>

  <!-- EDIT PRODUCT MODAL -->
  <div class="modal-backdrop" id="editModal">
    <div class="modal">
      <h2>Edit Product</h2>
      <input type="hidden" id="editSlug" />
      <div class="field">
        <label>Name</label>
        <input id="editName" type="text" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Short Name</label>
          <input id="editShortName" type="text" />
        </div>
        <div class="field">
          <label>Price (฿)</label>
          <input id="editPrice" type="number" min="0" />
        </div>
      </div>
      <div class="field">
        <label>Tagline</label>
        <input id="editTagline" type="text" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="editDescription" rows="3"></textarea>
      </div>
      <p class="notice err" id="editNotice"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="ghost" id="cancelEditBtn">Cancel</button>
        <button class="primary" id="saveEditBtn">Save</button>
      </div>
    </div>
  </div>

  <!-- UPLOAD IMAGE MODAL -->
  <div class="modal-backdrop" id="imageModal">
    <div class="modal">
      <h2>Upload Product Image</h2>
      <input type="hidden" id="imageSlug" />
      <div class="field">
        <label>Select Image (JPG, PNG, WebP — max 10 MB)</label>
        <input id="imageFile" type="file" accept="image/jpeg,image/png,image/webp" style="min-height:0;border:0;padding:0" />
      </div>
      <div id="imagePreviewWrap" style="display:none;margin-bottom:12px">
        <img id="imagePreview" style="width:100%;border-radius:8px;object-fit:cover;max-height:220px" alt="" />
      </div>
      <p class="notice err" id="imageNotice"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="ghost" id="cancelImageBtn">Cancel</button>
        <button class="primary" id="uploadImageBtn">Upload</button>
      </div>
    </div>
  </div>

  <!-- SLIP MODAL -->
  <div class="modal-backdrop" id="slipModal">
    <div class="modal" style="width:min(900px,100%)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <h2 style="margin:0 0 4px" id="slipModalTitle">Slip</h2>
          <div style="font-size:14px;color:var(--muted)">Total: <strong id="slipModalAmount" style="color:var(--ink)"></strong></div>
        </div>
        <button class="ghost" id="closeSlipBtn" style="font-size:20px;line-height:1;padding:4px 10px;min-height:0;border-radius:8px">×</button>
      </div>
      <div id="slipModalContent"></div>
    </div>
  </div>

  <!-- EDIT ORDER MODAL -->
  <div class="modal-backdrop" id="orderEditModal">
    <div class="modal" style="width:min(640px,100%);max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;position:sticky;top:0;background:#fff;padding-bottom:12px;border-bottom:1px solid var(--line)">
        <h2 style="margin:0" id="orderEditTitle">Edit Order</h2>
        <button class="ghost" id="closeOrderEditBtn" style="font-size:20px;line-height:1;padding:4px 10px;min-height:0;border-radius:8px">×</button>
      </div>

      <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px">Customer Info</p>
      <div class="field-row">
        <div class="field">
          <label>Full Name</label>
          <input id="oe_fullName" type="text" />
        </div>
        <div class="field">
          <label>Student Code</label>
          <input id="oe_studentCode" type="text" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Phone</label>
          <input id="oe_phone" type="text" />
        </div>
        <div class="field">
          <label>Parent Phone</label>
          <input id="oe_parentPhone" type="text" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>School (Enrolled)</label>
          <select id="oe_school"></select>
        </div>
        <div class="field">
          <label>Email</label>
          <input id="oe_email" type="email" />
        </div>
      </div>

      <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:18px 0 10px">Items</p>
      <div id="oe_itemsContainer"></div>

      <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:18px 0 10px">Khantok Ticket</p>
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:14px;font-weight:600;color:var(--text)">Has ticket</label>
          <label class="toggle">
            <input type="checkbox" id="oe_khantokTicket" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <label style="font-size:14px;font-weight:600;color:var(--text)">Already claimed</label>
          <label class="toggle">
            <input type="checkbox" id="oe_khantokClaimed" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </div>
        <div class="field" style="margin:0;flex:1;min-width:100px">
          <label>Ticket Value (฿)</label>
          <input id="oe_khantokValue" type="number" min="0" placeholder="100" />
        </div>
      </div>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0" />
      <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px">Slip</p>
      <div id="oe_slipPreview" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <p style="font-size:11px;font-weight:600;color:var(--muted);margin:0;flex:1">Replace main slip</p>
        <button class="ghost" id="oe_deleteSlipBtn" style="white-space:nowrap;font-size:12px;min-height:28px;color:var(--danger);border-color:var(--danger)">Delete Slip</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="oe_slipFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="min-height:0;border:0;padding:0;flex:1" />
        <button class="ghost" id="oe_uploadSlipBtn" style="white-space:nowrap">Upload Slip</button>
      </div>
      <p class="notice err" id="oe_slipNotice" style="margin-top:6px"></p>

      <p style="font-size:11px;font-weight:600;color:var(--muted);margin:14px 0 6px">Additional slips</p>
      <div id="oe_extraSlipsList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="oe_extraSlipFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="min-height:0;border:0;padding:0;flex:1" />
        <button class="ghost" id="oe_addExtraSlipBtn" style="white-space:nowrap">Add Slip</button>
      </div>
      <p class="notice err" id="oe_extraSlipNotice" style="margin-top:6px"></p>

      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0" />
      <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:0 0 10px">Note</p>
      <textarea id="oe_adminNote" rows="3" placeholder="Admin note (ไม่แสดงให้ลูกค้าเห็น)" style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;resize:vertical;font-family:inherit;outline:none"></textarea>

      <div id="oe_receivedInfo" style="display:none">
        <hr style="border:none;border-top:1px solid var(--line);margin:20px 0" />
        <p style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px">Pickup Record</p>
        <div id="oe_receivedDetail" style="font-size:13px;color:var(--text);padding:10px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--line)"></div>
      </div>

      <p class="notice err" id="orderEditNotice" style="margin-top:14px"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;position:sticky;bottom:0;background:#fff;padding-top:12px;border-top:1px solid var(--line)">
        <button class="ghost" id="cancelOrderEditBtn">Cancel</button>
        <button class="primary" id="saveOrderEditBtn">Save Changes</button>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="breakdownModal">
    <div class="modal" style="width:min(480px,100%)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="margin:0" id="breakdownModalTitle">รายละเอียด</h2>
        <button class="ghost" id="closeBreakdownBtn" style="font-size:20px;line-height:1;padding:4px 10px;min-height:0;border-radius:8px">×</button>
      </div>
      <div id="breakdownModalContent"><p style="color:var(--muted);text-align:center;padding:24px">Loading...</p></div>
    </div>
  </div>

  <!-- Phase date dialog -->
  <div id="phaseDialog" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:200;align-items:center;justify-content:center">
    <div style="background:var(--card);border-radius:12px;padding:24px;min-width:300px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2)">
      <h3 id="phaseDialogTitle" style="margin:0 0 16px;font-size:16px"></h3>
      <div style="margin-bottom:12px">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">วันเริ่มต้น</label>
        <input id="phaseStartDate" type="date" style="width:100%;box-sizing:border-box" />
      </div>
      <div style="margin-bottom:20px">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">วันสิ้นสุด</label>
        <input id="phaseEndDate" type="date" style="width:100%;box-sizing:border-box" />
      </div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 16px">วันที่ใช้สำหรับ Auto detection — ไม่กำหนดก็ได้</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="secondary" id="phaseDialogCancelBtn">ยกเลิก</button>
        <button class="primary" id="phaseDialogSaveBtn">บันทึก</button>
      </div>
    </div>
  </div>

  <script>
    // ── Token ──────────────────────────────────────────────────────────────────
    const tokenInput = document.querySelector("#tokenInput");
    tokenInput.value = sessionStorage.getItem("suStoreAdminToken") || "";

    function authHeaders(extra) {
      return Object.assign({ "Authorization": "Bearer " + tokenInput.value.trim(), "Content-Type": "application/json" }, extra || {});
    }

    document.querySelector("#saveTokenBtn").addEventListener("click", () => {
      sessionStorage.setItem("suStoreAdminToken", tokenInput.value.trim());
      loadOrders();
      loadProducts();
      loadSettings();
    });
    document.querySelector("#clearTokenBtn").addEventListener("click", () => {
      sessionStorage.removeItem("suStoreAdminToken");
      tokenInput.value = "";
    });

    // ── Tabs ───────────────────────────────────────────────────────────────────
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab-pane").forEach(function(p) { p.classList.remove("active"); });
        btn.classList.add("active");
        document.querySelector("#tab-" + btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "analytics") loadAnalytics();
        if (btn.dataset.tab === "settings") loadSettings();
        if (btn.dataset.tab === "audit") loadAuditLog();
        if (btn.dataset.tab === "backup") loadBackupList();
        if (btn.dataset.tab === "users") loadUsers();
      });
    });

    // ── Custom Dialog ──────────────────────────────────────────────────────────
    var _dlgResolve = null;
    var _ICONS = {
      warn:   {bg:'#fef3c7',color:'#d97706',svg:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'},
      danger: {bg:'#fee2e2',color:'#dc2626',svg:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'},
      info:   {bg:'#dbeafe',color:'#2563eb',svg:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'},
    };
    function showDialog(opts) {
      return new Promise(function(resolve) {
        _dlgResolve = resolve;
        var icon = _ICONS[opts.icon || 'warn'] || _ICONS.warn;
        var iconEl = document.getElementById('dlgIcon');
        iconEl.style.background = icon.bg; iconEl.style.color = icon.color;
        iconEl.innerHTML = icon.svg;
        document.getElementById('dlgTitle').textContent = opts.title || '';
        document.getElementById('dlgMsg').textContent = opts.message || '';
        var confirmBtn = document.getElementById('dlgConfirmBtn');
        var cancelBtn  = document.getElementById('dlgCancelBtn');
        confirmBtn.textContent = opts.confirmText || 'ตกลง';
        confirmBtn.style.background = opts.icon === 'danger' ? '#dc2626' : opts.icon === 'info' ? '#2563eb' : '#374151';
        cancelBtn.style.display = opts.type === 'alert' ? 'none' : '';
        document.getElementById('dlgBackdrop').style.display = 'flex';
      });
    }
    function _dlgClose(val) {
      document.getElementById('dlgBackdrop').style.display = 'none';
      if (_dlgResolve) { _dlgResolve(val); _dlgResolve = null; }
    }
    document.getElementById('dlgConfirmBtn').addEventListener('click', function() { _dlgClose(true); });
    document.getElementById('dlgCancelBtn').addEventListener('click', function() { _dlgClose(false); });
    document.getElementById('dlgCloseBtn').addEventListener('click', function() { _dlgClose(false); });
    document.getElementById('dlgBackdrop').addEventListener('click', function(e) { if (e.target===this) _dlgClose(false); });

    // ── Superadmin ─────────────────────────────────────────────────────────────
    var superToken = sessionStorage.getItem('saSuperToken') || '';
    var superUser  = sessionStorage.getItem('saSuperUser')  || '';

    function saHeaders() {
      return { 'Authorization': 'Superadmin ' + superToken, 'Content-Type': 'application/json' };
    }
    (function() {
      if (superToken) document.querySelector('#usersTabBtn').style.display = 'inline-flex';
    })();

    document.querySelector('#superAdminBtn').addEventListener('click', async function() {
      if (superToken) {
        if (await showDialog({icon:'warn',title:'ออกจาก Superadmin',message:'Users tab จะถูกซ่อน',confirmText:'ออกจากระบบ'})) {
          superToken = ''; superUser = '';
          sessionStorage.removeItem('saSuperToken'); sessionStorage.removeItem('saSuperUser');
          document.querySelector('#usersTabBtn').style.display = 'none';
          if (document.querySelector('#tab-users').classList.contains('active')) {
            document.querySelector('[data-tab="orders"]').click();
          }
        }
        return;
      }
      document.querySelector('#saLoginModal').classList.add('open');
      document.querySelector('#saPass').value = '';
      document.querySelector('#saError').textContent = '';
      setTimeout(function() { document.querySelector('#saPass').focus(); }, 80);
    });

    document.querySelector('#saCloseBtn').addEventListener('click', function() {
      document.querySelector('#saLoginModal').classList.remove('open');
    });
    document.querySelector('#saLoginModal').addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.querySelector('#saLoginBtn').addEventListener('click', doSaLogin);
    document.querySelector('#saPass').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doSaLogin();
    });

    async function doSaLogin() {
      var user = document.querySelector('#saUser').value.trim();
      var pass = document.querySelector('#saPass').value;
      var errEl = document.querySelector('#saError');
      var btn   = document.querySelector('#saLoginBtn');
      if (!user || !pass) { errEl.textContent = 'กรอก username และ password'; return; }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...';
      errEl.textContent = '';
      try {
        const r = await fetch('/admin/superlogin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        superToken = d.token; superUser = d.username;
        sessionStorage.setItem('saSuperToken', superToken);
        sessionStorage.setItem('saSuperUser', superUser);
        document.querySelector('#usersTabBtn').style.display = 'inline-flex';
        document.querySelector('#saLoginModal').classList.remove('open');
        document.querySelector('#usersTabBtn').click();
      } catch(err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      }
    }

    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    async function loadUsers() {
      var tbody = document.querySelector('#usersTableBody');
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Loading...</td></tr>';
      try {
        const r = await fetch('/admin/users', { headers: saHeaders() });
        if (r.status === 401) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:20px">Session หมดอายุ กรุณา login ใหม่</td></tr>';
          return;
        }
        const d = await r.json();
        const users = d.users || [];
        document.querySelector('#userCountBadge').textContent = users.length + ' คน';
        if (!users.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">ยังไม่มี admin</td></tr>';
          return;
        }
        tbody.innerHTML = users.map(function(u) {
          var badge = u.isSuperadmin ? '<span class="badge-super">SUPER</span>' : '';
          var role  = u.isSuperadmin ? 'Superadmin' : 'Admin';
          var dt    = u.createdAt ? new Date(u.createdAt).toLocaleDateString('th-TH') : '-';
          var delBtn = u.isSuperadmin ? '' :
            '<button onclick="deleteUser(' + JSON.stringify(u.username) + ')" style="font-size:11px;min-height:28px;padding:0 10px;border-color:var(--danger);color:var(--danger);background:none;border-radius:6px;cursor:pointer">ลบ</button>';
          return '<tr>' +
            '<td><strong>' + esc(u.username) + '</strong>' + badge + '</td>' +
            '<td style="color:var(--muted);font-size:12px">' + role + '</td>' +
            '<td style="color:var(--muted);font-size:12px">' + esc(u.createdBy||'-') + '</td>' +
            '<td style="color:var(--muted);font-size:12px">' + dt + '</td>' +
            '<td>' + delBtn + '</td>' +
          '</tr>';
        }).join('');
      } catch(e) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:20px">โหลดข้อมูลไม่ได้</td></tr>';
      }
    }

    async function deleteUser(username) {
      if (!await showDialog({icon:'danger',title:'ลบ Admin',message:'ลบ "' + username + '" ออกจากระบบ?',confirmText:'ลบ'})) return;
      try {
        const r = await fetch('/admin/users/' + encodeURIComponent(username), {
          method: 'DELETE', headers: saHeaders()
        });
        const d = await r.json();
        if (!r.ok) { await showDialog({type:'alert',icon:'info',title:'ลบไม่สำเร็จ',message:d.message||'ลบไม่ได้'}); return; }
        loadUsers();
      } catch(e) { await showDialog({type:'alert',icon:'info',title:'เกิดข้อผิดพลาด',message:'กรุณาลองใหม่อีกครั้ง'}); }
    }

    document.querySelector('#addUserBtn').addEventListener('click', async function() {
      var username = document.querySelector('#newUserName').value.trim();
      var password = document.querySelector('#newUserPass').value;
      var noticeEl = document.querySelector('#addUserNotice');
      if (!username || !password) {
        noticeEl.style.color = 'var(--danger)'; noticeEl.textContent = 'กรอก username และ password';
        return;
      }
      this.disabled = true; noticeEl.textContent = '';
      try {
        const r = await fetch('/admin/users', {
          method: 'POST', headers: saHeaders(),
          body: JSON.stringify({ username: username, password: password })
        });
        const d = await r.json();
        if (!r.ok) { noticeEl.style.color = 'var(--danger)'; noticeEl.textContent = d.message || 'เพิ่มไม่ได้'; return; }
        noticeEl.style.color = 'var(--ok)'; noticeEl.textContent = 'เพิ่ม ' + username + ' สำเร็จ';
        document.querySelector('#newUserName').value = '';
        document.querySelector('#newUserPass').value = '';
        loadUsers();
      } catch(e) {
        noticeEl.style.color = 'var(--danger)'; noticeEl.textContent = 'เกิดข้อผิดพลาด';
      } finally { this.disabled = false; }
    });

    // ── Clock ──────────────────────────────────────────────────────────────────
    (function() {
      var clockEl = document.querySelector("#adminClock");
      function tick() {
        var now = new Date();
        var bkk = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
        var h = String(bkk.getHours()).padStart(2, "0");
        var m = String(bkk.getMinutes()).padStart(2, "0");
        var s = String(bkk.getSeconds()).padStart(2, "0");
        var days = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
        var day = days[bkk.getDay()];
        var date = bkk.getDate();
        var months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        var mon = months[bkk.getMonth()];
        clockEl.textContent = day + " " + date + " " + mon + " " + h + ":" + m + ":" + s;
      }
      tick();
      setInterval(tick, 1000);
    })();

    // ── Server Status ──────────────────────────────────────────────────────────
    (function() {
      async function checkServer(url, dotId, msId) {
        var dot = document.getElementById(dotId);
        var ms  = document.getElementById(msId);
        try {
          var t0 = performance.now();
          var r  = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
          var elapsed = Math.round(performance.now() - t0);
          if (r.ok) {
            dot.className = "srv-dot " + (elapsed > 500 ? "warn" : "ok");
            ms.textContent = elapsed + "ms";
          } else {
            dot.className = "srv-dot err";
            ms.textContent = r.status;
          }
        } catch(e) {
          dot.className = "srv-dot err";
          ms.textContent = "offline";
        }
      }
      function pollAll() {
        checkServer("https://sumfu.store/api/health", "dotStore", "msStore");
        checkServer("/health", "dotApi", "msApi");
      }
      pollAll();
      setInterval(pollAll, 30000);
    })();

    // ── Helpers ────────────────────────────────────────────────────────────────
    function baht(v) {
      return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(Number(v || 0));
    }
    function esc(v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, function(c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c];
      });
    }

    // ── ORDERS ─────────────────────────────────────────────────────────────────
    var statuses = ["pending_payment","waiting_confirm","paid","preparing","shipped","received","cancelled","rejected"];
    var STATUS_TH = {"pending_payment":"รอสลิป","waiting_confirm":"รอยืนยัน","paid":"ชำระแล้ว","preparing":"กำลังจัดเตรียม","shipped":"พร้อมรับ","received":"รับแล้ว ✓","cancelled":"ยกเลิก","rejected":"ปฏิเสธ"};
    function fmtDate(iso) {
      if (!iso) return "-";
      var s = String(iso).replace(" ", "T");
      if (!/Z$|[+-]\d{2}:\d{2}$/.test(s)) s += "Z";
      var d = new Date(s);
      if (isNaN(d.getTime())) return String(iso);
      var u = new Date(d.getTime() + 7 * 3600000);
      var M = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
      function pad(n) { return n < 10 ? "0" + n : "" + n; }
      return u.getUTCDate() + " " + M[u.getUTCMonth()] + " " + pad(u.getUTCHours()) + ":" + pad(u.getUTCMinutes());
    }
    var allOrders = [];
    var serverSummary = {};
    var currentPage = 1;
    var totalPages = 1;
    var totalOrders = 0;
    var currentRound = 0;
    var searchTimer = null;

    function setOrdersNotice(msg, err) {
      var el = document.querySelector("#ordersNotice");
      el.textContent = msg;
      el.className = "notice" + (err ? " err" : "");
    }

    function countUp(el, target, ms) {
      var s = performance.now();
      (function tick(now) {
        var p = Math.min((now - s) / ms, 1);
        var e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(e * target).toLocaleString();
        if (p < 1) requestAnimationFrame(tick);
      })(s);
    }
    function odometer(el, newText) {
      newText = String(newText);
      var oldText = el.textContent;
      if (oldText === newText) return;
      var oldDigits = oldText.replace(/\D/g, '');
      var newDigits = newText.replace(/\D/g, '');
      var offset = oldDigits.length - newDigits.length;
      var digitIdx = 0;
      var parts = [];
      // Match single digits OR runs of non-digits (keeps Thai combining chars together)
      var segs = newText.match(/(\d|\D+)/g) || [newText];
      segs.forEach(function(seg) {
        if (/^\d$/.test(seg)) {
          var nc = seg;
          var oi = digitIdx + offset;
          var oc = (oi >= 0 && oi < oldDigits.length) ? oldDigits[oi] : null;
          if (nc !== oc) {
            var nv = parseInt(nc, 10);
            var ov = oc !== null ? parseInt(oc, 10) : -1;
            var anim = (ov < 0 || nv > ov) ? 'odom-up' : 'odom-dn';
            parts.push('<span style="animation:' + anim + ' 0.35s cubic-bezier(.22,1,.36,1) both">' + nc + '</span>');
          } else {
            parts.push('<span>' + nc + '</span>');
          }
          digitIdx++;
        } else {
          parts.push('<span>' + seg + '</span>');
        }
      });
      // Wrap in inline-flex so word-break:break-all on parent cannot split between digit spans
      el.innerHTML = '<span style="display:inline-flex;align-items:baseline">' + parts.join('') + '</span>';
    }
    function updateOrderStats(summary) {
      function n(v) { return Number(v || 0).toLocaleString(); }
      function setOdom(id, val) { var el = document.getElementById(id); if (el) odometer(el, val); }
      setOdom('statTotal', n(summary.total));
      setOdom('statPending', n(summary.pendingPayment));
      setOdom('statWaiting', n(summary.waitingConfirm));
      setOdom('statPaid', n(summary.paid));
      setOdom('statRejected', n(summary.rejected));
      setOdom('statSingle', n(summary.qtySingle) + ' ตัว');
      setOdom('statJacket', n(summary.qtyJacket) + ' ตัว');
      setOdom('statHeadband', n(summary.qtyHeadband) + ' อัน');
    }
    var _statsStreamCtrl = null;
    async function startStatsStream() {
      if (_statsStreamCtrl) { _statsStreamCtrl.abort(); _statsStreamCtrl = null; }
      var ctrl = new AbortController();
      _statsStreamCtrl = ctrl;
      try {
        var res = await fetch('/admin/stats-stream', {
          headers: { 'Authorization': 'Bearer ' + tokenInput.value.trim() },
          signal: ctrl.signal
        });
        if (!res.ok) return;
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function(line) {
            if (line.indexOf('data: ') !== 0) return;
            try {
              var d = JSON.parse(line.slice(6));
              // visitor count
              var ve = document.querySelector('#webVisitorCount');
              if (ve && d.visitors != null) odometer(ve, Number(d.visitors).toLocaleString());
              // orders summary
              if (d.summary) {
                serverSummary = d.summary;
                if (currentRound === 0) {
                  if (document.getElementById('statTotal')) {
                    updateOrderStats(d.summary);
                  } else {
                    renderOrderStats(d.summary);
                  }
                }
              }
              // analytics summary (only update if tab has been loaded)
              if (d.analytics) {
                var ae = document.querySelector('#anTotal');
                if (ae) {
                  odometer(ae, String(d.analytics.total));
                  var ar = document.querySelector('#anRevenue');
                  if (ar) odometer(ar, baht(d.analytics.revenue));
                  var as = document.querySelector('#anSchool');
                  if (as) odometer(as, String(d.analytics.schoolCount));
                  var ap = document.querySelector('#anProfit');
                  if (ap) odometer(ap, baht(d.analytics.profit));
                }
              }
            } catch(e) {}
          });
        }
      } catch(e) {
        if (e.name !== 'AbortError') setTimeout(startStatsStream, 5000);
      }
    }
    function renderOrderStats(summary) {
      var k100Used = Number(summary.khantokTicket100Used || 0);
      var k100Quota = Number(summary.khantokTicket100Quota || 0);
      var k100Rem = Number(summary.khantokTicket100Remaining || 0);
      var k50Used = Number(summary.khantokTicket50Used || 0);
      var k50Quota = Number(summary.khantokTicket50Quota || 0);
      var k50Rem = Number(summary.khantokTicket50Remaining || 0);
      function statHtml(label, value, compact) {
        return '<div class="' + (compact ? "stat compact" : "stat") + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
      }
      function khantokStatHtml(label, used, quota) {
        var pct = quota > 0 ? Math.min(100, Math.round(used / quota * 100)) : 0;
        var r = 18, circ = 2 * Math.PI * r;
        var arc = circ * pct / 100;
        return '<div class="stat stat-ring">' +
          '<svg width="52" height="52" viewBox="0 0 50 50" style="flex-shrink:0">' +
          '<circle cx="25" cy="25" r="18" fill="none" stroke="#e8e8e8" stroke-width="5"/>' +
          '<circle cx="25" cy="25" r="18" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"' +
          ' stroke-dasharray="0 ' + circ.toFixed(2) + '" transform="rotate(-90 25 25)">' +
          '<animate attributeName="stroke-dasharray" from="0 ' + circ.toFixed(2) + '" to="' + arc.toFixed(2) + ' ' + (circ - arc).toFixed(2) + '"' +
          ' dur="1s" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1"/>' +
          '</circle>' +
          '<text x="25" y="29" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">' + pct + '%</text>' +
          '</svg>' +
          '<div style="min-width:0">' +
          '<span>' + esc(label) + '</span>' +
          '<strong>' + used.toLocaleString() + ' / ' + quota.toLocaleString() + '</strong>' +
          '</div></div>';
      }
      function statClickHtml(label, value, category) {
        return '<div class="stat compact" style="cursor:pointer;border-bottom:2px solid var(--accent)" data-breakdown="' + esc(category) + '" title="คลิกดูรายละเอียด"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>';
      }
      var row1 = [
        '<div class="stat"><span>ทั้งหมด</span><strong id="statTotal">' + esc(summary.total || 0) + '</strong></div>',
        '<div class="stat"><span>รอสลิป</span><strong id="statPending">' + esc(summary.pendingPayment || 0) + '</strong></div>',
        '<div class="stat"><span>รอยืนยัน</span><strong id="statWaiting">' + esc(summary.waitingConfirm || 0) + '</strong></div>',
        '<div class="stat"><span>ชำระแล้ว</span><strong id="statPaid" style="color:var(--ok)">' + esc(summary.paid || 0) + '</strong></div>',
        '<div class="stat"><span>ปฏิเสธ</span><strong id="statRejected">' + esc(summary.rejected || 0) + '</strong></div>',
        khantokStatHtml("บัตรขันโตก ฿100", k100Used, k100Quota),
        khantokStatHtml("บัตรขันโตก ฿50", k50Used, k50Quota),
      ].join("");
      var row2 = [
        '<div class="stat compact" style="cursor:pointer;border-bottom:2px solid var(--accent)" data-breakdown="single" title="คลิกดูรายละเอียด"><span>โปโล</span><strong id="statSingle">' + esc((summary.qtySingle || 0) + ' ตัว') + '</strong></div>',
        '<div class="stat compact" style="cursor:pointer;border-bottom:2px solid var(--accent)" data-breakdown="jacket" title="คลิกดูรายละเอียด"><span>แจ็คเก็ต</span><strong id="statJacket">' + esc((summary.qtyJacket || 0) + ' ตัว') + '</strong></div>',
        '<div class="stat compact" style="cursor:pointer;border-bottom:2px solid var(--accent)" data-breakdown="headband" title="คลิกดูรายละเอียด"><span>Headband</span><strong id="statHeadband">' + esc((summary.qtyHeadband || 0) + ' อัน') + '</strong></div>',
      ].join("");
      document.querySelector("#orderStats").innerHTML =
        '<div class="stats" style="margin-bottom:8px">' + row1 + '</div>' +
        '<div class="stats" style="margin-bottom:0">' + row2 + '</div>';
      // Count-up animation on numeric stat cards
      document.querySelectorAll('#orderStats .stat strong').forEach(function(el) {
        var txt = el.textContent.trim();
        if (/^\d+$/.test(txt)) {
          var target = parseInt(txt, 10);
          if (target > 0) countUp(el, target, 900);
        }
      });
      // Start real-time stats + visitor stream
      startStatsStream();
    }

    var SCHOOL_OPTIONS = [
      "School of Agro-Industry","School of Cosmetic Science","School of Dentistry",
      "School of Health Science","School of Applied Digital Technology","School of Integrative Medicine",
      "School of Law","School of Liberal Arts","School of Management","School of Medicine",
      "School of Nursing","School of Science","School of Sinology","School of Social Innovation"
    ];
    var SIZE_OPTIONS = ["3S","2S","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","7XL"];
    var JACKET_COLORS = ["Blue","Red","White"];
    var SURCHARGE_SIZES = ["2XL","3XL","4XL","5XL","6XL","7XL"];
    var SURCHARGE_PRODUCTS = ["single-shirt","fresh-jacket"];
    var SURCHARGE_AMOUNT = 20;

    (function populateSchoolSelect() {
      var sel = document.querySelector("#oe_school");
      sel.innerHTML = SCHOOL_OPTIONS.map(function(s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
    })();

    function sizeOptions(current) {
      return SIZE_OPTIONS.map(function(s) {
        return '<option value="' + esc(s) + '"' + (s === current ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('');
    }
    function schoolOptions(current) {
      return '<option value="">-- Select --</option>' + SCHOOL_OPTIONS.map(function(s) {
        return '<option value="' + esc(s) + '"' + (s === current ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('');
    }
    function colorOptions(current) {
      return JACKET_COLORS.map(function(c) {
        return '<option value="' + esc(c) + '"' + (c === current ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
    }

    function renderItemEditors(items) {
      var container = document.querySelector("#oe_itemsContainer");
      container.innerHTML = items.map(function(item, idx) {
        var p = item.product || {};
        var cat = p.category || "";
        var slug = p.slug || "";
        var price = p.price || 0;
        var surcharge = (SURCHARGE_PRODUCTS.indexOf(slug) >= 0 && SURCHARGE_SIZES.indexOf((item.size||"").split(" / ")[0]) >= 0) ? SURCHARGE_AMOUNT : 0;
        var unitPrice = price + surcharge;
        var totalAmt = unitPrice * (item.quantity || 1);

        var sizeColorHtml = "";
        if (cat === "jacket") {
          var parts = (item.size || "").split(" / ");
          var sz = parts[0] || SIZE_OPTIONS[4];
          var cl = parts[1] || "Blue";
          sizeColorHtml = '<div class="field-row"><div class="field"><label>Size</label><select class="oe_iSize">' + sizeOptions(sz) + '</select></div>' +
            '<div class="field"><label>Color</label><select class="oe_iColor">' + colorOptions(cl) + '</select></div></div>';
        } else if (cat === "headband") {
          sizeColorHtml = '<div class="field"><label>Print on Headband (School)</label><select class="oe_iSchool">' + schoolOptions(item.school || "") + '</select></div>';
        } else {
          sizeColorHtml = '<div class="field"><label>Size</label><select class="oe_iSize">' + sizeOptions(item.size || "") + '</select></div>';
        }

        return '<div class="item-editor" data-idx="' + idx + '" data-cat="' + esc(cat) + '" data-slug="' + esc(slug) + '" data-price="' + price + '" data-id="' + esc(item.id||"") + '" style="border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:10px">' +
          '<p style="font-size:13px;font-weight:700;margin-bottom:10px">' + esc(p.name || "Item " + (idx+1)) + '</p>' +
          '<div class="field-row">' +
            '<div>' + sizeColorHtml + '</div>' +
            '<div class="field"><label>Quantity</label><input type="number" class="oe_iQty" value="' + (item.quantity||1) + '" min="1" style="max-width:80px" /></div>' +
          '</div>' +
          '<p class="oe_iTotal muted" style="font-size:12px;margin-top:4px">Total: <strong>' + baht(totalAmt) + '</strong></p>' +
        '</div>';
      }).join('');

      container.querySelectorAll(".oe_iSize, .oe_iColor, .oe_iQty").forEach(function(el) {
        el.addEventListener("change", updateItemTotals);
        el.addEventListener("input", updateItemTotals);
      });
    }

    function updateItemTotals() {
      document.querySelectorAll("#oe_itemsContainer .item-editor").forEach(function(el) {
        var cat = el.dataset.cat;
        var slug = el.dataset.slug;
        var basePrice = parseInt(el.dataset.price, 10) || 0;
        var qty = parseInt(el.querySelector(".oe_iQty").value, 10) || 1;
        var sizeEl = el.querySelector(".oe_iSize");
        var sz = sizeEl ? sizeEl.value : "";
        if (cat === "jacket") {
          sz = sizeEl ? sizeEl.value : "";
        }
        var surcharge = (SURCHARGE_PRODUCTS.indexOf(slug) >= 0 && SURCHARGE_SIZES.indexOf(sz.split(" / ")[0]) >= 0) ? SURCHARGE_AMOUNT : 0;
        var unitPrice = basePrice + surcharge;
        var total = unitPrice * qty;
        var totalEl = el.querySelector(".oe_iTotal");
        if (totalEl) totalEl.innerHTML = 'Unit: ฿' + unitPrice + ' × ' + qty + ' = <strong>' + baht(total) + '</strong>';
      });
    }

    function collectItems(originalItems) {
      var items = [];
      document.querySelectorAll("#oe_itemsContainer .item-editor").forEach(function(el, idx) {
        var original = originalItems[idx] || originalItems[0];
        var cat = el.dataset.cat;
        var slug = el.dataset.slug;
        var basePrice = parseInt(el.dataset.price, 10) || 0;
        var qty = Math.max(1, parseInt(el.querySelector(".oe_iQty").value, 10) || 1);
        var size = "", school = null;

        if (cat === "jacket") {
          var sz = el.querySelector(".oe_iSize").value;
          var cl = el.querySelector(".oe_iColor").value;
          size = sz + " / " + cl;
        } else if (cat === "headband") {
          size = "ONE SIZE";
          school = el.querySelector(".oe_iSchool").value || null;
        } else {
          size = el.querySelector(".oe_iSize").value;
        }

        var sizeForSurcharge = size.split(" / ")[0];
        var surcharge = (SURCHARGE_PRODUCTS.indexOf(slug) >= 0 && SURCHARGE_SIZES.indexOf(sizeForSurcharge) >= 0) ? SURCHARGE_AMOUNT : 0;
        var unitPrice = basePrice + surcharge;

        items.push({
          id: el.dataset.id || (slug + "-" + (idx+1)),
          product: original.product,
          size: size,
          school: school,
          quantity: qty,
          unitPrice: unitPrice,
          totalAmount: unitPrice * qty,
        });
      });
      return items;
    }

    var editingOrderId = null;
    var editingOrderItems = [];

    function renderOrders() {
      document.querySelector("#ordersBody").innerHTML = allOrders.map(function(order) {
        var c = order.customer || {};
        var p = order.product || {};
        var isEditing = editingOrderId === order.id;
        var statusSelect = '<select class="statusSelect" data-oid="' + esc(order.id) + '">' +
          '<option value="">เปลี่ยนสถานะ…</option>' +
          statuses.map(function(s) {
            return '<option value="' + esc(s) + '"' + (order.status === s ? ' selected' : '') + '>' + esc(STATUS_TH[s] || s) + '</option>';
          }).join('') +
          '</select>';
        var orderItems = (order.items && order.items.length > 0)
          ? order.items
          : [{product: order.product || {}, size: order.size, quantity: order.quantity, totalAmount: order.totalAmount}];
        var itemsHtml = orderItems.map(function(item, idx) {
          var ip = item.product || {};
          var sep = idx > 0 ? '<hr style="border:none;border-top:1px solid #e5e7eb;margin:4px 0">' : '';
          var schoolLine = item.school ? '<br/><span class="muted" style="font-size:11px">' + esc(item.school) + '</span>' : '';
          return sep + '<strong>' + esc(ip.name||"-") + '</strong><br/><span class="muted">Size: ' + esc(item.size||"-") + ' / Qty: ' + esc(item.quantity||0) + '</span>' + schoolLine;
        }).join('');
        var schoolHtml = c.school ? '<br/><span class="muted">' + esc(c.school) + '</span>' : '';
        var needsAction = order.status === 'waiting_confirm' && order.slip;
        return '<tr class="' + (isEditing ? 'editing-row' : needsAction ? 'needs-action' : '') + '">' +
          '<td><input type="checkbox" class="orderCheckbox" data-oid="' + esc(order.id) + '" /></td>' +
          '<td><strong>' + esc(order.id) + '</strong><br/><span class="muted">' + fmtDate(order.createdAt) + '</span></td>' +
          '<td><strong>' + esc(c.fullName||"-") + '</strong><br/><span class="muted">' + esc(c.studentCode||"-") + '</span><br/><span class="muted">' + esc(c.phone||"") + '</span></td>' +
          '<td>' + itemsHtml + '<br/><span class="money">' + esc(baht(order.totalAmount)) + '</span>' + schoolHtml + '</td>' +
          '<td><span class="muted">' + (order.slip ? '<span style="color:var(--ok)">✓ Slip uploaded</span>' : 'ไม่มีสลิป') + '</span><br/>' + (order.khantokTicket ? '<span style="font-size:11px;font-weight:700;color:var(--ok)">🎟 บัตรขันโตก ฿' + (order.khantokTicketValue || 100) + '</span>' : order.khantokTicketAlreadyClaimed ? '<span style="font-size:11px;font-weight:700;color:var(--warn)">🎟 ได้ไปแล้ว</span>' : '<span style="font-size:11px;color:var(--muted)">ไม่ได้บัตร</span>') + '</td>' +
          '<td><span class="badge ' + esc(order.status) + '">' + esc(STATUS_TH[order.status] || order.status) + '</span>' + (needsAction ? '<br/><span style="font-size:10px;color:var(--warn);font-weight:700">⚠ รอยืนยัน</span>' : '') + (order.status === 'received' && order.receivedBy ? '<br/><span style="font-size:10px;color:var(--muted)">โดย ' + esc(order.receivedBy) + '</span>' : '') + '</td>' +
          '<td style="font-size:12px;white-space:pre-wrap">' + (order.adminNote ? '<span style="color:' + (order.adminNote.includes('ได้รับผ้าคาดฟรีโควต้า500') ? 'var(--ok)' : 'var(--muted)') + '">' + esc(order.adminNote) + '</span>' : '') + '</td>' +
          '<td>' + statusSelect +
            '<div style="display:flex;gap:4px">' +
              '<button class="ghost slipBtn" data-oid="' + esc(order.id) + '" data-total="' + esc(order.totalAmount||0) + '" style="font-size:12px;min-height:28px;flex:1"' + (order.slip ? "" : " disabled") + '>Slip</button>' +
              (order.status === 'waiting_confirm' ? '<button class="ok-btn confirmPayBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:28px;flex:1">Confirm</button>' : '') +
              '<button class="ghost editOrderBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:28px;background:' + (isEditing ? '#fef9c3' : '') + ';border-color:' + (isEditing ? '#ca8a04' : '') + '">Edit</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join("");
      updateBulkBar();
      renderPagination();
    }

    function openOrderEdit(order) {
      var c = order.customer || {};
      editingOrderId = order.id;
      var items = (order.items && order.items.length > 0)
        ? order.items
        : [{product: order.product || {}, size: order.size, quantity: order.quantity, school: null, unitPrice: (order.product||{}).price||0, totalAmount: order.totalAmount}];
      editingOrderItems = items;
      document.querySelector("#orderEditTitle").textContent = "Edit Order — " + order.id;
      document.querySelector("#oe_fullName").value = c.fullName || "";
      document.querySelector("#oe_studentCode").value = c.studentCode || "";
      document.querySelector("#oe_phone").value = c.phone || "";
      document.querySelector("#oe_parentPhone").value = c.parentPhone || "";
      var schoolSel = document.querySelector("#oe_school");
      schoolSel.value = c.school || "";
      if (!schoolSel.value && c.school) {
        var opt = document.createElement("option");
        opt.value = c.school; opt.textContent = c.school;
        schoolSel.insertBefore(opt, schoolSel.firstChild);
        schoolSel.value = c.school;
      }
      document.querySelector("#oe_email").value = c.email || "";
      document.querySelector("#oe_khantokTicket").checked = !!order.khantokTicket;
      document.querySelector("#oe_khantokClaimed").checked = !!order.khantokTicketAlreadyClaimed;
      document.querySelector("#oe_khantokValue").value = order.khantokTicketValue != null ? order.khantokTicketValue : "";
      renderItemEditors(items);
      var slipPreview = document.querySelector("#oe_slipPreview");
      if (order.slip) {
        slipPreview.innerHTML = '<p style="font-size:12px;color:var(--ok);margin:0 0 6px">✓ Slip uploaded at ' + esc(order.slip.uploadedAt||"") + '</p>' +
          '<div id="oe_mainSlipThumb" style="display:flex;align-items:flex-start;gap:8px">' +
            '<img src="" alt="slip" style="max-width:120px;max-height:120px;border-radius:6px;border:1px solid var(--line);object-fit:contain;display:none" />' +
            '<span style="font-size:12px;color:var(--muted)">Loading...</span>' +
          '</div>';
        (function(ordId) {
          fetch("/admin/orders/" + encodeURIComponent(ordId) + "/slip", { headers: authHeaders() })
            .then(function(r) { return r.blob(); })
            .then(function(blob) {
              var thumb = document.querySelector("#oe_mainSlipThumb");
              if (!thumb) return;
              if (blob.type === "application/pdf") {
                thumb.innerHTML = '<span style="font-size:12px;color:var(--muted)">📄 PDF slip</span>';
              } else {
                var url = URL.createObjectURL(blob);
                var img = thumb.querySelector("img");
                var span = thumb.querySelector("span");
                img.src = url; img.style.display = ""; if (span) span.remove();
              }
            }).catch(function() {
              var thumb = document.querySelector("#oe_mainSlipThumb");
              if (thumb) thumb.innerHTML = '<span style="font-size:12px;color:var(--muted)">Could not load preview</span>';
            });
        })(editingOrderId);
      } else {
        slipPreview.innerHTML = '<p style="font-size:12px;color:var(--muted)">No slip uploaded</p>';
      }
      document.querySelector("#oe_slipFile").value = "";
      document.querySelector("#oe_slipNotice").textContent = "";
      document.querySelector("#oe_extraSlipFile").value = "";
      document.querySelector("#oe_extraSlipNotice").textContent = "";
      document.querySelector("#oe_adminNote").value = order.adminNote || "";
      document.querySelector("#orderEditNotice").textContent = "";
      var receivedInfoEl = document.querySelector("#oe_receivedInfo");
      var receivedDetailEl = document.querySelector("#oe_receivedDetail");
      if (order.receivedAt && receivedInfoEl && receivedDetailEl) {
        var rdt = new Date(order.receivedAt.indexOf('Z') < 0 ? order.receivedAt + 'Z' : order.receivedAt);
        var rdtStr = rdt.toLocaleString('th-TH', {timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
        receivedDetailEl.textContent = 'รับสินค้าเมื่อ ' + rdtStr + (order.receivedBy ? ' โดย ' + order.receivedBy : '');
        receivedInfoEl.style.display = '';
      } else if (receivedInfoEl) {
        receivedInfoEl.style.display = 'none';
      }
      loadExtraSlips(editingOrderId);
      document.querySelector("#orderEditModal").classList.add("open");
      renderOrders();
    }

    function closeOrderEdit() {
      editingOrderId = null;
      editingOrderItems = [];
      document.querySelector("#orderEditModal").classList.remove("open");
      renderOrders();
    }

    document.querySelector("#closeOrderEditBtn").addEventListener("click", closeOrderEdit);
    document.querySelector("#cancelOrderEditBtn").addEventListener("click", closeOrderEdit);
    document.querySelector("#orderEditModal").addEventListener("click", function(e) {
      if (e.target === document.querySelector("#orderEditModal")) closeOrderEdit();
    });

    document.querySelector("#oe_uploadSlipBtn").addEventListener("click", async function() {
      var fileInput = document.querySelector("#oe_slipFile");
      var notice = document.querySelector("#oe_slipNotice");
      if (!editingOrderId || !fileInput.files || !fileInput.files[0]) {
        notice.textContent = "Please select a file first";
        return;
      }
      notice.textContent = "Uploading...";
      var formData = new FormData();
      formData.append("slip", fileInput.files[0]);
      try {
        var res = await fetch("/admin/orders/" + encodeURIComponent(editingOrderId) + "/slip", {
          method: "POST",
          headers: { "Authorization": "Bearer " + tokenInput.value.trim() },
          body: formData,
        });
        if (!res.ok) throw new Error(await res.text());
        var updated = await res.json();
        notice.style.color = "var(--ok)";
        notice.textContent = "✓ Slip uploaded successfully";
        var slipPreview = document.querySelector("#oe_slipPreview");
        if (updated.slip) {
          slipPreview.innerHTML = '<p style="font-size:12px;color:var(--ok);margin:0 0 6px">✓ Slip uploaded at ' + esc(updated.slip.uploadedAt||"") + '</p>' +
            '<div id="oe_mainSlipThumb"><span style="font-size:12px;color:var(--muted)">Loading...</span></div>';
          fetch("/admin/orders/" + encodeURIComponent(editingOrderId) + "/slip", { headers: authHeaders() })
            .then(function(r2) { return r2.blob(); })
            .then(function(blob) {
              var thumb = document.querySelector("#oe_mainSlipThumb");
              if (!thumb) return;
              if (blob.type === "application/pdf") { thumb.innerHTML = '<span style="font-size:12px;color:var(--muted)">📄 PDF slip</span>'; }
              else { var u = URL.createObjectURL(blob); thumb.innerHTML = '<img src="' + u + '" style="max-width:120px;max-height:120px;border-radius:6px;border:1px solid var(--line);object-fit:contain" />'; }
            }).catch(function(){});
        } else { slipPreview.innerHTML = ''; }
        fileInput.value = "";
        var orderIdx = allOrders.findIndex(function(o) { return o.id === editingOrderId; });
        if (orderIdx >= 0) allOrders[orderIdx] = updated;
        renderOrders();
      } catch(e) {
        notice.style.color = "var(--danger)";
        notice.textContent = e.message;
      }
    });

    document.querySelector("#oe_deleteSlipBtn").addEventListener("click", async function() {
      if (!editingOrderId) return;
      if (!await showDialog({icon:'danger',title:'ลบ Slip',message:'ลบ slip หลักของออเดอร์นี้?',confirmText:'ลบ'})) return;
      var notice = document.querySelector("#oe_slipNotice");
      notice.style.color = "var(--muted)"; notice.textContent = "Deleting...";
      try {
        var res = await fetch("/admin/orders/" + encodeURIComponent(editingOrderId) + "/slip", {
          method: "DELETE", headers: authHeaders()
        });
        if (!res.ok) throw new Error(await res.text());
        var updated = await res.json();
        notice.style.color = "var(--ok)"; notice.textContent = "✓ Slip deleted";
        document.querySelector("#oe_slipPreview").innerHTML = '<p style="font-size:12px;color:var(--muted)">No slip uploaded</p>';
        var orderIdx = allOrders.findIndex(function(o) { return o.id === editingOrderId; });
        if (orderIdx >= 0) allOrders[orderIdx] = updated;
        renderOrders();
      } catch(e) {
        notice.style.color = "var(--danger)"; notice.textContent = e.message;
      }
    });

    function renderExtraSlip(slip, container) {
      var div = document.createElement("div");
      div.style.cssText = "position:relative;display:inline-flex;flex-direction:column;align-items:center;gap:4px";
      div.dataset.slipId = slip.id;
      var isPdf = (slip.mimeType || "").includes("pdf");
      if (isPdf) {
        var pd = document.createElement("div");
        pd.style.cssText = "width:80px;height:80px;border-radius:6px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:24px;background:#f7f7f9";
        pd.textContent = "📄"; div.appendChild(pd);
      } else {
        var img = document.createElement("img");
        img.src = slip.url + "?t=" + Date.now();
        img.style.cssText = "width:80px;height:80px;border-radius:6px;border:1px solid var(--line);object-fit:cover";
        img.setAttribute("data-auth-needed", "1");
        div.appendChild(img);
        fetch(slip.url, { headers: authHeaders() }).then(function(r) { return r.blob(); }).then(function(b) {
          img.src = URL.createObjectURL(b);
        }).catch(function(){});
      }
      var label = document.createElement("span");
      label.style.cssText = "font-size:10px;color:var(--muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center";
      label.textContent = slip.originalName || ("slip " + slip.id);
      div.appendChild(label);
      var delBtn = document.createElement("button");
      delBtn.style.cssText = "position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#ef4444;color:#fff;font-size:12px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", async function() {
        if (!await showDialog({icon:'danger',title:'ลบ Slip',message:'ลบ slip นี้?',confirmText:'ลบ'})) return;
        try {
          var r = await fetch("/admin/orders/" + encodeURIComponent(editingOrderId) + "/extra-slips/" + slip.id, {
            method: "DELETE", headers: authHeaders()
          });
          if (!r.ok) throw new Error(await r.text());
          div.remove();
        } catch(e) { await showDialog({type:'alert',icon:'info',title:'ลบไม่สำเร็จ',message:e.message}); }
      });
      div.appendChild(delBtn);
      container.appendChild(div);
    }

    async function loadExtraSlips(orderId) {
      var container = document.querySelector("#oe_extraSlipsList");
      if (!container) return;
      container.innerHTML = '<span style="font-size:12px;color:var(--muted)">Loading...</span>';
      try {
        var r = await fetch("/admin/orders/" + encodeURIComponent(orderId) + "/extra-slips", { headers: authHeaders() });
        if (!r.ok) throw new Error(await r.text());
        var slips = await r.json();
        container.innerHTML = "";
        if (!slips.length) {
          container.innerHTML = '<span style="font-size:12px;color:var(--muted)">No additional slips</span>';
        } else {
          slips.forEach(function(s) { renderExtraSlip(s, container); });
        }
      } catch(e) {
        container.innerHTML = '<span style="font-size:12px;color:var(--danger)">' + esc(e.message) + '</span>';
      }
    }

    document.querySelector("#oe_addExtraSlipBtn").addEventListener("click", async function() {
      var fileInput = document.querySelector("#oe_extraSlipFile");
      var notice = document.querySelector("#oe_extraSlipNotice");
      if (!editingOrderId || !fileInput.files || !fileInput.files[0]) {
        notice.textContent = "Please select a file first"; return;
      }
      notice.style.color = "var(--muted)"; notice.textContent = "Uploading...";
      var formData = new FormData();
      formData.append("slip", fileInput.files[0]);
      try {
        var res = await fetch("/admin/orders/" + encodeURIComponent(editingOrderId) + "/extra-slips", {
          method: "POST", headers: { "Authorization": "Bearer " + tokenInput.value.trim() }, body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        var slip = await res.json();
        var container = document.querySelector("#oe_extraSlipsList");
        var emptyMsg = container.querySelector("span");
        if (emptyMsg) emptyMsg.remove();
        renderExtraSlip(slip, container);
        notice.style.color = "var(--ok)"; notice.textContent = "✓ Slip added";
        fileInput.value = "";
      } catch(e) {
        notice.style.color = "var(--danger)"; notice.textContent = e.message;
      }
    });

    document.querySelector("#saveOrderEditBtn").addEventListener("click", async function() {
      if (!editingOrderId) return;
      var notice = document.querySelector("#orderEditNotice");
      notice.textContent = "Saving...";
      var khantokVal = document.querySelector("#oe_khantokValue").value;
      var items = collectItems(editingOrderItems);
      var payload = {
        fullName: document.querySelector("#oe_fullName").value,
        studentCode: document.querySelector("#oe_studentCode").value,
        phone: document.querySelector("#oe_phone").value,
        parentPhone: document.querySelector("#oe_parentPhone").value,
        school: document.querySelector("#oe_school").value,
        email: document.querySelector("#oe_email").value,
        khantokTicket: document.querySelector("#oe_khantokTicket").checked,
        khantokTicketAlreadyClaimed: document.querySelector("#oe_khantokClaimed").checked,
        khantokTicketValue: khantokVal !== "" ? parseInt(khantokVal, 10) : null,
        items: items,
        adminNote: document.querySelector("#oe_adminNote").value,
      };
      try {
        var res = await fetch("/admin/orders/" + encodeURIComponent(editingOrderId), {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        notice.textContent = "";
        closeOrderEdit();
        await loadOrders();
        setOrdersNotice("Saved — " + editingOrderId);
      } catch(e) {
        notice.textContent = e.message;
      }
    });

    function renderPagination() {
      var el = document.querySelector("#paginationBar");
      if (!el) return;
      el.innerHTML = '<button class="ghost" id="prevPageBtn"' + (currentPage <= 1 ? ' disabled' : '') + '>← Prev</button>' +
        '<span style="font-size:13px;color:var(--muted)">Page ' + currentPage + ' / ' + totalPages + ' (' + totalOrders + ' orders)</span>' +
        '<button class="ghost" id="nextPageBtn"' + (currentPage >= totalPages ? ' disabled' : '') + '>Next →</button>';
      var prev = document.querySelector("#prevPageBtn");
      var next = document.querySelector("#nextPageBtn");
      if (prev) prev.addEventListener("click", function() { if (currentPage > 1) { currentPage--; loadOrders(); } });
      if (next) next.addEventListener("click", function() { if (currentPage < totalPages) { currentPage++; loadOrders(); } });
    }

    function getSelectedOrderIds() {
      return Array.from(document.querySelectorAll(".orderCheckbox:checked")).map(function(cb) { return cb.dataset.oid; });
    }

    function updateBulkBar() {
      var selected = getSelectedOrderIds();
      var bar = document.querySelector("#bulkBar");
      var countEl = document.querySelector("#bulkCount");
      if (bar) bar.style.display = selected.length ? "flex" : "none";
      if (countEl) countEl.textContent = selected.length + " selected";
    }

    async function loadOrders() {
      setOrdersNotice("Loading...");
      var search = document.querySelector("#searchInput").value.trim();
      var studentCodeF = document.querySelector("#studentCodeInput").value.trim();
      var statusF = document.querySelector("#statusFilter").value;
      var url = "/admin/orders?page=" + currentPage + "&per_page=50";
      if (search) url += "&search=" + encodeURIComponent(search);
      if (studentCodeF) url += "&studentCode=" + encodeURIComponent(studentCodeF);
      if (statusF) url += "&status=" + encodeURIComponent(statusF);
      if (currentRound > 0) url += "&round=" + currentRound;
      try {
        var res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();
        allOrders = data.orders || [];
        serverSummary = data.summary || {};
        totalOrders = data.total || 0;
        totalPages = data.pages || 1;
        renderOrderStats(serverSummary);
        renderOrders();
        setOrdersNotice("Page " + currentPage + "/" + totalPages + " — " + totalOrders + " total orders");
      } catch(e) { setOrdersNotice(e.message, true); }
    }

    async function patchStatus(orderId, status) {
      var res = await fetch("/admin/orders/" + encodeURIComponent(orderId) + "/status", {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status: status })
      });
      if (!res.ok) throw new Error(await res.text());
    }

    async function viewSlip(orderId, totalAmount) {
      var modal = document.querySelector("#slipModal");
      var content = document.querySelector("#slipModalContent");
      document.querySelector("#slipModalTitle").textContent = "Slip — " + orderId;
      document.querySelector("#slipModalAmount").textContent = baht(totalAmount);
      content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Loading...</p>';
      modal.classList.add("open");
      try {
        var authHeaders = { "Authorization": "Bearer " + tokenInput.value.trim() };
        var results = await Promise.all([
          fetch("/admin/orders/" + encodeURIComponent(orderId) + "/slip", { headers: authHeaders }),
          fetch("/admin/orders/" + encodeURIComponent(orderId) + "/slip-check", { headers: authHeaders }).catch(function() { return null; })
        ]);
        var slipRes = results[0], ocrRes = results[1];
        if (!slipRes.ok) throw new Error(await slipRes.text());
        var blob = await slipRes.blob();
        var url = URL.createObjectURL(blob);
        var slipHtml = blob.type === "application/pdf"
          ? '<iframe src="' + url + '" style="width:100%;height:500px;border:0;border-radius:8px"></iframe>'
          : '<img src="' + url + '" style="max-width:100%;border-radius:8px" />';
        setTimeout(function() { URL.revokeObjectURL(url); }, 120000);

        var ocrHtml = '';
        if (ocrRes && ocrRes.ok) {
          var ocr = await ocrRes.json();
          var statusColors = { approved: 'var(--ok)', duplicate: 'var(--warn)', rejected: 'var(--danger)', amount_mismatch: 'var(--warn)', error: 'var(--danger)', pending: 'var(--muted)', skipped: 'var(--muted)' };
          var statusLabels = { approved: '✓ ผ่าน', duplicate: '⚠ สลิปซ้ำ', rejected: '✗ ไม่ใช่สลิป', amount_mismatch: '⚠ เงินไม่ตรง', error: '! OCR Error', pending: '⏳ กำลังตรวจ...', skipped: '— ข้าม (PDF)' };
          var sc = statusColors[ocr.status] || 'var(--muted)';
          var sl = statusLabels[ocr.status] || ocr.status;
          ocrHtml = '<div style="border:1px solid var(--line);border-radius:10px;padding:16px;font-size:13px">'
            + '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">OCR Result</div>'
            + '<div style="font-weight:700;color:' + sc + ';font-size:15px;margin-bottom:12px">' + sl + '</div>';
          if (ocr.ref_number) ocrHtml += '<div style="margin-bottom:8px"><div style="color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Ref No.</div><div style="word-break:break-all;font-weight:600;margin-top:2px">' + esc(ocr.ref_number) + '</div></div>';
          if (ocr.amount != null) ocrHtml += '<div style="margin-bottom:8px"><div style="color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Amount</div><div style="font-weight:700;color:var(--accent);margin-top:2px">' + baht(ocr.amount) + '</div></div>';
          if (ocr.bank) ocrHtml += '<div style="margin-bottom:8px"><div style="color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Bank</div><div style="font-weight:600;margin-top:2px">' + esc(ocr.bank) + '</div></div>';
          if (ocr.sender) ocrHtml += '<div style="margin-bottom:8px"><div style="color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Sender</div><div style="margin-top:2px">' + esc(ocr.sender) + '</div></div>';
          if (ocr.date) ocrHtml += '<div style="margin-bottom:8px"><div style="color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Date</div><div style="margin-top:2px">' + esc(ocr.date) + '</div></div>';
          if (ocr.duplicate_of) {
            ocrHtml += '<div style="margin-top:12px;padding:12px;background:#fff7ed;border-radius:8px;border:1px solid #fed7aa">'
              + '<div style="font-weight:700;color:var(--warn);margin-bottom:4px">⚠ ซ้ำกับออเดอร์ ' + esc(ocr.duplicate_of) + '</div>'
              + '<div style="font-size:12px;color:var(--muted)">ref number นี้เคยใช้ในออเดอร์อื่นแล้ว กรุณาตรวจสอบก่อนอนุมัติ</div>'
              + '</div>';
          }
          if (ocr.raw_reason && ocr.status !== 'approved') ocrHtml += '<div style="margin-top:8px;font-size:12px;color:var(--muted)">' + esc(ocr.raw_reason) + '</div>';
          if (ocr.checked_at) ocrHtml += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)">ตรวจเมื่อ ' + esc(ocr.checked_at.slice(0,16).replace("T"," ")) + '</div>';
          ocrHtml += '</div>';
        } else {
          ocrHtml = '<div style="border:1px solid var(--line);border-radius:10px;padding:16px;font-size:13px;color:var(--muted);text-align:center">ยังไม่มีข้อมูล OCR</div>';
        }

        content.innerHTML = '<div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start">'
          + '<div>' + slipHtml + '</div>'
          + '<div>' + ocrHtml + '</div>'
          + '</div>';
      } catch(e) {
        content.innerHTML = '<p style="color:var(--danger);text-align:center">' + esc(e.message) + '</p>';
      }
    }

    document.querySelector("#refreshOrdersBtn").addEventListener("click", function() { currentPage = 1; loadOrders().catch(function(e) { setOrdersNotice(e.message, true); }); });

    document.querySelector("#exportCsvBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/orders/export.csv", { headers: { "Authorization": "Bearer " + tokenInput.value.trim() } });
        if (!res.ok) { await showDialog({type:'alert',icon:'info',title:'Export ไม่สำเร็จ',message:'Status: ' + res.status}); return; }
        var arrayBuf = await res.arrayBuffer();
        var blob = new Blob([arrayBuf], { type: "text/csv;charset=utf-8" });
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = blobUrl;
        a.download = "orders-" + new Date().toISOString().slice(0,10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 5000);
      } catch(e) { await showDialog({type:'alert',icon:'info',title:'Export Error',message:e.message}); }
    });
    document.querySelector("#searchInput").addEventListener("input", function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function() { currentPage = 1; loadOrders(); }, 400);
    });
    document.querySelector("#studentCodeInput").addEventListener("input", function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function() { currentPage = 1; loadOrders(); }, 400);
    });
    document.querySelector("#statusFilter").addEventListener("change", function() { currentPage = 1; loadOrders(); });

    document.addEventListener("click", async function(e) {
      if (e.target.id === "selectAllOrders") {
        document.querySelectorAll(".orderCheckbox").forEach(function(cb) { cb.checked = e.target.checked; });
        updateBulkBar();
        return;
      }
      if (e.target.closest(".orderCheckbox")) { updateBulkBar(); return; }

      var statusBtn = e.target.closest(".statusBtn");
      if (statusBtn) {
        var oid = statusBtn.dataset.oid;
        var newStatus = statusBtn.dataset.status;
        if (newStatus === "rejected" && !await showDialog({icon:'danger',title:'ปฏิเสธออเดอร์',message:'ปฏิเสธออเดอร์ ' + oid + '?',confirmText:'ปฏิเสธ'})) return;
        if (newStatus === "cancelled" && !await showDialog({icon:'warn',title:'ยกเลิกออเดอร์',message:'ยกเลิกออเดอร์ ' + oid + '?',confirmText:'ยกเลิกออเดอร์'})) return;
        try { await patchStatus(oid, newStatus); setOrdersNotice("Updated " + oid + " → " + newStatus); await loadOrders(); }
        catch(err) { setOrdersNotice(err.message, true); }
        return;
      }
      var editOrderBtn = e.target.closest(".editOrderBtn");
      if (editOrderBtn) {
        var oid = editOrderBtn.dataset.oid;
        if (editingOrderId === oid) { closeOrderEdit(); return; }
        var order = allOrders.find(function(o) { return o.id === oid; });
        if (order) openOrderEdit(order);
        return;
      }

      var slipBtn = e.target.closest(".slipBtn");
      if (slipBtn) { viewSlip(slipBtn.dataset.oid, slipBtn.dataset.total).catch(function(err) { setOrdersNotice(err.message, true); }); return; }

      var confirmPayBtn = e.target.closest(".confirmPayBtn");
      if (confirmPayBtn) {
        var oid = confirmPayBtn.dataset.oid;
        if (!await showDialog({icon:'warn',title:'ยืนยันการชำระเงิน',message:'ยืนยันการชำระเงินออเดอร์ ' + oid + '?',confirmText:'ยืนยัน'})) return;
        try { await patchStatus(oid, "paid"); setOrdersNotice("✓ ยืนยันแล้ว — " + oid); await loadOrders(); }
        catch(err) { setOrdersNotice(err.message, true); }
        return;
      }
    });

    document.addEventListener("change", async function(e) {
      var sel = e.target.closest(".statusSelect");
      if (!sel) return;
      var oid = sel.dataset.oid;
      var newStatus = sel.value;
      if (!newStatus) return;
      if (newStatus === "rejected" && !await showDialog({icon:'danger',title:'ปฏิเสธออเดอร์',message:'ปฏิเสธออเดอร์ ' + oid + '?',confirmText:'ปฏิเสธ'})) { await loadOrders(); return; }
      if (newStatus === "cancelled" && !await showDialog({icon:'warn',title:'ยกเลิกออเดอร์',message:'ยกเลิกออเดอร์ ' + oid + '?',confirmText:'ยกเลิก'})) { await loadOrders(); return; }
      try { await patchStatus(oid, newStatus); setOrdersNotice("Updated " + oid + " → " + newStatus); await loadOrders(); }
      catch(err) { setOrdersNotice(err.message, true); await loadOrders(); }
    });

    document.querySelector("#bulkApplyBtn").addEventListener("click", async function() {
      var ids = getSelectedOrderIds();
      var status = document.querySelector("#bulkStatusSelect").value;
      if (!ids.length || !status) { await showDialog({type:'alert',icon:'info',title:'เลือกออเดอร์และสถานะ',message:'กรุณาเลือกออเดอร์และสถานะที่ต้องการเปลี่ยน'}); return; }
      if (!await showDialog({icon:'warn',title:'เปลี่ยนสถานะ',message:'เปลี่ยน ' + ids.length + ' ออเดอร์ เป็น "' + status + '"?',confirmText:'ยืนยัน'})) return;
      try {
        var res = await fetch("/admin/orders/bulk-status", {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify({ orderIds: ids, status: status })
        });
        if (!res.ok) throw new Error(await res.text());
        var result = await res.json();
        setOrdersNotice("Bulk: updated " + result.updated.length + (result.failed.length ? ", failed " + result.failed.length : ""));
        document.querySelector("#bulkStatusSelect").value = "";
        await loadOrders();
      } catch(e) { setOrdersNotice(e.message, true); }
    });
    document.querySelector("#bulkClearBtn").addEventListener("click", function() {
      document.querySelectorAll(".orderCheckbox").forEach(function(cb) { cb.checked = false; });
      var all = document.querySelector("#selectAllOrders");
      if (all) all.checked = false;
      updateBulkBar();
    });

    document.querySelector("#closeSlipBtn").addEventListener("click", function() {
      document.querySelector("#slipModal").classList.remove("open");
      document.querySelector("#slipModalContent").innerHTML = "";
    });
    document.querySelector("#slipModal").addEventListener("click", function(e) {
      if (e.target === this) {
        this.classList.remove("open");
        document.querySelector("#slipModalContent").innerHTML = "";
      }
    });

    // ── BREAKDOWN MODAL ────────────────────────────────────────────────────────
    var BREAKDOWN_LABELS = { single: "โปโล — แยกตามไซซ์", jacket: "แจ็คเก็ต — แยกตามไซซ์ / สี", headband: "Headband — แยกตามสำนักวิชา" };

    async function openBreakdownModal(category) {
      var modal = document.querySelector("#breakdownModal");
      var content = document.querySelector("#breakdownModalContent");
      document.querySelector("#breakdownModalTitle").textContent = BREAKDOWN_LABELS[category] || category;
      content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Loading...</p>';
      modal.classList.add("open");
      try {
        var breakdownUrl = "/admin/product-breakdown?category=" + encodeURIComponent(category) + (currentRound > 0 ? "&round=" + currentRound : "");
        var res = await fetch(breakdownUrl, { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();

        function renderFlatTable(rows) {
          if (!rows || !rows.length) return '<p style="color:var(--muted);text-align:center;padding:24px">ไม่มีข้อมูล</p>';
          var total = rows.reduce(function(s, r) { return s + r.count; }, 0);
          var maxCount = Math.max.apply(null, rows.map(function(r) { return r.count; }));
          return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
            '<thead><tr style="border-bottom:2px solid var(--line)"><th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.08em">รายการ</th><th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.08em">จำนวน</th><th style="text-align:right;padding:6px 8px;font-size:11px;color:var(--muted);font-weight:700;letter-spacing:.08em">%</th></tr></thead>' +
            '<tbody>' + rows.map(function(r) {
              var pct = total ? Math.round(r.count / total * 100) : 0;
              var barW = maxCount ? Math.round(r.count / maxCount * 60) : 0;
              return '<tr style="border-bottom:1px solid var(--line)">' +
                '<td style="padding:8px 8px"><div style="display:flex;align-items:center;gap:8px"><div style="width:' + barW + 'px;height:6px;background:var(--accent);border-radius:3px;min-width:2px"></div>' + esc(r.label) + '</div></td>' +
                '<td style="padding:8px 8px;text-align:right;font-weight:700">' + r.count.toLocaleString() + '</td>' +
                '<td style="padding:8px 8px;text-align:right;color:var(--muted)">' + pct + '%</td>' +
              '</tr>';
            }).join('') +
            '<tr style="border-top:2px solid var(--line)"><td style="padding:8px 8px;font-weight:700">รวม</td><td style="padding:8px 8px;text-align:right;font-weight:700">' + total.toLocaleString() + '</td><td></td></tr>' +
            '</tbody></table>';
        }

        if (data.groups) {
          // Jacket grouped by color
          if (!data.groups.length) { content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">ไม่มีข้อมูล</p>'; return; }
          var grandTotal = data.groups.reduce(function(s, g) { return s + g.total; }, 0);
          content.innerHTML = data.groups.map(function(g) {
            return '<div style="margin-bottom:20px">' +
              '<div style="font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid var(--line)">' +
                esc(g.colorThai) + ' <span style="font-weight:400;color:var(--muted)">(' + g.total.toLocaleString() + ' ตัว)</span>' +
              '</div>' +
              renderFlatTable(g.rows) +
            '</div>';
          }).join('') +
          '<div style="padding:10px 8px;font-size:14px;font-weight:700;border-top:2px solid var(--line)">รวมทั้งหมด <span style="float:right">' + grandTotal.toLocaleString() + ' ตัว</span></div>';
        } else {
          content.innerHTML = renderFlatTable(data.rows || []);
        }
      } catch(e) {
        content.innerHTML = '<p style="color:var(--danger);text-align:center;padding:24px">' + esc(e.message) + '</p>';
      }
    }

    document.querySelector("#closeBreakdownBtn").addEventListener("click", function() {
      document.querySelector("#breakdownModal").classList.remove("open");
    });
    document.querySelector("#breakdownModal").addEventListener("click", function(e) {
      if (e.target === this) this.classList.remove("open");
    });
    document.addEventListener("click", function(e) {
      var el = e.target.closest("[data-breakdown]");
      if (el) openBreakdownModal(el.dataset.breakdown);
    });

    // ── PRODUCTS ───────────────────────────────────────────────────────────────
    var allProducts = [];

    function setProductsNotice(msg, err) {
      var el = document.querySelector("#productsNotice");
      el.textContent = msg;
      el.style.color = err ? "var(--danger)" : "var(--muted)";
    }

    function renderProducts() {
      document.querySelector("#productsGrid").innerHTML = allProducts.map(function(p) {
        var imgSrc = p.image && p.image.startsWith("/") ? "https://sumfu.store" + p.image : (p.image || "");
        return '<div class="product-card' + (p.available ? "" : " unavailable") + '" data-slug="' + esc(p.slug) + '">' +
          '<img class="product-img" src="' + esc(imgSrc) + '" alt="' + esc(p.name) + '" onerror="this.style.background=\'#eee\'" />' +
          '<div class="product-body">' +
            '<div class="product-name">' + esc(p.name) + '</div>' +
            '<div class="product-meta">' + esc(p.shortName) + ' · ' + esc(p.category) + '</div>' +
            '<div class="product-price">' + baht(p.price) + '</div>' +
            '<div class="product-actions">' +
              '<label class="toggle" title="' + (p.available ? "Available" : "Unavailable") + '">' +
                '<input type="checkbox" class="availToggle" data-slug="' + esc(p.slug) + '"' + (p.available ? " checked" : "") + ' />' +
                '<span class="toggle-track"></span><span class="toggle-thumb"></span>' +
              '</label>' +
              '<small style="color:var(--muted);flex:1">' + (p.available ? "Available" : "Unavailable") + '</small>' +
              '<button class="ghost editProductBtn" data-slug="' + esc(p.slug) + '" style="font-size:12px;min-height:32px;padding:0 10px">Edit</button>' +
              '<button class="ghost uploadImageBtn" data-slug="' + esc(p.slug) + '" style="font-size:12px;min-height:32px;padding:0 10px" title="Upload Image">📷</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    async function loadProducts() {
      setProductsNotice("Loading...");
      try {
        var res = await fetch("/products", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        allProducts = await res.json();
        renderProducts();
        setProductsNotice(allProducts.length + " products");
      } catch(e) { setProductsNotice(e.message, true); }
    }

    document.querySelector("#refreshProductsBtn").addEventListener("click", loadProducts);

    document.addEventListener("change", async function(e) {
      var toggle = e.target.closest(".availToggle");
      if (!toggle) return;
      var slug = toggle.dataset.slug;
      var available = toggle.checked;
      try {
        var res = await fetch("/admin/products/" + encodeURIComponent(slug) + "/available", {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify({ available: available })
        });
        if (!res.ok) throw new Error(await res.text());
        var updated = await res.json();
        var idx = allProducts.findIndex(function(p) { return p.slug === slug; });
        if (idx !== -1) allProducts[idx] = updated;
        renderProducts();
        setProductsNotice(slug + " is now " + (available ? "available" : "unavailable"));
      } catch(e) { toggle.checked = !available; setProductsNotice(e.message, true); }
    });

    var editModal = document.querySelector("#editModal");
    document.addEventListener("click", function(e) {
      var editBtn = e.target.closest(".editProductBtn");
      if (editBtn) {
        var p = allProducts.find(function(x) { return x.slug === editBtn.dataset.slug; });
        if (!p) return;
        document.querySelector("#editSlug").value = p.slug;
        document.querySelector("#editName").value = p.name;
        document.querySelector("#editShortName").value = p.shortName;
        document.querySelector("#editPrice").value = p.price;
        document.querySelector("#editTagline").value = p.tagline;
        document.querySelector("#editDescription").value = p.description;
        document.querySelector("#editNotice").textContent = "";
        editModal.classList.add("open");
        return;
      }
      if (e.target === editModal) editModal.classList.remove("open");
    });
    document.querySelector("#cancelEditBtn").addEventListener("click", function() { editModal.classList.remove("open"); });
    document.querySelector("#saveEditBtn").addEventListener("click", async function() {
      var slug = document.querySelector("#editSlug").value;
      var payload = {
        name: document.querySelector("#editName").value,
        shortName: document.querySelector("#editShortName").value,
        price: parseInt(document.querySelector("#editPrice").value, 10),
        tagline: document.querySelector("#editTagline").value,
        description: document.querySelector("#editDescription").value,
      };
      try {
        var res = await fetch("/admin/products/" + encodeURIComponent(slug), {
          method: "PUT", headers: authHeaders(), body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        var updated = await res.json();
        var idx = allProducts.findIndex(function(p) { return p.slug === slug; });
        if (idx !== -1) allProducts[idx] = updated;
        renderProducts();
        editModal.classList.remove("open");
        setProductsNotice("Saved " + slug);
      } catch(err) { document.querySelector("#editNotice").textContent = err.message; }
    });

    var imageModal = document.querySelector("#imageModal");
    document.addEventListener("click", function(e) {
      var uploadBtn = e.target.closest(".uploadImageBtn");
      if (uploadBtn) {
        document.querySelector("#imageSlug").value = uploadBtn.dataset.slug;
        document.querySelector("#imageFile").value = "";
        document.querySelector("#imagePreviewWrap").style.display = "none";
        document.querySelector("#imageNotice").textContent = "";
        imageModal.classList.add("open");
        return;
      }
      if (e.target === imageModal) imageModal.classList.remove("open");
    });
    document.querySelector("#imageFile").addEventListener("change", function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      document.querySelector("#imagePreview").src = url;
      document.querySelector("#imagePreviewWrap").style.display = "block";
    });
    document.querySelector("#cancelImageBtn").addEventListener("click", function() { imageModal.classList.remove("open"); });
    document.querySelector("#uploadImageBtn").addEventListener("click", async function() {
      var slug = document.querySelector("#imageSlug").value;
      var file = document.querySelector("#imageFile").files[0];
      if (!file) { document.querySelector("#imageNotice").textContent = "Please select an image"; return; }
      var formData = new FormData();
      formData.append("image", file, file.name);
      try {
        var res = await fetch("/admin/products/" + encodeURIComponent(slug) + "/image", {
          method: "POST",
          headers: { "Authorization": "Bearer " + tokenInput.value.trim() },
          body: formData
        });
        if (!res.ok) throw new Error(await res.text());
        var updated = await res.json();
        var idx = allProducts.findIndex(function(p) { return p.slug === slug; });
        if (idx !== -1) allProducts[idx] = updated;
        renderProducts();
        imageModal.classList.remove("open");
        setProductsNotice("Image updated for " + slug);
      } catch(err) { document.querySelector("#imageNotice").textContent = err.message; }
    });

    // ── ANALYTICS ─────────────────────────────────────────────────────────────
    function setAnalyticsNotice(msg, err) {
      var el = document.querySelector("#analyticsNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }
    function renderDailyChart(container, items) {
      if (!container || !items.length) return;
      var maxVal = Math.max.apply(null, items.map(function(i) { return i[1]; })) || 1;
      var CHART_H = 110, LABEL_H = 28, GAP = 2;
      var containerW = container.clientWidth || 800;
      var BAR_W = Math.max(10, Math.floor((containerW - GAP * (items.length - 1)) / items.length));
      var svgW = containerW;
      var svgH = CHART_H + LABEL_H;
      var skipLabel = BAR_W < 22 ? Math.ceil(22 / BAR_W) : 1;
      var bars = items.map(function(item, idx) {
        var parts = (item[0] || '').split('-');
        var label = parts.length === 3 ? parts[2] + '/' + parts[1] : esc(item[0]);
        var barH = Math.max(item[1] > 0 ? 2 : 0, Math.round(item[1] / maxVal * CHART_H));
        var x = idx * (BAR_W + GAP);
        var y = CHART_H - barH;
        var countLabel = barH > 14
          ? '<text x="' + (x + BAR_W / 2) + '" y="' + (y + 11) + '" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">' + item[1] + '</text>'
          : '<text x="' + (x + BAR_W / 2) + '" y="' + (y - 3) + '" text-anchor="middle" font-size="9" fill="#999">' + (barH > 0 ? item[1] : '') + '</text>';
        var dateLabel = idx % skipLabel === 0
          ? '<text x="' + (x + BAR_W / 2) + '" y="' + (svgH - 2) + '" text-anchor="middle" font-size="8" fill="#999">' + label + '</text>'
          : '';
        var delay = (idx * 0.015).toFixed(3);
        return '<g>' +
          '<title>' + esc(item[0]) + ': ' + item[1] + ' ออเดอร์</title>' +
          '<rect x="' + x + '" y="' + CHART_H + '" width="' + BAR_W + '" height="0" fill="#4f6ef7" rx="3">' +
          '<animate attributeName="height" from="0" to="' + barH + '" dur="0.5s" begin="' + delay + 's" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1"/>' +
          '<animate attributeName="y" from="' + CHART_H + '" to="' + y + '" dur="0.5s" begin="' + delay + 's" fill="freeze" calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1"/>' +
          '</rect>' +
          countLabel + dateLabel +
        '</g>';
      }).join('');
      container.innerHTML = '<svg width="' + svgW + '" height="' + svgH + '" style="display:block">' +
        '<line x1="0" y1="' + CHART_H + '" x2="' + svgW + '" y2="' + CHART_H + '" stroke="#e5e7eb" stroke-width="1"/>' +
        bars +
      '</svg>';
    }
    function renderBarChart(container, items, maxVal) {
      if (!container) return;
      container.innerHTML = items.map(function(item) {
        var pct = maxVal ? Math.round(item[1] / maxVal * 100) : 0;
        return '<div class="bar-row">' +
          '<div class="bar-label" title="' + esc(item[0]) + '">' + esc(item[0]) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="' + pct + '"></div></div>' +
          '<div class="bar-count">' + item[1] + '</div></div>';
      }).join("");
      requestAnimationFrame(function() {
        container.querySelectorAll('.bar-fill').forEach(function(el) {
          el.style.width = el.getAttribute('data-pct') + '%';
        });
      });
    }
    async function loadAnalytics() {
      setAnalyticsNotice("Loading...");
      try {
        var res = await fetch("/admin/analytics", { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var d = await res.json();
        document.querySelector("#analyticsGrid").innerHTML =
          '<div class="analytics-card" style="grid-column:1/-1">' +
            '<div class="stats" style="margin:0">' +
              '<div class="stat"><span>คำสั่งซื้อทั้งหมด</span><strong id="anTotal">' + d.total + '</strong></div>' +
              '<div class="stat"><span>รายได้ที่ยืนยันแล้ว</span><strong id="anRevenue">' + baht(d.revenue) + '</strong></div>' +
              '<div class="stat"><span>คณะ</span><strong id="anSchool">' + d.schoolCount + '</strong></div>' +
              '<div class="stat"><span style="color:var(--ok)">กำไรสุทธิ (~ประมาณ)</span><strong id="anProfit" style="color:var(--ok)">' + baht(d.profit) + '</strong></div>' +
            '</div>' +
          '</div>' +
          '<div class="analytics-card" style="grid-column:1/-1"><h3>ออเดอร์รายวัน</h3><div id="dailyChart"></div></div>' +
          '<div class="analytics-card"><h3>By School</h3><div id="schoolChart"></div></div>' +
          '<div class="analytics-card"><h3>By Product</h3><div id="productChart"></div></div>' +
          '<div class="analytics-card"><h3>By Status</h3><div id="statusChart"></div></div>' +
          '<div class="analytics-card"><h3>By Size</h3><div id="sizeChart"></div></div>';
        var maxS = d.bySchool[0] ? d.bySchool[0][1] : 1;
        var maxP = d.byProduct[0] ? d.byProduct[0][1] : 1;
        var maxSt = d.byStatus[0] ? d.byStatus[0][1] : 1;
        var maxSz = d.bySize[0] ? d.bySize[0][1] : 1;
        renderDailyChart(document.querySelector("#dailyChart"), d.byDay || []);
        renderBarChart(document.querySelector("#schoolChart"), d.bySchool, maxS);
        renderBarChart(document.querySelector("#productChart"), d.byProduct, maxP);
        renderBarChart(document.querySelector("#statusChart"), d.byStatus, maxSt);
        renderBarChart(document.querySelector("#sizeChart"), d.bySize, maxSz);
        setAnalyticsNotice("Loaded from " + d.total + " orders");
      } catch(e) { setAnalyticsNotice(e.message, true); }
    }
    document.querySelector("#refreshAnalyticsBtn").addEventListener("click", function() {
      loadAnalytics().catch(function(e) { setAnalyticsNotice(e.message, true); });
    });

    // ── SETTINGS ──────────────────────────────────────────────────────────────
    function setSettingsNotice(msg, err) {
      var el = document.querySelector("#settingsNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }

    var currentPhaseOverride = null;
    var currentPhaseConfigs = {};
    var phaseDialogPhaseNum = null;
    var phaseDialogMode = null;

    function formatPhaseDate(dateStr) {
      if (!dateStr) return '';
      try {
        var d = new Date(dateStr + 'T00:00:00');
        var M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        return d.getDate() + ' ' + M[d.getMonth()];
      } catch(e2) { return dateStr; }
    }

    function openPhaseDialog(phaseNum, isNew) {
      phaseDialogMode = isNew ? 'add' : 'edit';
      phaseDialogPhaseNum = phaseNum;
      document.querySelector("#phaseDialogTitle").textContent = isNew ? 'เพิ่ม Phase ' + phaseNum : 'แก้ไข Phase ' + phaseNum;
      var cfg = currentPhaseConfigs[String(phaseNum)] || {};
      document.querySelector("#phaseStartDate").value = cfg.start || '';
      document.querySelector("#phaseEndDate").value = cfg.end || '';
      document.querySelector("#phaseDialog").style.display = "flex";
    }

    function renderPhase(s) {
      var override = s.phaseOverride;
      var current = s.currentPhase;
      var configs = s.phaseConfigs || {};
      var maxPhase = 0;
      Object.keys(configs).forEach(function(k) { maxPhase = Math.max(maxPhase, parseInt(k, 10) || 0); });
      if (maxPhase < 1) maxPhase = 3;
      currentPhaseOverride = override;
      currentPhaseConfigs = configs;

      var phaseDisplay = document.querySelector("#phaseDisplay");
      if (phaseDisplay) phaseDisplay.textContent = "Phase " + current;
      var phaseLabel = document.querySelector("#phaseLabel");
      if (phaseLabel) phaseLabel.textContent = override !== null && override !== undefined
        ? "(Override)"
        : "(อัตโนมัติตามวันที่)";

      var sel = document.querySelector("#phaseSelectBtns");
      if (sel) {
        var html = '';
        var autoActive = override === null || override === undefined;
        html += '<button class="' + (autoActive ? 'primary' : 'secondary') + ' phase-sel-btn" data-phase="null" style="font-size:12px;padding:6px 14px">Auto</button>';
        for (var i = 1; i <= maxPhase; i++) {
          var isActive = !autoActive && override === i;
          html += '<button class="' + (isActive ? 'primary' : 'secondary') + ' phase-sel-btn" data-phase="' + i + '" style="font-size:12px;padding:6px 14px">Phase ' + i + '</button>';
        }
        sel.innerHTML = html;
        sel.querySelectorAll(".phase-sel-btn").forEach(function(btn) {
          btn.addEventListener("click", function() {
            var val = this.dataset.phase === "null" ? null : parseInt(this.dataset.phase, 10);
            patchPhase(val);
          });
        });
      }

      var container = document.querySelector("#phaseBtnContainer");
      if (!container) return;

      var fhtml = '<button class="ghost phase-btn' + (currentRound === 0 ? ' active-phase' : '') + '" data-round="0" style="min-height:30px;font-size:12px;padding:4px 12px">All</button>';
      for (var j = 1; j <= maxPhase; j++) {
        var cfg = configs[String(j)] || {};
        var dateLabel = '';
        if (cfg.start && cfg.end) dateLabel = formatPhaseDate(cfg.start) + '–' + formatPhaseDate(cfg.end);
        else if (cfg.start) dateLabel = 'เริ่ม ' + formatPhaseDate(cfg.start);
        var activeDot = (j === current) ? '<span style="color:var(--accent);font-size:9px;vertical-align:middle;margin-left:3px">●</span>' : '';
        var dateSub = dateLabel ? '<span style="font-size:10px;color:var(--muted);margin-left:4px">' + dateLabel + '</span>' : '';
        var editIcon = '<span class="phase-edit-icon" data-phase="' + j + '" title="แก้ไขวันที่" style="margin-left:5px;opacity:0;font-size:11px;cursor:pointer;transition:opacity .15s;color:var(--accent)">✎</span>';
        fhtml += '<button class="ghost phase-btn' + (currentRound === j ? ' active-phase' : '') + '" data-round="' + j + '" style="min-height:30px;font-size:12px;padding:4px 12px">'
          + 'Phase ' + j + activeDot + dateSub + editIcon + '</button>';
      }
      fhtml += '<button id="addPhaseBtn" class="ghost" style="min-height:30px;font-size:12px;padding:4px 14px;color:var(--accent);border-style:dashed;border-color:var(--accent)">+ Phase ' + (maxPhase + 1) + '</button>';
      container.innerHTML = fhtml;

      container.querySelectorAll(".phase-btn").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
          if (e.target.classList.contains("phase-edit-icon")) return;
          currentRound = parseInt(this.dataset.round, 10) || 0;
          container.querySelectorAll(".phase-btn").forEach(function(b) { b.classList.remove("active-phase"); });
          this.classList.add("active-phase");
          currentPage = 1;
          loadOrders().catch(function(e2) { setOrdersNotice(e2.message, true); });
        });
        var editIcon = btn.querySelector(".phase-edit-icon");
        if (editIcon) {
          btn.addEventListener("mouseenter", function() { editIcon.style.opacity = "1"; });
          btn.addEventListener("mouseleave", function() { editIcon.style.opacity = "0"; });
          editIcon.addEventListener("click", function(e) {
            e.stopPropagation();
            openPhaseDialog(parseInt(this.dataset.phase, 10), false);
          });
        }
      });

      var addBtn = container.querySelector("#addPhaseBtn");
      if (addBtn) addBtn.addEventListener("click", function() { openPhaseDialog(maxPhase + 1, true); });
    }

    document.querySelector("#phaseDialogCancelBtn").addEventListener("click", function() {
      document.querySelector("#phaseDialog").style.display = "none";
    });
    document.querySelector("#phaseDialog").addEventListener("click", function(e) {
      if (e.target === this) this.style.display = "none";
    });
    document.querySelector("#phaseDialogSaveBtn").addEventListener("click", async function() {
      var start = document.querySelector("#phaseStartDate").value;
      var end = document.querySelector("#phaseEndDate").value;
      var configs = Object.assign({}, currentPhaseConfigs);
      configs[String(phaseDialogPhaseNum)] = { start: start, end: end };
      var newMax = Math.max.apply(null, Object.keys(configs).map(function(k) { return parseInt(k, 10) || 0; }));
      var payload = { phaseConfigs: configs, maxPhases: newMax };
      if (phaseDialogMode === 'add') payload.phaseOverride = phaseDialogPhaseNum;
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        var s = await res.json();
        renderPhase(s);
        document.querySelector("#phaseDialog").style.display = "none";
        setOrdersNotice(phaseDialogMode === 'add' ? 'เพิ่ม Phase ' + phaseDialogPhaseNum + ' แล้ว และ set active' : 'อัปเดตวันที่ Phase ' + phaseDialogPhaseNum + ' แล้ว');
      } catch(e2) { await showDialog({type:'alert',icon:'info',title:'เกิดข้อผิดพลาด',message:e2.message}); }
    });

    async function patchPhase(value) {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ phaseOverride: value })
        });
        if (!res.ok) throw new Error(await res.text());
        var s = await res.json();
        renderPhase(s);
        setSettingsNotice("Phase " + (value !== null ? "set to " + value : "set to auto"));
      } catch(e) { setSettingsNotice(e.message, true); }
    }


    function renderSiteClosed(siteClosed) {
      var closeBtn = document.querySelector("#closeSiteBtn");
      var openBtn = document.querySelector("#openSiteBtn");
      var status = document.querySelector("#siteClosedStatus");
      if (siteClosed) {
        closeBtn.style.display = "none";
        openBtn.style.display = "";
        status.style.display = "";
      } else {
        closeBtn.style.display = "";
        openBtn.style.display = "none";
        status.style.display = "none";
      }
    }

    async function refreshActiveVisitors() {
      try {
        var res = await fetch("/site-status", { cache: "no-store" });
        if (!res.ok) return;
        var d = await res.json();
        document.querySelector("#activeVisitors").textContent = d.activeVisitors + " active visitor" + (d.activeVisitors !== 1 ? "s" : "");
      } catch(e) {}
    }

    // ── Daily Schedule ────────────────────────────────────────────────────────
    function setScheduleNotice(msg, err) {
      var el = document.querySelector("#scheduleNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }
    function renderScheduleStatus(enabled) {
      var el = document.querySelector("#scheduleStatusLabel");
      el.textContent = enabled ? "เปิด 06:00–22:59 ทุกวัน" : "ปิดการใช้งาน";
      el.style.color = enabled ? "var(--ok)" : "var(--muted)";
    }
    document.querySelector("#scheduleEnabled").addEventListener("change", function() {
      renderScheduleStatus(this.checked);
    });
    document.querySelector("#saveScheduleBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({
            scheduleEnabled: document.querySelector("#scheduleEnabled").checked,
            scheduleWarningMessage: document.querySelector("#scheduleWarningMsg").value,
          })
        });
        if (!res.ok) throw new Error(await res.text());
        var s = await res.json();
        renderScheduleStatus(s.scheduleEnabled === true);
        setScheduleNotice("Saved");
      } catch(e) { setScheduleNotice(e.message, true); }
    });
    document.querySelector("#testWarningBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/test-warning", { method: "POST", headers: authHeaders() });
        if (!res.ok) throw new Error(await res.text());
        document.querySelector("#testWarningBtn").style.display = "none";
        document.querySelector("#stopWarningBtn").style.display = "";
        setScheduleNotice("Test warning active for 60s — แถบจะปรากฏบนหน้าเว็บทันที");
        setTimeout(function() {
          document.querySelector("#testWarningBtn").style.display = "";
          document.querySelector("#stopWarningBtn").style.display = "none";
          setScheduleNotice("");
        }, 60000);
      } catch(e) { setScheduleNotice(e.message, true); }
    });
    document.querySelector("#stopWarningBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/stop-test-warning", { method: "POST", headers: authHeaders() });
        if (!res.ok) throw new Error(await res.text());
        document.querySelector("#testWarningBtn").style.display = "";
        document.querySelector("#stopWarningBtn").style.display = "none";
        setScheduleNotice("Test warning stopped");
      } catch(e) { setScheduleNotice(e.message, true); }
    });

    async function loadSettings() {
      try {
        var res = await fetch("/admin/site-settings", { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var s = await res.json();
        document.querySelector("#bannerText").value = s.announcementBanner || "";
        document.querySelector("#bannerEnabled").checked = s.announcementBannerEnabled === true;
        document.querySelector("#storeOpen").checked = s.storeOpen !== false;
        if (s.orderDeadline) document.querySelector("#orderDeadline").value = s.orderDeadline.slice(0,16);
        renderPhase(s);
        if (s.khantokQuota100 != null) document.querySelector("#khantokQuota100").value = s.khantokQuota100;
        if (s.khantokQuota50 != null) document.querySelector("#khantokQuota50").value = s.khantokQuota50;
        renderSiteClosed(s.siteClosed === true);
        document.querySelector("#scheduleEnabled").checked = s.scheduleEnabled === true;
        document.querySelector("#scheduleWarningMsg").value = s.scheduleWarningMessage || "";
        renderScheduleStatus(s.scheduleEnabled === true);
        if (s.beRightBackDates != null) document.querySelector("#beRightBackDates").value = s.beRightBackDates || "";
        renderBeRightBack(s.beRightBackActive === true);
        if (s.bypassToken) {
          var card = document.querySelector("#previewAccessCard");
          card.style.display = "";
          document.querySelector("#previewLinkMain").href = "https://sumfu.store/?token=" + s.bypassToken;
          document.querySelector("#previewLinkPreview").href = "https://store.sumfu.xyz/?token=" + s.bypassToken;
        }
        setSettingsNotice("Settings loaded");
        refreshActiveVisitors();
      } catch(e) { setSettingsNotice(e.message, true); }
    }

    // Close website button flow
    var confirmDialog = document.querySelector("#confirmCloseDialog");
    document.querySelector("#closeSiteBtn").addEventListener("click", function() {
      confirmDialog.style.display = "flex";
    });
    document.querySelector("#confirmCancelBtn").addEventListener("click", function() {
      confirmDialog.style.display = "none";
    });
    confirmDialog.addEventListener("click", function(e) {
      if (e.target === confirmDialog) confirmDialog.style.display = "none";
    });
    document.querySelector("#confirmCloseBtn").addEventListener("click", async function() {
      confirmDialog.style.display = "none";
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ siteClosed: true })
        });
        if (!res.ok) throw new Error(await res.text());
        renderSiteClosed(true);
        setSettingsNotice("Website closed");
      } catch(e) { setSettingsNotice(e.message, true); }
    });
    document.querySelector("#openSiteBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ siteClosed: false })
        });
        if (!res.ok) throw new Error(await res.text());
        renderSiteClosed(false);
        setSettingsNotice("Website opened");
      } catch(e) { setSettingsNotice(e.message, true); }
    });

    // ── BE RIGHT BACK ─────────────────────────────────────────────────────────
    function renderBeRightBack(active) {
      var btn = document.querySelector("#activateBeRightBackBtn");
      var deBtn = document.querySelector("#deactivateBeRightBackBtn");
      var status = document.querySelector("#beRightBackStatus");
      if (active) {
        btn.style.display = "none"; deBtn.style.display = ""; status.style.display = "";
      } else {
        btn.style.display = ""; deBtn.style.display = "none"; status.style.display = "none";
      }
    }
    function setBeRightBackNotice(msg, err) {
      var el = document.querySelector("#beRightBackNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }
    document.querySelector("#saveBeRightBackBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ beRightBackDates: document.querySelector("#beRightBackDates").value })
        });
        if (!res.ok) throw new Error(await res.text());
        setBeRightBackNotice("Dates saved");
        setTimeout(function() { setBeRightBackNotice(""); }, 3000);
      } catch(e) { setBeRightBackNotice(e.message, true); }
    });
    document.querySelector("#activateBeRightBackBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ beRightBackActive: true })
        });
        if (!res.ok) throw new Error(await res.text());
        renderBeRightBack(true);
        setBeRightBackNotice("Activated");
      } catch(e) { setBeRightBackNotice(e.message, true); }
    });
    document.querySelector("#deactivateBeRightBackBtn").addEventListener("click", async function() {
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(),
          body: JSON.stringify({ beRightBackActive: false })
        });
        if (!res.ok) throw new Error(await res.text());
        renderBeRightBack(false);
        setBeRightBackNotice("Deactivated");
      } catch(e) { setBeRightBackNotice(e.message, true); }
    });

    document.querySelector("#saveSettingsBtn").addEventListener("click", async function() {
      var payload = {
        announcementBanner: document.querySelector("#bannerText").value,
        announcementBannerEnabled: document.querySelector("#bannerEnabled").checked,
        storeOpen: document.querySelector("#storeOpen").checked,
        orderDeadline: document.querySelector("#orderDeadline").value || null,
        khantokQuota100: parseInt(document.querySelector("#khantokQuota100").value, 10) || 0,
        khantokQuota50: parseInt(document.querySelector("#khantokQuota50").value, 10) || 0,
        // siteClosed/phase managed via dedicated buttons, not the Save button
      };
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        setSettingsNotice("Settings saved");
      } catch(e) { setSettingsNotice(e.message, true); }
    });

    // ── AUDIT LOG ─────────────────────────────────────────────────────────────
    function setAuditNotice(msg, err) {
      var el = document.querySelector("#auditNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }
    async function loadAuditLog() {
      setAuditNotice("Loading...");
      var orderCode = (document.querySelector("#auditSearch").value || "").trim().toUpperCase();
      var url = "/admin/audit-log?limit=200" + (orderCode ? "&orderCode=" + encodeURIComponent(orderCode) : "");
      try {
        var res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();
        var log = data.log || [];
        document.querySelector("#auditBody").innerHTML = log.map(function(entry) {
          return '<tr>' +
            '<td><span class="muted">' + esc(entry.createdAt) + '</span></td>' +
            '<td><strong>' + esc(entry.orderCode) + '</strong></td>' +
            '<td>' + esc(entry.event) + '</td>' +
            '<td>' + esc(entry.detail) + '</td>' +
          '</tr>';
        }).join("") || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">No audit entries</td></tr>';
        setAuditNotice(log.length + " entries");
      } catch(e) { setAuditNotice(e.message, true); }
    }
    document.querySelector("#refreshAuditBtn").addEventListener("click", function() {
      loadAuditLog().catch(function(e) { setAuditNotice(e.message, true); });
    });
    document.querySelector("#auditSearch").addEventListener("change", function() {
      loadAuditLog().catch(function(e) { setAuditNotice(e.message, true); });
    });

    // ── BACKUP ────────────────────────────────────────────────────────────────
    function setBackupNotice(msg, err) {
      var el = document.querySelector("#backupNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }
    var STATUS_LABELS = {
      pending_payment: "รอชำระ", waiting_confirm: "รอยืนยัน", paid: "ชำระแล้ว",
      preparing: "เตรียมของ", shipped: "พร้อมรับ", cancelled: "ยกเลิก", rejected: "ปฏิเสธ"
    };
    async function loadBackupList() {
      setBackupNotice("Loading...");
      try {
        var res = await fetch("/admin/backups", { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();
        var backups = data.backups || [];
        var html = backups.length === 0
          ? '<p style="color:var(--muted);font-size:13px">ยังไม่มี backup — กด "บันทึก Backup ตอนนี้" เพื่อสร้าง</p>'
          : '<div class="table-card"><table><thead><tr><th style="width:40%">วันที่/เวลา (บันทึก)</th><th style="width:15%">จำนวนออเดอร์</th><th></th></tr></thead><tbody>' +
            backups.map(function(b) {
              return '<tr>' +
                '<td><strong>' + esc(b.createdAt) + '</strong></td>' +
                '<td>' + esc(b.orderCount) + ' ออเดอร์</td>' +
                '<td style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button class="secondary backupViewBtn" data-id="' + b.id + '" data-label="' + esc(b.createdAt) + '" style="font-size:12px;padding:4px 12px;min-height:0">ดูรายการ</button>' +
                  '<button class="ghost backupDeleteBtn" data-id="' + b.id + '" style="font-size:12px;padding:4px 10px;min-height:0;color:var(--danger)">ลบ</button>' +
                '</td>' +
              '</tr>';
            }).join("") +
            '</tbody></table></div>';
        document.querySelector("#backupList").innerHTML = html;
        setBackupNotice(backups.length + " backup(s)");
      } catch(e) { setBackupNotice(e.message, true); }
    }
    async function viewBackup(id, label) {
      var card = document.querySelector("#backupDetailCard");
      var body = document.querySelector("#backupDetailBody");
      document.querySelector("#backupDetailTitle").textContent = "Backup: " + label;
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">Loading...</td></tr>';
      card.style.display = "";
      card.scrollIntoView({ behavior: "smooth" });
      try {
        var res = await fetch("/admin/backups/" + encodeURIComponent(id), { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();
        var orders = data.orders || [];
        body.innerHTML = orders.length === 0
          ? '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">ไม่มีออเดอร์ใน backup นี้</td></tr>'
          : orders.map(function(o) {
              var c = o.customer || {};
              var items = (o.items || []).map(function(i) { return (i.product||{}).name || ""; }).filter(Boolean).join(", ");
              return '<tr>' +
                '<td><strong>' + esc(o.id) + '</strong></td>' +
                '<td>' + esc(STATUS_LABELS[o.status] || o.status) + '</td>' +
                '<td>' + esc(c.fullName || "") + '</td>' +
                '<td>' + esc(c.studentCode || "") + '</td>' +
                '<td>' + esc(items || (o.product||{}).name || "") + '</td>' +
                '<td>' + baht(o.totalAmount) + '</td>' +
              '</tr>';
            }).join("");
      } catch(e) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:16px">' + esc(e.message) + '</td></tr>';
      }
    }
    document.querySelector("#createBackupBtn").addEventListener("click", async function() {
      setBackupNotice("กำลังบันทึก...");
      try {
        var res = await fetch("/admin/backups", { method: "POST", headers: authHeaders() });
        if (!res.ok) throw new Error(await res.text());
        var b = await res.json();
        setBackupNotice("บันทึกแล้ว — " + b.orderCount + " ออเดอร์");
        loadBackupList();
      } catch(e) { setBackupNotice(e.message, true); }
    });
    document.querySelector("#refreshBackupListBtn").addEventListener("click", function() { loadBackupList(); });
    document.querySelector("#closeBackupDetailBtn").addEventListener("click", function() {
      document.querySelector("#backupDetailCard").style.display = "none";
    });
    document.querySelector("#backupList").addEventListener("click", async function(e) {
      var viewBtn = e.target.closest(".backupViewBtn");
      if (viewBtn) { viewBackup(viewBtn.dataset.id, viewBtn.dataset.label); return; }
      var delBtn = e.target.closest(".backupDeleteBtn");
      if (delBtn) {
        if (!await showDialog({icon:'danger',title:'ลบ Backup',message:'ลบ backup นี้? ไม่สามารถกู้คืนได้',confirmText:'ลบ'})) return;
        try {
          var res = await fetch("/admin/backups/" + encodeURIComponent(delBtn.dataset.id), { method: "DELETE", headers: authHeaders() });
          if (!res.ok) throw new Error(await res.text());
          loadBackupList();
        } catch(e) { setBackupNotice(e.message, true); }
      }
    });

    // ── Init ───────────────────────────────────────────────────────────────────
    loadProducts();
    if (tokenInput.value) {
      loadOrders();
      loadSettings();
    } else {
      setOrdersNotice("Enter API Token to load orders");
    }

    // ── DARK MODE TOGGLE ──────────────────────────────────────────────────────
    (function initTheme() {
      var SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
      var MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      var root = document.documentElement;
      var btn = document.getElementById("themeToggleBtn");
      var icon = document.getElementById("themeIcon");
      var thumb = document.getElementById("themeThumb");
      var saved = localStorage.getItem("suStoreTheme");
      var sysDark = window.matchMedia("(prefers-color-scheme: dark)");
      function isDark() {
        if (saved === "dark") return true;
        if (saved === "light") return false;
        return sysDark.matches;
      }
      function applyTheme() {
        var dark = isDark();
        root.setAttribute("data-theme", dark ? "dark" : "light");
        icon.innerHTML = dark ? MOON : SUN;
        thumb.style.transform = dark ? "translateX(18px)" : "";
        btn.querySelector(".theme-btn-track").style.background = dark ? "#636366" : "";
      }
      applyTheme();
      btn.addEventListener("click", function() {
        saved = isDark() ? "light" : "dark";
        localStorage.setItem("suStoreTheme", saved);
        applyTheme();
      });
      sysDark.addEventListener("change", function() { if (!saved) applyTheme(); });
    })();
  </script>
</body>
</html>"""


ORDER_VIEW_HTML = r"""<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SU STORE Orders</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f6f7;
      --panel: #ffffff;
      --ink: #111114;
      --muted: #626773;
      --line: #d9d9df;
      --blue: #0071e3;
      --green: #027a48;
      --orange: #b45309;
      --red: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header, main {
      width: min(1320px, calc(100% - 32px));
      margin: 0 auto;
    }
    header {
      padding: 30px 0 18px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(32px, 5vw, 56px);
      letter-spacing: -.05em;
      line-height: 1;
    }
    main { padding: 18px 0 48px; }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1.2fr) minmax(180px, 1fr) minmax(160px, .8fr) auto;
      gap: 10px;
      margin-bottom: 16px;
    }
    input, select, button {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }
    input, select { width: 100%; padding: 0 12px; }
    button {
      cursor: pointer;
      padding: 0 16px;
      font-weight: 800;
    }
    button.primary {
      border-color: var(--blue);
      background: var(--blue);
      color: #fff;
    }
    button.secondary { background: #fff; }
    button:disabled {
      cursor: not-allowed;
      opacity: .5;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      border: 1px solid var(--line);
      background: var(--panel);
      margin-bottom: 12px;
    }
    .summary-item {
      padding: 14px;
      border-right: 1px solid var(--line);
    }
    .summary-item:last-child { border-right: 0; }
    .summary-item span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .summary-item strong {
      display: block;
      margin-top: 6px;
      font-size: 22px;
      letter-spacing: -.04em;
    }
    .notice {
      min-height: 24px;
      margin: 0 0 12px;
      color: var(--muted);
    }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    table {
      width: 100%;
      min-width: 1180px;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #fbfbfc;
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--muted); }
    .money {
      color: var(--blue);
      font-weight: 900;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: #eef2ff;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }
    .badge.waiting_confirm { background: #fff7ed; color: var(--orange); }
    .badge.paid, .badge.preparing, .badge.shipped { background: #ecfdf3; color: var(--green); }
    .badge.received { background: #f5f3ff; color: #7c3aed; }
    .badge.rejected, .badge.cancelled { background: #fef3f2; color: var(--red); }
    .empty {
      padding: 28px;
      color: var(--muted);
      text-align: center;
    }
    .tiny { font-size: 12px; }
    @media (max-width: 900px) {
      header { display: block; }
      .toolbar { grid-template-columns: 1fr 1fr; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary-item:nth-child(2n) { border-right: 0; }
      .summary-item { border-bottom: 1px solid var(--line); }
    }
    @media (max-width: 560px) {
      header, main { width: min(100% - 24px, 1320px); }
      .toolbar { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr; }
      .summary-item { border-right: 0; }
    }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; overflow-y: auto; padding: 32px 16px; }
    .modal-backdrop.open { display: flex; align-items: flex-start; justify-content: center; }
    .modal { background: #fff; border-radius: 16px; width: min(620px,100%); padding: 28px; }
  </style>
</head>
<body>
  <header>
    <div>
      <p class="eyebrow">SU STORE SERVER</p>
      <h1>Order Display</h1>
    </div>
    <p class="muted">Read-only view from the Docker order database</p>
  </header>
  <main>
    <section class="toolbar">
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="ORDER_API_TOKEN" />
      <input id="searchInput" type="search" placeholder="Search order, name, phone, school" />
      <select id="statusFilter">
        <option value="">All status</option>
        <option value="pending_payment">pending_payment</option>
        <option value="waiting_confirm">waiting_confirm</option>
        <option value="paid">paid</option>
        <option value="preparing">preparing</option>
        <option value="shipped">Ready to Receive</option>
        <option value="cancelled">cancelled</option>
        <option value="rejected">rejected</option>
      </select>
      <button class="primary" id="refreshButton">Refresh</button>
    </section>
    <section class="summary" id="summary"></section>
    <p class="notice" id="notice"></p>
    <section class="table-wrap" id="tableWrap"></section>
  </main>

  <!-- SLIP MODAL -->
  <div class="modal-backdrop" id="slipModal">
    <div class="modal">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;letter-spacing:-.03em" id="slipModalTitle">Slip</h2>
          <div style="font-size:14px;color:var(--muted)">Total: <strong id="slipModalAmount" style="color:var(--ink)"></strong></div>
        </div>
        <button id="closeSlipBtn" style="background:#fff;border:1px solid var(--line);border-radius:8px;font-size:20px;line-height:1;padding:4px 10px;cursor:pointer;min-height:0">×</button>
      </div>
      <div id="slipModalContent"></div>
    </div>
  </div>

  <script>
    const tokenInput = document.querySelector("#tokenInput");
    const searchInput = document.querySelector("#searchInput");
    const statusFilter = document.querySelector("#statusFilter");
    const refreshButton = document.querySelector("#refreshButton");
    const notice = document.querySelector("#notice");
    const summary = document.querySelector("#summary");
    const tableWrap = document.querySelector("#tableWrap");
    let allOrders = [];
    let serverSummary = {};

    tokenInput.value = localStorage.getItem("suStoreOrderViewToken") || localStorage.getItem("suStoreAdminToken") || "";

    function text(value) {
      return String(value ?? "").replace(/[&<>"']/g, (match) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[match]);
    }

    function baht(value) {
      return new Intl.NumberFormat("th-TH", {
        style: "currency",
        currency: "THB",
        maximumFractionDigits: 0
      }).format(Number(value || 0));
    }

    function setNotice(message, isError = false) {
      notice.textContent = message;
      notice.style.color = isError ? "var(--red)" : "var(--muted)";
    }

    function filteredOrders() {
      const query = searchInput.value.trim().toLowerCase();
      const status = statusFilter.value;
      return allOrders.filter((order) => {
        const customer = order.customer || {};
        const product = order.product || {};
        const haystack = [
          order.id,
          order.status,
          product.name,
          product.category,
          customer.fullName,
          customer.studentCode,
          customer.email,
          customer.phone,
          customer.school,
          order.size
        ].join(" ").toLowerCase();
        return (!status || order.status === status) && (!query || haystack.includes(query));
      });
    }

    function renderSummary(orders) {
      const totalAmount = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
      const k100Used = Number(serverSummary.khantokTicket100Used || 0);
      const k100Remaining = Number(serverSummary.khantokTicket100Remaining || 0);
      const k100Quota = Number(serverSummary.khantokTicket100Quota || 0);
      const k50Used = Number(serverSummary.khantokTicket50Used || 0);
      const k50Remaining = Number(serverSummary.khantokTicket50Remaining || 0);
      const k50Quota = Number(serverSummary.khantokTicket50Quota || 0);
      const items = [
        ["Showing", orders.length],
        ["All Orders", serverSummary.total || allOrders.length],
        ["Waiting Confirm", serverSummary.waitingConfirm || 0],
        ["Total Amount", baht(totalAmount)],
        ["บัตรขันโตก ฿100", `ใช้ ${k100Used} / ${k100Quota} ใบ (เหลือ ${k100Remaining})`],
        ["บัตรขันโตก ฿50", `ใช้ ${k50Used} / ${k50Quota} ใบ (เหลือ ${k50Remaining})`],
      ];

      summary.innerHTML = items.map(([label, value]) => `
        <div class="summary-item"><span>${text(label)}</span><strong>${text(value)}</strong></div>
      `).join("");
    }

    function renderOrders() {
      const orders = filteredOrders();
      renderSummary(orders);
      if (!orders.length) {
        tableWrap.innerHTML = '<div class="empty">No orders to display</div>';
        return;
      }

      tableWrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th style="width: 11%">Order</th>
              <th style="width: 11%">Status</th>
              <th style="width: 18%">Customer</th>
              <th style="width: 19%">Product</th>
              <th style="width: 9%">Amount</th>
              <th style="width: 10%">Khantok</th>
              <th style="width: 12%">Slip</th>
              <th style="width: 10%">Created</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map((order) => {
              const customer = order.customer || {};
              const product = order.product || {};
              const slip = order.slip;
              return `
                <tr>
                  <td><strong>${text(order.id || "-")}</strong></td>
                  <td><span class="badge ${text(order.status || "")}">${order.status === "shipped" ? "Ready to Receive" : order.status === "received" ? "Received ✓" : text(order.status || "-")}</span>${order.status === "received" && order.receivedBy ? '<br><span class="tiny muted">โดย ' + text(order.receivedBy) + '</span>' : ''}</td>
                  <td>
                    <strong>${text(customer.fullName || "-")}</strong><br />
                    <span class="tiny">${text(customer.studentCode || "-")}</span><br />
                    <span class="tiny muted">${text(customer.phone || "")}</span><br />
                    <span class="tiny muted">${text(customer.email || "")}</span>
                  </td>
                  <td>
                    <strong>${text(product.name || "-")}</strong><br />
                    <span class="tiny">Size: ${text(order.size || "-")} / Qty: ${text(order.quantity || 0)}</span><br />
                    <span class="tiny muted">${text(customer.school || "")}</span>
                  </td>
                  <td class="money">${text(baht(order.totalAmount))}</td>
                  <td>${order.khantokTicket ? `ได้รับ (฿${order.khantokTicketValue || 100})` : order.khantokTicketAlreadyClaimed ? "รับไปแล้ว " + (order.customer?.studentCode || "") : "ไม่ได้รับ"}</td>
                  <td>
                    <span class="tiny">${text(order.paymentStatus || "-")}</span><br />
                    <button class="secondary slipButton" data-order-id="${text(order.id || "")}" ${slip ? "" : "disabled"}>Open Slip</button>
                  </td>
                  <td class="tiny muted">${text(order.createdAt || "")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      `;
    }

    async function loadOrders() {
      const token = tokenInput.value.trim();
      if (!token) {
        setNotice("Enter ORDER_API_TOKEN to load orders", true);
        return;
      }
      localStorage.setItem("suStoreOrderViewToken", token);
      refreshButton.disabled = true;
      setNotice("Loading orders...");
      try {
        const response = await fetch("/admin/orders", {
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = await response.json();
        allOrders = payload.orders || [];
        serverSummary = payload.summary || {};
        renderOrders();
        setNotice(`Loaded ${allOrders.length} orders`);
      } finally {
        refreshButton.disabled = false;
      }
    }

    async function openSlip(orderId, totalAmount) {
      const modal = document.querySelector("#slipModal");
      const content = document.querySelector("#slipModalContent");
      document.querySelector("#slipModalTitle").textContent = "Slip — " + orderId;
      document.querySelector("#slipModalAmount").textContent = baht(totalAmount);
      content.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Loading...</p>';
      modal.classList.add("open");
      try {
        const response = await fetch(`/admin/orders/${encodeURIComponent(orderId)}/slip`, {
          headers: { "Authorization": `Bearer ${tokenInput.value.trim()}` }
        });
        if (!response.ok) throw new Error(await response.text());
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (blob.type === "application/pdf") {
          content.innerHTML = `<iframe src="${url}" style="width:100%;height:500px;border:0;border-radius:8px"></iframe>`;
        } else {
          content.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:8px" />`;
        }
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      } catch (error) {
        content.innerHTML = `<p style="color:var(--red);text-align:center">${String(error.message).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c])}</p>`;
      }
    }

    refreshButton.addEventListener("click", () => loadOrders().catch((error) => setNotice(error.message, true)));
    searchInput.addEventListener("input", renderOrders);
    statusFilter.addEventListener("change", renderOrders);
    document.addEventListener("click", (event) => {
      const slipButton = event.target.closest(".slipButton");
      if (slipButton) {
        const order = allOrders.find((o) => o.id === slipButton.dataset.orderId);
        openSlip(slipButton.dataset.orderId, order ? order.totalAmount : 0).catch((error) => setNotice(error.message, true));
      }
    });

    document.querySelector("#closeSlipBtn").addEventListener("click", () => {
      document.querySelector("#slipModal").classList.remove("open");
      document.querySelector("#slipModalContent").innerHTML = "";
    });
    document.querySelector("#slipModal").addEventListener("click", function(e) {
      if (e.target === this) {
        this.classList.remove("open");
        document.querySelector("#slipModalContent").innerHTML = "";
      }
    });

    if (tokenInput.value) {
      loadOrders().catch((error) => setNotice(error.message, true));
    } else {
      setNotice("Enter ORDER_API_TOKEN to load orders");
      renderSummary([]);
      renderOrders();
    }
  </script>
</body>
</html>"""


CLAIM_STATION_HTML = r"""<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <meta name="mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-capable" content="yes"/>
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
  <title>Claim Station</title>
  <script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"></script>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#f0f2f5;--card:#fff;--ink:#0f172a;--muted:#64748b;--border:#e2e8f0;
      --primary:#4f6ef7;--primary-dk:#3b56e0;
      --ok:#16a34a;--ok-bg:#dcfce7;
      --danger:#dc2626;--danger-bg:#fee2e2;
      --warn:#d97706;--warn-bg:#fef3c7;
      --purple:#7c3aed;--purple-bg:#ede9fe;
      --radius:12px;--shadow:0 2px 8px rgba(0,0,0,.08);
    }
    @media(prefers-color-scheme:dark){
      :root{--bg:#0f172a;--card:#1e293b;--ink:#f1f5f9;--muted:#94a3b8;--border:#334155;
        --ok-bg:#052e16;--danger-bg:#450a0a;--warn-bg:#451a03;--purple-bg:#1e1040;--purple:#a78bfa;}
    }
    body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}
    input,button,textarea,select{font-family:inherit}
    /* Screen switching — explicit display values to avoid [hidden] CSS conflict */
    #loginScreen{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
    #loginScreen.scr-off{display:none!important}
    #mainScreen{display:none;min-height:100vh;flex-direction:column}
    #mainScreen.scr-on{display:flex!important}
    .login-card{background:var(--card);border-radius:var(--radius);padding:36px 28px;width:100%;max-width:380px;box-shadow:var(--shadow)}
    .login-logo{text-align:center;margin-bottom:28px}
    .login-logo h1{font-size:22px;font-weight:800;letter-spacing:-.03em;color:var(--primary)}
    .login-logo p{font-size:13px;color:var(--muted);margin-top:4px}
    .lbl{display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px;letter-spacing:.06em;text-transform:uppercase}
    .inp{width:100%;height:44px;border:1.5px solid var(--border);border-radius:8px;padding:0 12px;font-size:15px;color:var(--ink);background:var(--card);outline:none;transition:border-color .15s;margin-bottom:14px}
    .inp:focus{border-color:var(--primary)}
    .remember-row{display:flex;align-items:center;gap:8px;margin-bottom:20px;font-size:13px;color:var(--muted);cursor:pointer}
    .remember-row input[type="checkbox"]{width:16px;height:16px;cursor:pointer;accent-color:var(--primary)}
    .btn-primary{width:100%;height:46px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s}
    .btn-primary:hover{background:var(--primary-dk)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed}
    .login-error{color:var(--danger);font-size:13px;margin-top:10px;text-align:center;min-height:18px}
    /* Top bar */
    .top-bar{background:var(--card);border-bottom:1px solid var(--border);padding:0 16px;height:52px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    .top-bar-title{font-size:15px;font-weight:800;color:var(--primary);letter-spacing:-.02em;flex:1}
    .top-bar-user{font-size:12px;color:var(--muted);font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .btn-logout{background:none;border:1.5px solid var(--border);border-radius:8px;padding:5px 10px;font-size:12px;color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s;white-space:nowrap}
    .btn-logout:hover{border-color:var(--danger);color:var(--danger)}
    /* Layout */
    .main-content{flex:1;padding:14px;max-width:1000px;margin:0 auto;width:100%}
    @media(min-width:640px){
      .main-grid{display:flex;gap:14px;align-items:start}
    .scan-col{flex:1;min-width:0}
    .result-col{flex:1;min-width:0;max-width:640px;margin:0 auto}
    }
    /* Scanner card */
    .scanner-card{background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);margin-bottom:12px}
    .card-header{padding:11px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
    .card-header h2{font-size:13px;font-weight:700;flex:1;letter-spacing:.01em}
    .scanner-body{position:relative;background:#000;aspect-ratio:4/3;overflow:hidden}
    #scanVideo{width:100%;height:100%;object-fit:cover;display:block}
    #scanCanvas{display:none}
    .scan-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
    .scan-frame{width:55%;aspect-ratio:1;border:2px solid rgba(255,255,255,.7);border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.3)}
    .scan-status{padding:9px 14px;font-size:13px;color:var(--muted);text-align:center;min-height:36px;display:flex;align-items:center;justify-content:center}
    .scan-status.error{color:var(--danger)}
    .scan-status.success{color:var(--ok);font-weight:600}
    /* Manual */
    .manual-card{background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px}
    .manual-lbl{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px}
    .manual-row{display:flex;gap:8px}
    .manual-inp{flex:1;height:40px;border:1.5px solid var(--border);border-radius:8px;padding:0 12px;font-size:14px;color:var(--ink);background:var(--card);outline:none}
    .manual-inp:focus{border-color:var(--primary)}
    .btn-search{height:40px;padding:0 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap}
    /* Result card */
    .result-card{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;margin-bottom:12px}
    .order-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px;border-bottom:1px solid var(--border)}
    .order-code{font-family:ui-monospace,monospace;font-size:20px;font-weight:800;letter-spacing:.02em}
    .st-badge{font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px}
    .st-badge.shipped{background:var(--ok-bg);color:var(--ok)}
    .st-badge.received{background:var(--purple-bg);color:var(--purple)}
    .st-badge.pending_payment,.st-badge.waiting_confirm,.st-badge.paid,.st-badge.preparing{background:var(--warn-bg);color:var(--warn)}
    .st-badge.cancelled,.st-badge.rejected{background:var(--danger-bg);color:var(--danger)}
    .cust-block{padding:10px 14px;border-bottom:1px solid var(--border)}
    .cust-name{font-size:17px;font-weight:700}
    .cust-meta{display:flex;gap:12px;flex-wrap:wrap;margin-top:3px}
    .cust-meta span{font-size:13px;color:var(--muted)}
    .items-block{padding:10px 14px 4px;border-bottom:1px solid var(--border)}
    .items-label{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
    .item-row{display:flex;align-items:center;gap:10px;padding:7px 10px;margin-bottom:4px;background:var(--surface2,rgba(255,255,255,.04));border-radius:10px;border:1px solid var(--border)}
    .item-name{font-size:16px;font-weight:800;flex:1;color:var(--ink)}
    .item-size-badge{font-size:13px;font-weight:700;padding:3px 10px;border-radius:6px;background:var(--primary);color:#fff;white-space:nowrap}
    .item-qty{font-size:13px;color:var(--muted);white-space:nowrap}
    .slip-block{padding:10px 14px;border-bottom:1px solid var(--border)}
    .slip-thumb{max-width:100%;max-height:380px;border-radius:8px;border:1px solid var(--border);cursor:pointer;display:block;object-fit:contain}
    .slip-expand{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);z-index:9000;display:flex;align-items:center;justify-content:center;cursor:zoom-out}
    .slip-expand img{max-width:92vw;max-height:92vh;border-radius:10px;object-fit:contain}
    .khantok-badge{display:inline-flex;align-items:center;gap:6px;background:var(--ok-bg);color:var(--ok);padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;margin:8px 14px}
    .banner{padding:10px 14px;font-size:13px;font-weight:600}
    .banner.received-banner{background:var(--purple-bg);color:var(--purple)}
    .banner.warn-banner{background:var(--warn-bg);color:var(--warn)}
    .action-block{padding:12px 14px;display:flex;flex-direction:column;gap:8px}
    .btn-confirm{width:100%;height:48px;background:var(--ok);color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .15s}
    .btn-confirm:hover{opacity:.85}
    .btn-confirm:disabled{opacity:.5;cursor:not-allowed}
    .btn-close{width:100%;height:40px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer}
    .btn-close:hover{border-color:var(--ink);color:var(--ink)}
    /* Error */
    .err-card{background:var(--danger-bg);color:var(--danger);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow);margin-bottom:12px}
    .err-card h3{font-size:15px;margin-bottom:6px}
    .err-card p{font-size:13px;margin-bottom:12px}
    /* Stats slide panel */
    #statsPanel{position:fixed;left:-256px;top:52px;width:256px;height:calc(100vh - 52px);background:var(--card);border-right:1px solid var(--border);z-index:500;transition:left .25s cubic-bezier(.4,0,.2,1);box-shadow:4px 0 20px rgba(0,0,0,.12);overflow-y:auto}
    #statsPanel.open{left:0}
    #statsTab{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:501;background:var(--primary);color:#fff;border:none;border-radius:0 8px 8px 0;padding:12px 8px;font-size:11px;font-weight:700;cursor:pointer;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.06em;transition:left .25s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;gap:6px;line-height:1}
    #statsTab.open{left:256px}
    .sp-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
    .sp-stat{padding:14px 16px;border-bottom:1px solid var(--border)}
    .stat-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
    .stat-value{font-size:28px;font-weight:800;color:var(--ink);letter-spacing:-.02em}
    .stat-value.ok{color:var(--ok)}
    .stat-value.session{color:var(--primary)}
    /* Recent */
    .recent-card{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
    .recent-hdr{padding:11px 14px;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    .recent-list{list-style:none;max-height:calc(100vh - 220px);overflow-y:auto}
    .recent-item{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;transition:background .15s}
    .recent-item:hover{background:rgba(255,255,255,.06)}
    .recent-item:last-child{border-bottom:none}
    .r-time{color:var(--muted);min-width:44px;font-size:12px}
    .r-code{font-family:monospace;font-weight:700;font-size:12px}
    .r-name{color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .r-ok{color:var(--ok);font-weight:700}
    .recent-empty{padding:20px 14px;text-align:center;color:var(--muted);font-size:13px}
    .btn-print{width:100%;height:48px;background:var(--primary);color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .15s}
    .btn-print:hover{opacity:.85}
    /* Connection dot */
    .conn-dot{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block;margin-right:4px;transition:background .3s}
    .conn-dot.offline{background:var(--danger)}
    .conn-dot.warn{background:var(--warn)}
    /* Sound / util buttons */
    .btn-icon{background:none;border:1.5px solid var(--border);border-radius:8px;padding:4px 8px;font-size:13px;color:var(--muted);cursor:pointer;height:28px;line-height:1;transition:border-color .15s}
    .btn-icon:hover{border-color:var(--primary);color:var(--primary)}
    /* Idle overlay */
    #idleOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:8000;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#fff}
    #idleOverlay h2{font-size:22px;font-weight:700}
    #idleOverlay p{font-size:14px;color:rgba(255,255,255,.6)}
    /* Search type tabs */
    .search-tabs{display:flex;gap:4px;margin-bottom:8px}
    .stab{flex:1;height:30px;border:1.5px solid var(--border);border-radius:6px;background:none;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;transition:all .15s}
    .stab.active{background:var(--primary);border-color:var(--primary);color:#fff}
    /* Fullscreen btn */
    .btn-fs{background:none;border:none;font-size:16px;color:var(--muted);cursor:pointer;padding:2px 4px;line-height:1}
    #printReceipt{ display:none }
    @media print {
      body * { visibility:hidden }
      #printReceipt, #printReceipt * { visibility:visible }
      #printReceipt { display:block!important; position:absolute; top:0; left:0; width:100% }
      @page { size:A4 portrait; margin:10mm 14mm }
    }
  </style>
</head>
<body>

  <div id="loginScreen">
    <div class="login-card">
      <div class="login-logo">
        <h1>CLAIM STATION</h1>
        <p>SU STORE — Pickup Management</p>
      </div>
      <form id="loginForm" autocomplete="off">
        <label class="lbl" for="loginUser">Username</label>
        <input id="loginUser" class="inp" type="text" autocomplete="username" required />
        <label class="lbl" for="loginPass">Password</label>
        <input id="loginPass" class="inp" type="password" autocomplete="current-password" required style="margin-bottom:14px"/>
        <label class="lbl" for="loginStation">ชื่อสถานีนี้ (ไม่บังคับ)</label>
        <input id="loginStation" class="inp" type="text" placeholder="เช่น Station A, โต๊ะ 1" style="margin-bottom:8px"/>
        <label class="remember-row">
          <input id="loginRemember" type="checkbox" checked />
          จำอุปกรณ์นี้
        </label>
        <button id="loginBtn" class="btn-primary" type="submit">เข้าสู่ระบบ</button>
      </form>
      <p id="loginError" class="login-error"></p>
    </div>
  </div>

  <div id="mainScreen">
    <div class="top-bar">
      <span class="top-bar-title">CLAIM STATION</span>
      <span id="connDot" class="conn-dot" title="เชื่อมต่ออยู่"></span>
      <span class="top-bar-user" id="userLabel"></span>
      <button id="soundBtn" class="btn-icon" title="เปิด/ปิดเสียง"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
      <button id="fullscreenBtn" class="btn-fs" title="เต็มจอ"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
      <button id="logoutBtn" class="btn-logout">ออกจากระบบ</button>
    </div>
    <div id="statsPanel">
      <div class="sp-header">
        <span>สถิติ</span>
        <button class="btn-icon" onclick="toggleStatsPanel()" title="ปิด"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="sp-stat"><div class="stat-label">Session นี้</div><div class="stat-value session" id="statSession">0</div></div>
      <div class="sp-stat"><div class="stat-label">รับวันนี้</div><div class="stat-value ok" id="statToday">—</div></div>
      <div class="sp-stat"><div class="stat-label">รอรับอยู่</div><div class="stat-value" id="statPending">—</div></div>
      <div class="sp-stat"><div class="stat-label">รวมทั้งหมด</div><div class="stat-value" id="statTotal">—</div></div>
      <div class="sp-stat"><div class="stat-label">ความคืบหน้า</div><div id="claimProgress" style="font-size:16px;font-weight:800;margin-top:2px">—</div></div>
    </div>
    <button id="statsTab" onclick="toggleStatsPanel()"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>สถิติ</button>
    <div class="main-content">
      <div class="main-grid">
        <div class="scan-col">
          <div class="scanner-card">
            <div class="card-header">
              <h2>สแกน QR Code</h2>
              <button id="torchBtn" class="btn-icon" style="display:none" title="ไฟฉาย"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>
              <button id="switchCamBtn" class="btn-logout" style="font-size:12px;padding:4px 10px;height:28px;display:none">สลับกล้อง</button>
              <button id="toggleCamBtn" class="btn-logout" style="font-size:12px;padding:4px 10px;height:28px">หยุดกล้อง</button>
            </div>
            <div class="scanner-body">
              <video id="scanVideo" autoplay playsinline muted></video>
              <canvas id="scanCanvas"></canvas>
              <div class="scan-overlay"><div class="scan-frame"></div></div>
            </div>
            <p id="scanStatus" class="scan-status">กำลังเริ่มกล้อง...</p>
          </div>
          <div class="manual-card">
            <div class="manual-lbl">ค้นหาด้วยตนเอง</div>
            <div class="search-tabs">
              <button class="stab active" data-type="student" onclick="setSearchType('student')">รหัส นศ.</button>
              <button class="stab" data-type="phone" onclick="setSearchType('phone')">เบอร์โทร</button>
              <button class="stab" data-type="order" onclick="setSearchType('order')">เลขออเดอร์</button>
              <button class="stab" data-type="name" onclick="setSearchType('name')">ชื่อ</button>
            </div>
            <div class="manual-row">
              <input id="manualInput" class="manual-inp" type="text" placeholder="ใส่รหัสนักศึกษา" inputmode="numeric" />
              <button id="manualBtn" class="btn-search">ค้นหา</button>
            </div>
          </div>
        </div>
        <div class="result-col" id="resultCol" style="display:none">
          <div id="resultSection"></div>
        </div>
        <div class="recent-card" style="position:sticky;top:16px">
          <div class="recent-hdr" style="display:flex;align-items:center;justify-content:space-between">
            <span>ประวัติการรับ</span>
            <button onclick="exportUnclaimed()" class="btn-icon" style="font-size:11px;height:24px;padding:0 8px;display:inline-flex;align-items:center;gap:4px" title="ออเดอร์ค้างรับ"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> ค้างรับ</button>
          </div>
          <ul id="recentList" class="recent-list"><li class="recent-empty">ยังไม่มีประวัติ</li></ul>
        </div>
      </div>
    </div>
  </div>

  <script>
    var currentToken = '';
    var currentUser = '';
    var currentStation = '';
    var lastOrder = null;
    var statsInterval = null;
    var scanCooldown = false;
    var cameraStream = null;
    var animFrame = null;
    var recentPickups = [];
    var camActive = false;
    var availableCameras = [];
    var currentCamIndex = 0;
    var soundEnabled = true;
    var sessionClaimCount = 0;
    var torchOn = false;
    var torchTrack = null;
    var idleTimer = null;
    var isIdle = false;
    var searchType = 'student';
    var audioCtx = null;

    var IDLE_MS = 25 * 60 * 1000;

    var IC_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var IC_WARN  = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    var IC_PRINT = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    var IC_PHONE = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.35a2 2 0 0 1 1.99-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.5a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 14.92z"/></svg>';
    var IC_TICKET = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>';
    var IC_CHKSQ = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
    var IC_SND_ON  = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    var IC_SND_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

    function getAudioCtx() {
      if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
      }
      return audioCtx;
    }

    function beep(freq, dur, vol, type) {
      if (!soundEnabled) return;
      var ctx = getAudioCtx();
      if (!ctx) return;
      try {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq || 880;
        osc.type = type || 'sine';
        gain.gain.setValueAtTime(vol || 0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.15));
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + (dur || 0.15));
      } catch(e) {}
    }
    function beepSuccess() { beep(880, 0.12, 0.3); setTimeout(function() { beep(1320, 0.1, 0.25); }, 100); }
    function beepError()   { beep(220, 0.25, 0.35, 'sawtooth'); }
    function beepWarn()    { beep(440, 0.18, 0.3); }
    function vibrate(ms)   { if (navigator.vibrate) navigator.vibrate(ms || 100); }

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function fmt(s) {
      var mth = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      try {
        var iso = (s.indexOf('Z') < 0 && !/[+-]\d\d:\d\d$/.test(s)) ? s + 'Z' : s;
        var d = new Date(iso);
        return d.getDate() + ' ' + mth[d.getMonth()] + ' ' + (d.getFullYear()+543).toString().slice(-2) + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ' น.';
      } catch(e) { return s; }
    }

    /* ── Idle / lock ── */
    function resetIdle() {
      if (isIdle) {
        isIdle = false;
        document.getElementById('idleOverlay').style.display = 'none';
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function() {
        if (currentToken) {
          isIdle = true;
          document.getElementById('idleOverlay').style.display = 'flex';
          beepWarn();
        }
      }, IDLE_MS);
    }
    document.addEventListener('touchstart', resetIdle, {passive:true});
    document.addEventListener('mousedown', resetIdle);
    document.addEventListener('keydown', resetIdle);
    document.addEventListener('DOMContentLoaded', function() { var o = document.getElementById('idleOverlay'); if (o) o.addEventListener('click', resetIdle); });

    /* ── Connection indicator ── */
    function setConnState(online) {
      var dot = document.getElementById('connDot');
      if (!dot) return;
      dot.className = 'conn-dot' + (online ? '' : ' offline');
      dot.title = online ? 'เชื่อมต่ออยู่' : 'ออฟไลน์';
    }
    window.addEventListener('online', function() { setConnState(true); });
    window.addEventListener('offline', function() { setConnState(false); });
    setConnState(navigator.onLine !== false);

    /* ── Init ── */
    (function init() {
      var tok = localStorage.getItem('csToken') || sessionStorage.getItem('csToken');
      var usr = localStorage.getItem('csUser') || sessionStorage.getItem('csUser');
      var stn = localStorage.getItem('csStation') || sessionStorage.getItem('csStation') || '';
      var snd = localStorage.getItem('csSound');
      soundEnabled = snd !== '0';
      document.getElementById('soundBtn').innerHTML = soundEnabled ? IC_SND_ON : IC_SND_OFF;
      if (tok && usr) { currentToken = tok; currentUser = usr; currentStation = stn; showMain(); }
      else showLogin();
    })();

    function showLogin() {
      document.getElementById('loginScreen').classList.remove('scr-off');
      document.getElementById('mainScreen').classList.remove('scr-on');
      if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
      clearTimeout(idleTimer);
    }
    function showMain() {
      document.getElementById('loginScreen').classList.add('scr-off');
      document.getElementById('mainScreen').classList.add('scr-on');
      var lbl = currentUser + (currentStation ? ' • ' + currentStation : '');
      document.getElementById('userLabel').textContent = lbl;
      loadStats();
      statsInterval = setInterval(loadStats, 30000);
      if (localStorage.getItem('csCamOff') === '1') {
        camActive = false;
        document.getElementById('toggleCamBtn').textContent = 'เปิดกล้อง';
        setScanStatus('กล้องถูกปิด');
      } else {
        startCamera();
      }
      resetIdle();
    }
    function loadStats() {
      fetch('/claim-station/stats', {headers: {'Authorization': 'Claim ' + currentToken}})
        .then(function(r) {
          setConnState(true);
          return r.ok ? r.json() : null;
        })
        .then(function(d) {
          if (!d) return;
          var todayEl = document.getElementById('statToday');
          var totalEl = document.getElementById('statTotal');
          var pendEl  = document.getElementById('statPending');
          if (todayEl) todayEl.textContent = d.receivedToday;
          if (totalEl) totalEl.textContent = d.receivedTotal;
          if (pendEl)  pendEl.textContent  = d.pendingPickup;
          var total = (d.receivedTotal || 0) + (d.pendingPickup || 0);
          var pct = total > 0 ? Math.round((d.receivedTotal || 0) / total * 100) : 0;
          var progEl = document.getElementById('claimProgress');
          if (progEl) {
            progEl.textContent = total > 0 ? pct + '% (' + d.receivedTotal + '/' + total + ')' : '—';
            progEl.style.color = pct >= 90 ? 'var(--ok)' : pct >= 50 ? 'var(--primary)' : 'var(--warn)';
          }
        }).catch(function() { setConnState(false); });
    }
    function toggleStatsPanel() {
      var open = document.getElementById('statsPanel').classList.toggle('open');
      document.getElementById('statsTab').classList.toggle('open', open);
    }

    /* ── Sound toggle ── */
    document.getElementById('soundBtn').addEventListener('click', function() {
      soundEnabled = !soundEnabled;
      this.innerHTML = soundEnabled ? IC_SND_ON : IC_SND_OFF;
      localStorage.setItem('csSound', soundEnabled ? '1' : '0');
      if (soundEnabled) beepSuccess();
    });

    /* ── Fullscreen ── */
    document.getElementById('fullscreenBtn').addEventListener('click', function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function() {});
      } else {
        document.exitFullscreen().catch(function() {});
      }
    });

    /* ── Login ── */
    document.getElementById('loginForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var user = document.getElementById('loginUser').value.trim();
      var pass = document.getElementById('loginPass').value;
      var station = document.getElementById('loginStation').value.trim();
      var rem  = document.getElementById('loginRemember').checked;
      var errEl = document.getElementById('loginError');
      var btn   = document.getElementById('loginBtn');
      errEl.textContent = '';
      btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...';
      fetch('/claim-station/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({username: user, password: pass})
      }).then(function(r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) {
          throw new Error('ไม่สามารถเชื่อมต่อกับ server ได้ — ตรวจสอบ URL และ server status');
        }
        return r.json().then(function(d) { return {ok: r.ok, d: d}; });
      }).then(function(r) {
        if (!r.ok) throw new Error(r.d.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        currentToken = r.d.token;
        currentUser = user;
        currentStation = station;
        if (rem) {
          localStorage.setItem('csToken', currentToken);
          localStorage.setItem('csUser', currentUser);
          localStorage.setItem('csStation', currentStation);
        } else {
          sessionStorage.setItem('csToken', currentToken);
          sessionStorage.setItem('csUser', currentUser);
          sessionStorage.setItem('csStation', currentStation);
        }
        showMain();
      }).catch(function(err) {
        errEl.textContent = err.message;
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
        beepError();
      });
    });

    /* ── Logout ── */
    document.getElementById('logoutBtn').addEventListener('click', async function() {
      if (!await showCsDialog({icon:'warn',title:'ออกจากระบบ',message:'ต้องการออกจากระบบ?',confirmText:'ออกจากระบบ'})) return;
      doLogout();
    });
    function doLogout() {
      localStorage.removeItem('csToken'); localStorage.removeItem('csUser'); localStorage.removeItem('csStation');
      sessionStorage.removeItem('csToken'); sessionStorage.removeItem('csUser'); sessionStorage.removeItem('csStation');
      currentToken = ''; currentUser = ''; currentStation = ''; sessionClaimCount = 0;
      document.getElementById('statSession').textContent = '0';
      stopCamera();
      showLogin();
    }

    /* ── Torch ── */
    document.getElementById('torchBtn').addEventListener('click', function() {
      if (!torchTrack) return;
      torchOn = !torchOn;
      torchTrack.applyConstraints({advanced: [{torch: torchOn}]}).catch(function() {});
      this.textContent = torchOn ? '\u{1F526}' : '\u{1F294}';
    });

    /* ── Camera ── */
    document.getElementById('toggleCamBtn').addEventListener('click', function() {
      if (camActive) {
        stopCamera(); camActive = false;
        this.textContent = 'เปิดกล้อง';
        setScanStatus('กล้องถูกปิด');
        localStorage.setItem('csCamOff', '1');
      } else {
        camActive = true;
        this.textContent = 'หยุดกล้อง';
        localStorage.removeItem('csCamOff');
        startCamera();
      }
    });

    document.getElementById('switchCamBtn').addEventListener('click', function() {
      if (availableCameras.length < 2) return;
      currentCamIndex = (currentCamIndex + 1) % availableCameras.length;
      stopCamera();
      startCamera(availableCameras[currentCamIndex].deviceId);
    });

    function loadCameras() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        availableCameras = devices.filter(function(d) { return d.kind === 'videoinput'; });
        document.getElementById('switchCamBtn').style.display = availableCameras.length > 1 ? '' : 'none';
      }).catch(function() {});
    }

    function trySetupTorch(stream) {
      try {
        var tracks = stream.getVideoTracks();
        if (!tracks.length) return;
        var track = tracks[0];
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.torch) {
          torchTrack = track;
          document.getElementById('torchBtn').style.display = '';
        }
      } catch(e) {}
    }

    function startCamera(deviceId) {
      camActive = true;
      torchTrack = null;
      document.getElementById('torchBtn').style.display = 'none';
      torchOn = false;
      document.getElementById('torchBtn').textContent = '\u{1F294}';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScanStatus('กล้องไม่รองรับในอุปกรณ์นี้', 'error'); return;
      }
      setScanStatus('กำลังขอสิทธิ์กล้อง...');
      var constraints = deviceId
        ? {video: {deviceId: {exact: deviceId}, width:{ideal:1280}, height:{ideal:720}}}
        : {video: {facingMode: {ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}};
      navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
        cameraStream = stream;
        trySetupTorch(stream);
        var vid = document.getElementById('scanVideo');
        vid.srcObject = stream;
        vid.addEventListener('loadedmetadata', function() {
          vid.play();
          setScanStatus('กำลังสแกน QR Code...');
          scanTick();
          loadCameras();
        }, {once: true});
      }).catch(function() {
        setScanStatus('ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการเข้าถึงกล้อง', 'error');
        camActive = false;
        document.getElementById('toggleCamBtn').textContent = 'เปิดกล้อง';
      });
    }

    function stopCamera() {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      if (cameraStream) { cameraStream.getTracks().forEach(function(t) { t.stop(); }); cameraStream = null; }
      torchTrack = null; torchOn = false;
    }

    function scanTick() {
      if (!cameraStream) return;
      var vid = document.getElementById('scanVideo');
      var can = document.getElementById('scanCanvas');
      if (vid.readyState === vid.HAVE_ENOUGH_DATA && !scanCooldown && typeof jsQR !== 'undefined') {
        can.height = vid.videoHeight; can.width = vid.videoWidth;
        can.getContext('2d').drawImage(vid, 0, 0);
        var img = can.getContext('2d').getImageData(0, 0, can.width, can.height);
        var code = jsQR(img.data, img.width, img.height, {inversionAttempts:'dontInvert'});
        if (code && code.data) {
          var raw = code.data.trim();
          if (raw) {
            scanCooldown = true;
            vibrate(80);
            var parsed = parseQrCode(raw);
            setScanStatus('พบ QR: ' + parsed.displayCode, 'success');
            lookupOrder(parsed.orderCode, parsed.qrToken);
            setTimeout(function() { scanCooldown = false; }, 4000);
          }
        }
      }
      animFrame = requestAnimationFrame(scanTick);
    }

    function parseQrCode(raw) {
      var upper = raw.toUpperCase();
      if (upper.indexOf('SUQR:') === 0) {
        var parts = raw.split(':');
        if (parts.length >= 3) {
          var orderCode = parts[1].toUpperCase();
          var token = parts[2];
          return {orderCode: orderCode, qrToken: token, displayCode: orderCode + ' (signed)'};
        }
      }
      return {orderCode: upper, qrToken: '', displayCode: upper};
    }

    function setScanStatus(msg, cls) {
      var el = document.getElementById('scanStatus');
      el.textContent = msg;
      el.className = 'scan-status' + (cls ? ' ' + cls : '');
    }

    /* ── Search type ── */
    function setSearchType(type) {
      searchType = type;
      var placeholders = {student:'ใส่รหัสนักศึกษา',phone:'ใส่เบอร์โทร',order:'ใส่เลขออเดอร์',name:'ใส่ชื่อ-สกุล'};
      var modes = {student:'numeric',phone:'tel',order:'text',name:'text'};
      var inp = document.getElementById('manualInput');
      inp.placeholder = placeholders[type] || '';
      inp.inputMode = modes[type] || 'text';
      inp.value = '';
      document.querySelectorAll('.stab').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.type === type);
      });
      inp.focus();
    }

    document.getElementById('manualBtn').addEventListener('click', function() {
      var v = document.getElementById('manualInput').value.trim();
      if (v) doManualSearch(v);
    });
    document.getElementById('manualInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { var v = this.value.trim(); if (v) doManualSearch(v); }
    });

    function doManualSearch(val) {
      if (searchType === 'order') {
        lookupOrder(val.toUpperCase(), '');
        return;
      }
      var url = '/claim-station/orders?';
      if (searchType === 'phone') url += 'phone=' + encodeURIComponent(val);
      else if (searchType === 'name') url += 'name=' + encodeURIComponent(val);
      else url += 'studentCode=' + encodeURIComponent(val);
      fetch(url, {headers: {'Authorization': 'Claim ' + currentToken}})
        .then(function(r) {
          if (r.status === 401) { doLogout(); return null; }
          return r.json().then(function(d) { return {ok: r.ok, d: d}; });
        }).then(function(r) {
          if (!r) return;
          if (!r.ok) { showError(r.d.message || 'ไม่พบออเดอร์พร้อมรับ'); beepWarn(); return; }
          var orders = r.d.orders || [];
          if (orders.length === 1) showOrderCard(orders[0]);
          else showOrderList(orders);
        }).catch(function() { showError('ไม่สามารถเชื่อมต่อได้'); beepError(); });
    }

    function showOrderList(orders) {
      var html = '<div class="result-card"><div class="order-hdr"><span class="order-code" style="font-size:15px">พบ ' + orders.length + ' ออเดอร์</span></div>';
      for (var i = 0; i < orders.length; i++) {
        var o = orders[i];
        var items = (o.items && o.items.length) ? o.items : [{product: o.product, size: o.size, quantity: o.quantity}];
        var itemSummary = items.map(function(it) {
          var p = it.product || {};
          return esc((p.shortName || p.name || '')) + (it.size ? ' ' + esc(it.size) : '');
        }).join(', ');
        html += '<div class="cust-block" style="cursor:pointer" onclick="lookupOrder(\'' + esc(o.id) + '\',\'\')">' +
          '<div class="cust-name" style="font-size:15px">' + esc(o.id) + '</div>' +
          '<div class="cust-meta"><span>' + esc((o.customer || {}).fullName || '') + '</span><span>' + esc(itemSummary) + '</span></div>' +
        '</div>';
      }
      html += '<div class="action-block"><button class="btn-close" onclick="clearResult()">ปิด</button></div></div>';
      _showResultMode();
      document.getElementById('resultCol').style.display = '';
      document.getElementById('resultSection').innerHTML = html;
    }

    function lookupOrder(code, qrToken) {
      var url = '/claim-station/orders/' + encodeURIComponent(code);
      if (qrToken) url += '?qrToken=' + encodeURIComponent(qrToken);
      fetch(url, {headers: {'Authorization': 'Claim ' + currentToken}})
        .then(function(r) {
          if (r.status === 401) { doLogout(); return null; }
          return r.json().then(function(d) { return {ok: r.ok, status: r.status, d: d}; });
        }).then(function(r) {
          if (!r) return;
          if (!r.ok) {
            showError(r.d.message || 'ไม่พบออเดอร์');
            beepError(); vibrate([100, 80, 100]);
            return;
          }
          showOrderCard(r.d.order);
        }).catch(function() { showError('ไม่สามารถเชื่อมต่อได้'); beepError(); });
    }

    var ST_TH = {pending_payment:'รอสลิป',waiting_confirm:'รอยืนยัน',paid:'ชำระแล้ว',preparing:'กำลังเตรียมของ',shipped:'พร้อมรับ',received:'รับแล้ว',cancelled:'ยกเลิก',rejected:'ปฏิเสธ'};

    function showOrderCard(order) {
      lastOrder = order;
      var st = order.status || '';
      var stLabel = ST_TH[st] || st;
      var cust = order.customer || {};
      var canReceive = st === 'shipped';
      var alreadyReceived = st === 'received';
      var items = (order.items && order.items.length) ? order.items : [{product: order.product, size: order.size, quantity: order.quantity}];
      var needChecklist = canReceive && items.length > 1;
      var itemsHtml = '';
      for (var i = 0; i < items.length; i++) {
        var itm = items[i]; var p = itm.product || {};
        var cat = (p.category || '').toLowerCase();
        var unit = (cat.indexOf('headband') >= 0 || (p.name||'').toLowerCase().indexOf('headband') >= 0) ? 'ผืน' : 'ตัว';
        var schoolLine = itm.school ? '<div style="font-size:12px;color:var(--muted);margin-top:1px">' + (cat.indexOf('headband')>=0?'Print: ':'โรงเรียน: ') + esc(itm.school) + '</div>' : '';
        if (needChecklist) {
          itemsHtml += '<label class="item-row" style="cursor:pointer">' +
            '<input type="checkbox" class="item-chk" onchange="updateConfirmBtn()" style="width:20px;height:20px;accent-color:var(--ok);flex-shrink:0">' +
            '<div style="flex:1"><div class="item-name">' + esc(p.name || p.shortName || '') + '</div>' + schoolLine + '</div>' +
            '<span class="item-size-badge">S ' + esc(itm.size || '-') + '</span>' +
            '<span class="item-qty">&times; ' + esc(String(itm.quantity || 1)) + ' ' + unit + '</span>' +
            '</label>';
        } else {
          itemsHtml += '<div class="item-row">' +
            '<div style="flex:1"><div class="item-name">' + esc(p.name || p.shortName || '') + '</div>' + schoolLine + '</div>' +
            '<span class="item-size-badge">S ' + esc(itm.size || '-') + '</span>' +
            '<span class="item-qty">&times; ' + esc(String(itm.quantity || 1)) + ' ' + unit + '</span>' +
            '</div>';
        }
      }
      var checklabel = needChecklist ? '<div style="font-size:10px;font-weight:800;color:var(--warn);letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px">' + IC_CHKSQ + ' เช็คของก่อนกด ยืนยัน</div>' : '';
      itemsHtml = '<div class="items-block"><div class="items-label">รายการสินค้า</div>' + checklabel + itemsHtml + '</div>';
      var khantok = '';
      if (order.khantokTicket) khantok = '<div class="khantok-badge" style="display:flex;align-items:center;gap:4px">' + IC_TICKET + ' บัตรขันโตก' + (order.khantokTicketValue ? ' ฿' + order.khantokTicketValue : '') + '</div>';
      var banner = '';
      if (alreadyReceived) {
        banner = '<div class="banner received-banner" style="display:flex;align-items:center;gap:6px">' + IC_CHECK + ' รับสินค้าแล้ว' +
          (order.receivedAt ? ' เมื่อ ' + esc(fmt(order.receivedAt)) : '') +
          (order.receivedBy ? ' โดย ' + esc(order.receivedBy) : '') + '</div>';
        beepWarn();
      } else if (!canReceive) {
        banner = '<div class="banner warn-banner" style="display:flex;align-items:center;gap:6px">' + IC_WARN + ' ยังไม่พร้อมรับ &mdash; สถานะ: ' + esc(stLabel) + '</div>';
        beepWarn();
      } else {
        beepSuccess(); vibrate(80);
      }
      var action = '';
      if (canReceive) {
        var confirmDisabled = needChecklist ? ' disabled style="opacity:.45;cursor:not-allowed"' : '';
        action = '<button id="confirmBtn" class="btn-confirm" style="display:flex;align-items:center;justify-content:center;gap:6px"' + confirmDisabled + ' onclick="doReceive(\'' + esc(order.id || '') + '\')">' + IC_CHECK + ' ยืนยันรับสินค้า</button>' +
                 '<button class="btn-close" onclick="clearResult()">ยกเลิก</button>';
      } else if (alreadyReceived) {
        action = '<button class="btn-print" style="display:flex;align-items:center;justify-content:center;gap:6px" onclick="printReceipt()">' + IC_PRINT + ' พิมพ์ใบเสร็จ</button>' +
                 '<button class="btn-close" onclick="clearResult()">ปิด</button>';
      } else {
        action = '<button class="btn-close" onclick="clearResult()">ปิด</button>';
      }
      var phone = (cust.phone || '');
      var slipHtml = '';
      if (order.slip && order.slip.uploadedAt) {
        slipHtml = '<div class="slip-block"><div class="items-label">สลิปการชำระเงิน</div>' +
          '<img id="slipImg" class="slip-thumb" src="" alt="slip" onclick="expandSlip(this.src)" />' +
          '<div id="slipLoading" style="font-size:12px;color:var(--muted);padding:4px 0">กำลังโหลดสลิป...</div>' +
          '</div>';
      }
      var html = '<div class="result-card">' +
        '<div class="order-hdr"><span class="order-code">' + esc(order.id || '') + '</span><span class="st-badge ' + esc(st) + '">' + esc(stLabel) + '</span></div>' +
        banner +
        '<div class="cust-block"><div class="cust-name">' + esc(cust.fullName || '') + (order.roundNumber ? '<span style="margin-left:8px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:5px;background:var(--primary);color:#fff;vertical-align:middle">Phase ' + esc(String(order.roundNumber)) + '</span>' : '') + '</div>' +
          '<div class="cust-meta">' +
          (cust.studentCode ? '<span>' + esc(cust.studentCode) + '</span>' : '') +
          (cust.school ? '<span>' + esc(cust.school) + '</span>' : '') +
          (phone ? '<span style="display:inline-flex;align-items:center;gap:3px">' + IC_PHONE + ' ' + esc(phone) + '</span>' : '') +
          '</div></div>' +
        itemsHtml +
        slipHtml +
        khantok +
        '<div class="action-block">' + action + '</div>' +
      '</div>';
      _showResultMode();
      document.getElementById('resultCol').style.display = '';
      var sec = document.getElementById('resultSection');
      sec.innerHTML = html;
      if (order.slip && order.slip.uploadedAt) { loadSlipImage(order.id || ''); }
      sec.scrollIntoView({behavior:'smooth', block:'start'});
    }

    function loadSlipImage(orderId) {
      fetch('/claim-station/orders/' + encodeURIComponent(orderId) + '/slip', {
        headers: {'Authorization': 'Claim ' + currentToken}
      }).then(function(r) {
        if (!r.ok) throw new Error('slip ' + r.status);
        return r.blob();
      }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var img = document.getElementById('slipImg');
        var ld = document.getElementById('slipLoading');
        if (img) { img.src = url; img.style.display = 'block'; }
        if (ld) ld.style.display = 'none';
      }).catch(function() {
        var ld = document.getElementById('slipLoading');
        if (ld) ld.textContent = 'ไม่พบสลิป';
      });
    }

    function expandSlip(src) {
      if (!src) return;
      var overlay = document.createElement('div');
      overlay.className = 'slip-expand';
      overlay.innerHTML = '<img src="' + src + '" alt="slip">';
      overlay.onclick = function() { document.body.removeChild(overlay); };
      document.body.appendChild(overlay);
    }

    function updateConfirmBtn() {
      var btn = document.getElementById('confirmBtn');
      if (!btn) return;
      var chks = document.querySelectorAll('.item-chk');
      if (!chks.length) return;
      var allChecked = Array.from(chks).every(function(c) { return c.checked; });
      btn.disabled = !allChecked;
      btn.style.opacity = allChecked ? '' : '.45';
      btn.style.cursor = allChecked ? '' : 'not-allowed';
    }

    function showError(msg) {
      beepError(); vibrate([100, 80, 100]);
      _showResultMode();
      document.getElementById('resultCol').style.display = '';
      document.getElementById('resultSection').innerHTML =
        '<div class="err-card"><h3 style="display:flex;align-items:center;gap:6px">' + IC_WARN + ' ไม่พบออเดอร์</h3><p>' + esc(msg) + '</p><button class="btn-close" onclick="clearResult()">ปิด</button></div>';
    }

    function clearResult() {
      document.getElementById('resultCol').style.display = 'none';
      document.getElementById('resultSection').innerHTML = '';
      document.getElementById('manualInput').value = '';
      var sc = document.querySelector('.scan-col');
      var rc = document.querySelector('.recent-card');
      if (sc) sc.style.display = '';
      if (rc) rc.style.display = '';
      setScanStatus('กำลังสแกน QR Code...');
      scanCooldown = false;
    }
    function _showResultMode() {
      var sc = document.querySelector('.scan-col');
      var rc = document.querySelector('.recent-card');
      if (sc) sc.style.display = 'none';
      if (rc) rc.style.display = 'none';
    }

    async function doReceive(code) {
      var btn = document.getElementById('confirmBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
      try {
        var r = await fetch('/claim-station/orders/' + encodeURIComponent(code) + '/received', {
          method: 'PATCH',
          headers: {'Authorization':'Claim ' + currentToken, 'Content-Type':'application/json'},
          body: JSON.stringify({receivedBy: (currentStation ? currentUser + ' (' + currentStation + ')' : currentUser)})
        });
        if (r.status === 401) { doLogout(); return; }
        var d = await r.json();
        if (!r.ok) {
          if (r.status === 409) {
            beepWarn();
            await showCsDialog({type:'alert',icon:'warn',title:'รับไปแล้ว',message:d.message || 'ออเดอร์นี้ถูกรับสินค้าไปแล้ว'});
          } else {
            beepError();
            await showCsDialog({type:'alert',icon:'danger',title:'เกิดข้อผิดพลาด',message:d.message||'เกิดข้อผิดพลาด'});
          }
          if (btn) { btn.disabled = false; btn.innerHTML = IC_CHECK + ' ยืนยันรับสินค้า'; }
          return;
        }
        sessionClaimCount++;
        document.getElementById('statSession').textContent = String(sessionClaimCount);
        addRecentPickup(d.order);
        showOrderCard(d.order);
        setScanStatus('บันทึกแล้ว — พร้อมสแกนต่อ', 'success');
      } catch(e) {
        beepError();
        await showCsDialog({type:'alert',icon:'danger',title:'เชื่อมต่อไม่ได้',message:'ไม่สามารถเชื่อมต่อได้'});
        if (btn) { btn.disabled = false; }
      }
    }

    function addRecentPickup(order) {
      var cust = order.customer || {};
      var now = new Date();
      recentPickups.unshift({code: order.id || '', name: cust.fullName || '', time: String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'), order: order});
      if (recentPickups.length > 50) recentPickups.pop();
      loadStats();
      var html = '';
      for (var i = 0; i < recentPickups.length; i++) {
        var p = recentPickups[i];
        html += '<li class="recent-item" onclick="reloadOrder(' + i + ')">' +
          '<span class="r-time">' + esc(p.time) + '</span>' +
          '<span class="r-code">' + esc(p.code) + '</span>' +
          '<span class="r-name">' + esc(p.name) + '</span>' +
          '<span class="r-ok">' + IC_CHECK + '</span></li>';
      }
      document.getElementById('recentList').innerHTML = html;
    }

    function reloadOrder(i) {
      var p = recentPickups[i];
      if (p && p.order) { lastOrder = p.order; showOrderCard(p.order); }
    }

    /* ── Unclaimed export ── */
    function exportUnclaimed() {
      fetch('/claim-station/orders-pending', {headers: {'Authorization': 'Claim ' + currentToken}})
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function(d) {
          var rows = d.orders || [];
          if (!rows.length) { alert('ไม่มีออเดอร์ค้างรับ'); return; }
          var lines = ['﻿เลขออเดอร์,ชื่อ,รหัส นศ.,สถานศึกษา,รายการสินค้า,ยอดรวม'];
          rows.forEach(function(o) {
            var cust = o.customer || {};
            var items = (o.items && o.items.length) ? o.items : [{product: o.product, size: o.size, quantity: o.quantity}];
            var itemStr = items.map(function(it) {
              var p = it.product || {};
              return (p.shortName || p.name || '') + (it.size ? ' ' + it.size : '') + ' x' + (it.quantity || 1);
            }).join('; ');
            lines.push([o.id, cust.fullName, cust.studentCode, cust.school, itemStr, o.totalAmount].map(function(v) {
              return '"' + String(v || '').replace(/"/g, '""') + '"';
            }).join(','));
          });
          var blob = new Blob([lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'unclaimed_' + new Date().toISOString().slice(0,10) + '.csv';
          a.click();
          setTimeout(function() { URL.revokeObjectURL(url); }, 3000);
        }).catch(function() { alert('ไม่สามารถโหลดข้อมูลได้'); });
    }

    /* ── Print receipt ── */
    function rcptUnit(itm) {
      var p = itm.product || {};
      var cat = (p.category || '').toLowerCase();
      var nm = ((p.name || '') + ' ' + (p.shortName || '')).toLowerCase();
      if (cat.indexOf('headband') >= 0 || nm.indexOf('headband') >= 0 || nm.indexOf('ผ้าคาด') >= 0) return 'ผืน';
      return 'ตัว';
    }
    function toBahtText(n) {
      var amt = Math.round(n || 0);
      if (amt === 0) return 'ศูนย์บาทถ้วน';
      var ones = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
      function u100(x) {
        if (x === 0) return '';
        if (x < 10) return ones[x];
        var t = Math.floor(x/10), u = x%10;
        var ts = t === 1 ? 'สิบ' : (t === 2 ? 'ยี่สิบ' : ones[t]+'สิบ');
        return ts + (u === 0 ? '' : (t > 0 && u === 1 ? 'เอ็ด' : ones[u]));
      }
      function u1k(x) {
        if (x === 0) return '';
        var h = Math.floor(x/100), r = x%100;
        return (h > 0 ? ones[h]+'ร้อย' : '') + u100(r);
      }
      var res = '', a = amt;
      if (a >= 1000000) { res += u1k(Math.floor(a/1000000))+'ล้าน'; a %= 1000000; }
      if (a >= 100000)  { res += ones[Math.floor(a/100000)]+'แสน'; a %= 100000; }
      if (a >= 10000)   { res += ones[Math.floor(a/10000)]+'หมื่น'; a %= 10000; }
      if (a >= 1000)    { res += ones[Math.floor(a/1000)]+'พัน'; a %= 1000; }
      return res + u1k(a) + 'บาทถ้วน';
    }
    function printReceipt() {
      if (!lastOrder) return;
      var o = lastOrder;
      var cust = o.customer || {};
      var items = (o.items && o.items.length) ? o.items : [{product: o.product || {}, size: o.size || '', quantity: o.quantity || 1, totalAmount: o.totalAmount || 0}];
      function fmtRcptDate(s) {
        try {
          var iso = (s.indexOf('Z') < 0 && !/[+-]\d\d:\d\d$/.test(s)) ? s + 'Z' : s;
          var d = new Date(iso);
          return d.getDate() + '/' + (d.getMonth()+1) + '/' + (d.getFullYear()+543).toString().slice(-2);
        } catch(e) { return s; }
      }
      var dateStr = o.receivedAt ? fmtRcptDate(o.receivedAt) : (o.updatedAt ? fmtRcptDate(o.updatedAt) : '-');
      var minRows = 7;
      var rows = '';
      var rs = 'border:1px solid #000;padding:3px 5px;font-family:\'Sarabun\',\'TH Sarabun New\',\'Angsana New\',Arial,sans-serif;font-size:12px;';
      for (var i = 0; i < Math.max(items.length, minRows); i++) {
        if (i < items.length) {
          var itm = items[i]; var p = itm.product || {};
          var nm = (p.name || p.shortName || '');
          var sz = itm.size ? ' (Size ' + itm.size + ')' : '';
          var qty = itm.quantity || 1;
          var tot = itm.totalAmount || 0;
          var ppu = qty > 0 ? Math.round(tot / qty) : 0;
          var unit = rcptUnit(itm);
          rows += '<tr>' +
            '<td style="' + rs + 'text-align:center">' + (i+1) + '</td>' +
            '<td style="' + rs + '">' + nm + sz + '</td>' +
            '<td style="' + rs + 'text-align:center">' + qty + '</td>' +
            '<td style="' + rs + 'text-align:center">' + unit + '</td>' +
            '<td style="' + rs + 'text-align:right">' + ppu.toLocaleString('th-TH') + '</td>' +
            '<td style="' + rs + 'text-align:right">' + tot.toLocaleString('th-TH') + '</td>' +
            '</tr>';
        } else {
          rows += '<tr><td style="' + rs + 'height:24px"></td><td style="' + rs + '"></td><td style="' + rs + '"></td><td style="' + rs + '"></td><td style="' + rs + '"></td><td style="' + rs + '"></td></tr>';
        }
      }
      var totalAmt = o.totalAmount || 0;
      document.getElementById('rcptOrderId').textContent = o.id || '';
      document.getElementById('rcptDate').textContent = dateStr;
      document.getElementById('rcptName').textContent = cust.fullName || '';
      document.getElementById('rcptStudentId').textContent = cust.studentCode || '';
      document.getElementById('rcptSchool').textContent = cust.school || '';
      document.getElementById('rcptRows').innerHTML = rows;
      document.getElementById('rcptTotal').textContent = totalAmt.toLocaleString('th-TH');
      document.getElementById('rcptBahtText').textContent = toBahtText(totalAmt);
      window.print();
    }

    /* ── Custom dialog ── */
    var _csDlgResolve = null;
    var _CS_ICONS = {
      warn:   {bg:'#fef3c7',color:'#d97706',svg:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'},
      danger: {bg:'#fee2e2',color:'#dc2626',svg:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'},
      info:   {bg:'#dbeafe',color:'#2563eb',svg:'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'},
    };
    function _csDlgClose(val) {
      document.getElementById('csDlgBackdrop').style.display = 'none';
      if (_csDlgResolve) { _csDlgResolve(val); _csDlgResolve = null; }
    }
    function showCsDialog(opts) {
      return new Promise(function(resolve) {
        _csDlgResolve = resolve;
        var icon = _CS_ICONS[opts.icon || 'warn'] || _CS_ICONS.warn;
        var iconEl = document.getElementById('csDlgIcon');
        iconEl.style.background = icon.bg; iconEl.style.color = icon.color; iconEl.innerHTML = icon.svg;
        document.getElementById('csDlgTitle').textContent = opts.title || '';
        document.getElementById('csDlgMsg').textContent = opts.message || '';
        var confirmBtn = document.getElementById('csDlgConfirmBtn');
        confirmBtn.textContent = opts.confirmText || 'ตกลง';
        confirmBtn.style.background = opts.icon === 'danger' ? '#dc2626' : opts.icon === 'info' ? '#2563eb' : '#374151';
        var cancelBtn = document.getElementById('csDlgCancelBtn');
        cancelBtn.style.display = opts.type === 'alert' ? 'none' : '';
        document.getElementById('csDlgBackdrop').style.display = 'flex';
      });
    }
    document.addEventListener('click', function(e) {
      var id = e.target.id;
      if (id === 'csDlgConfirmBtn') _csDlgClose(true);
      else if (id === 'csDlgCancelBtn' || id === 'csDlgCloseBtn') _csDlgClose(false);
      else if (id === 'csDlgBackdrop') _csDlgClose(false);
    });
  </script>

  <div id="idleOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:8000;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#fff">
    <div><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
    <h2 style="font-size:22px;font-weight:700;margin:0">หน้าจอถูกล็อก</h2>
    <p style="font-size:14px;color:rgba(255,255,255,.6);margin:0">แตะหน้าจอเพื่อปลดล็อก</p>
  </div>

  <div id="csDlgBackdrop" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:9999;align-items:center;justify-content:center;padding:16px">
    <div style="position:relative;background:var(--card);border-radius:18px;padding:32px 28px 24px;width:min(440px,100%);box-shadow:0 12px 48px rgba(0,0,0,.22);text-align:center">
      <button id="csDlgCloseBtn" style="position:absolute;top:12px;right:14px;background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;line-height:1">&#215;</button>
      <div id="csDlgIcon" style="width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"></div>
      <h3 id="csDlgTitle" style="font-size:17px;font-weight:800;color:var(--ink);margin-bottom:8px"></h3>
      <p id="csDlgMsg" style="font-size:14px;color:var(--muted);margin-bottom:22px;line-height:1.55"></p>
      <div style="display:flex;gap:10px">
        <button id="csDlgConfirmBtn" style="flex:1;height:44px;border:none;border-radius:10px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;transition:opacity .15s"></button>
        <button id="csDlgCancelBtn" style="flex:1;height:44px;border:1.5px solid var(--border);border-radius:10px;font-size:15px;font-weight:600;background:none;color:var(--muted);cursor:pointer">ยกเลิก</button>
      </div>
    </div>
  </div>

  <div id="printReceipt">
    <div style="font-family:'Sarabun','TH Sarabun New','Angsana New',Arial,sans-serif;font-size:13px;color:#000;background:#fff">

      <!-- Header: title left, SU logo right -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div>
          <div style="font-size:21px;font-weight:900;line-height:1.1">ใบเสร็จรับเงิน</div>
          <div style="font-size:15px;font-weight:400;line-height:1.3">Receipt</div>
        </div>
        <!-- SU Logo official -->
        <img src="data:image/png;base64,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" width="76" height="76" style="flex-shrink:0;display:block" alt="SU Logo"/>
      </div>


      <!-- Issuer (left) + document number fields (right) -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:12px;line-height:1.65">
          <div style="font-weight:700;font-size:11px;margin-bottom:2px">ผู้ออก / issuer</div>
          <div style="font-weight:700">องค์การบริหาร องค์การนักศึกษา มหาวิทยาลัยแม่ฟ้าหลวง</div>
          <div>333 หมู่ 1 ตำบลท่าสุด อำเภอเมือง จังหวัดเชียงราย 57100</div>
          <div style="font-weight:700">Student Union, Mae Fah Luang University</div>
          <div>333 Moo 1, Tha Sud, Mueang Chiang Rai, Chiang Rai 57100</div>
        </div>
        <div style="font-size:11px;line-height:1.85;text-align:right;padding-left:10px">
          <div style="white-space:nowrap">เล่มที่ / No <span style="display:inline-block;min-width:44px;border-bottom:1px dotted #555;text-align:left;padding-left:3px"></span></div>
          <div style="white-space:nowrap">เลขที่ / issue <span id="rcptOrderId" style="display:inline-block;min-width:44px;border-bottom:1px dotted #555;text-align:left;padding-left:3px"></span></div>
          <div style="white-space:nowrap">วันที่ / date <span id="rcptDate" style="display:inline-block;min-width:44px;border-bottom:1px dotted #555;text-align:left;padding-left:3px"></span></div>
        </div>
      </div>


      <div style="border-top:1px solid #000;margin-bottom:7px"></div>

      <!-- Customer section -->
      <div style="margin-bottom:10px;font-size:12px">
        <div style="font-weight:700;font-size:11px;margin-bottom:4px">ลูกค้า / customer</div>
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:2px 0;white-space:nowrap;font-size:12px">ชื่อ - สกุล / name - surname</td>
            <td style="padding:2px 6px;border-bottom:1px dotted #555;width:99%;font-size:12px"><span id="rcptName"></span></td>
          </tr>
          <tr>
            <td style="padding:3px 0;white-space:nowrap;font-size:12px">รหัสนักศึกษา / student ID</td>
            <td style="padding:3px 6px;border-bottom:1px dotted #555;font-size:12px"><span id="rcptStudentId"></span></td>
          </tr>
          <tr>
            <td style="padding:3px 0;white-space:nowrap;font-size:12px">สำนักวิชา / school of</td>
            <td style="padding:3px 6px;border-bottom:1px dotted #555;font-size:12px"><span id="rcptSchool"></span></td>
          </tr>
        </table>
      </div>

      <!-- Items table -->
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center;width:26px">ที่</th>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center">รายการ</th>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center;width:46px">จำนวน</th>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center;width:36px">หน่วย</th>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center;width:68px">ราคา/หน่วย</th>
            <th style="border:1px solid #000;padding:3px 4px;text-align:center;width:68px">ราคารวม</th>
          </tr>
        </thead>
        <tbody id="rcptRows"></tbody>
        <tfoot>
          <tr>
            <td rowspan="2" colspan="2" style="border:1px solid #000;padding:4px 6px;vertical-align:top;font-size:11px">หมายเหตุ / remarks</td>
            <td colspan="3" style="border:1px solid #000;padding:4px 5px;text-align:center;font-weight:700;font-size:12px">รวมเป็นเงิน</td>
            <td id="rcptTotal" style="border:1px solid #000;padding:4px 5px;text-align:right;font-weight:700;font-size:12px"></td>
          </tr>
          <tr>
            <td colspan="4" id="rcptBahtText" style="border:1px solid #000;padding:3px 5px;text-align:center;font-size:11px"></td>
          </tr>
        </tfoot>
      </table>

      <!-- Payment method -->
      <div style="margin-top:10px;font-size:12px">
        <div style="font-weight:700">วิธีการชำระเงิน / Payment Method :</div>
        <div style="line-height:1.9;margin-top:2px">
          <div>&#9744; ชำระโดยการโอน / Payment via bank transfer</div>
          <div>&#9744; ชำระโดยเงินสด / Payment in cash</div>
        </div>
      </div>

      <!-- Signature lines — left blank for hand-signing -->
      <div style="display:flex;justify-content:space-around;margin-top:30px">
        <div style="text-align:center;width:38%">
          <div style="border-bottom:1px dotted #555;margin-bottom:4px;height:28px"></div>
          <div style="font-size:12px">( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )</div>
          <div style="font-size:12px;margin-top:3px">ผู้จ่ายเงิน</div>
        </div>
        <div style="text-align:center;width:38%">
          <div style="border-bottom:1px dotted #555;margin-bottom:4px;height:28px"></div>
          <div style="font-size:12px">( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )</div>
          <div style="font-size:12px;margin-top:3px">ผู้รับเงิน</div>
        </div>
      </div>

      <!-- hidden compat element -->
      <span id="rcptReceiverName" style="display:none"></span>
    </div>
  </div>
</body>
</html>"""


TZ_BANGKOK = timezone(timedelta(hours=7))


def now_iso() -> str:
    return datetime.now(TZ_BANGKOK).replace(microsecond=0).isoformat()


def log_audit(connection: sqlite3.Connection, order_code: str, event: str, detail: str = "") -> None:
    connection.execute(
        "INSERT INTO order_audit_log (order_code, event, detail, created_at) VALUES (?, ?, ?, ?)",
        (order_code, event, detail, now_iso()),
    )


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SLIPS_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH, timeout=30) as connection:
      connection.execute("PRAGMA journal_mode=WAL")
      connection.execute("PRAGMA synchronous=NORMAL")
      connection.execute("PRAGMA busy_timeout=30000")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS orders (
              internal_id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT UNIQUE,
              round_number INTEGER NOT NULL,
              status TEXT NOT NULL,
              payment_status TEXT NOT NULL,
              khantok_ticket INTEGER NOT NULL DEFAULT 0,
              khantok_ticket_claimed_at TEXT,
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
              items_json TEXT NOT NULL DEFAULT '[]',
              student_code TEXT NOT NULL DEFAULT '',
              full_name TEXT NOT NULL DEFAULT '',
              parent_phone TEXT NOT NULL DEFAULT '',
              first_name TEXT NOT NULL,
              last_name TEXT NOT NULL,
              nickname TEXT NOT NULL,
              email TEXT NOT NULL,
              phone TEXT NOT NULL,
              school TEXT NOT NULL,
              access_token TEXT NOT NULL,
              slip_original_name TEXT,
              slip_stored_name TEXT,
              slip_storage_path TEXT,
              slip_mime_type TEXT,
              slip_size INTEGER,
              slip_uploaded_at TEXT
          )
          """
      )
      columns = {
          row[1]
          for row in connection.execute("PRAGMA table_info(orders)").fetchall()
      }
      if "access_token" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN access_token TEXT")
      if "slip_storage_path" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN slip_storage_path TEXT")
      if "khantok_ticket" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket INTEGER NOT NULL DEFAULT 0")
      if "khantok_ticket_claimed_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_claimed_at TEXT")
      if "lucky_ticket" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantok_ticket = lucky_ticket
              WHERE khantok_ticket = 0 AND lucky_ticket = 1
              """
          )
      if "lucky_ticket_claimed_at" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantok_ticket_claimed_at = lucky_ticket_claimed_at
              WHERE
                  (khantok_ticket_claimed_at IS NULL OR khantok_ticket_claimed_at = '')
                  AND lucky_ticket_claimed_at IS NOT NULL
                  AND lucky_ticket_claimed_at != ''
              """
          )
      if "khantok_ticket_already_claimed" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_already_claimed INTEGER NOT NULL DEFAULT 0")
      if "khantok_ticket_value" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantok_ticket_value INTEGER")
      if "student_code" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN student_code TEXT NOT NULL DEFAULT ''")
      if "full_name" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
      if "parent_phone" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN parent_phone TEXT NOT NULL DEFAULT ''")
      if "items_json" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'")
      if "admin_note" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN admin_note TEXT")
      if "received_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN received_at TEXT")
      if "received_by" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN received_by TEXT")
      existing_rows = connection.execute(
          "SELECT internal_id FROM orders WHERE access_token IS NULL OR access_token = ''"
      ).fetchall()
      for row in existing_rows:
          connection.execute(
              "UPDATE orders SET access_token = ? WHERE internal_id = ?",
              (create_order_access_token(), row[0]),
          )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS khantok_ticket_claims (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_id INTEGER NOT NULL UNIQUE,
              claimed_at TEXT NOT NULL,
              ticket_value INTEGER NOT NULL DEFAULT 100,
              FOREIGN KEY (order_id) REFERENCES orders(internal_id)
          )
          """
      )
      existing_tables = {
          row[0]
          for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
      }
      if "lucky_ticket_claims" in existing_tables:
          connection.execute(
              """
              INSERT OR IGNORE INTO khantok_ticket_claims (order_id, claimed_at)
              SELECT order_id, claimed_at FROM lucky_ticket_claims
              """
          )
      claim_columns = {
          row[1]
          for row in connection.execute("PRAGMA table_info(khantok_ticket_claims)").fetchall()
      }
      if "ticket_value" not in claim_columns:
          connection.execute("ALTER TABLE khantok_ticket_claims ADD COLUMN ticket_value INTEGER NOT NULL DEFAULT 100")
      connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              slug TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              short_name TEXT NOT NULL,
              tagline TEXT NOT NULL,
              description TEXT NOT NULL,
              price INTEGER NOT NULL,
              category TEXT NOT NULL,
              requires_size INTEGER NOT NULL DEFAULT 1,
              requires_school INTEGER NOT NULL DEFAULT 1,
              available INTEGER NOT NULL DEFAULT 1,
              image_path TEXT NOT NULL DEFAULT '',
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS site_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code TEXT NOT NULL,
              event TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_order_code ON order_audit_log(order_code)")
      connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_created_at ON order_audit_log(created_at)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS slip_ocr_results (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code   TEXT UNIQUE NOT NULL,
              status       TEXT NOT NULL DEFAULT 'pending',
              ref_number   TEXT,
              amount       REAL,
              date         TEXT,
              sender       TEXT,
              bank         TEXT,
              duplicate_of TEXT,
              raw_reason   TEXT,
              checked_at   TEXT
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_ocr_ref ON slip_ocr_results(ref_number)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_extra_slips (
              id           INTEGER PRIMARY KEY AUTOINCREMENT,
              order_code   TEXT NOT NULL,
              original_name TEXT,
              stored_name  TEXT NOT NULL,
              storage_path TEXT,
              mime_type    TEXT,
              file_size    INTEGER,
              uploaded_at  TEXT NOT NULL
          )
          """
      )
      connection.execute("CREATE INDEX IF NOT EXISTS idx_extra_slips_order_code ON order_extra_slips(order_code)")
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS order_backups (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              label TEXT NOT NULL DEFAULT '',
              order_count INTEGER NOT NULL DEFAULT 0,
              orders_json TEXT NOT NULL DEFAULT '[]'
          )
          """
      )
      connection.execute(
          """
          CREATE TABLE IF NOT EXISTS admin_users (
              username TEXT PRIMARY KEY,
              claim_token TEXT NOT NULL,
              super_token TEXT,
              is_superadmin INTEGER NOT NULL DEFAULT 0,
              created_by TEXT NOT NULL DEFAULT 'system',
              created_at TEXT NOT NULL
          )
          """
      )
      if not connection.execute("SELECT 1 FROM admin_users WHERE username=?", (PICKUP_USERNAME,)).fetchone():
          if PICKUP_PASSWORD:
              seed_now = now_iso()
              connection.execute(
                  "INSERT OR IGNORE INTO admin_users (username,claim_token,super_token,is_superadmin,created_by,created_at) VALUES (?,?,?,1,'system',?)",
                  (PICKUP_USERNAME, CLAIM_STATION_TOKEN, SUPER_TOKEN, seed_now),
              )
      product_count_row = connection.execute("SELECT COUNT(*) FROM products").fetchone()
      if product_count_row[0] == 0:
          seed_now = now_iso()
          for p in DEFAULT_PRODUCTS:
              connection.execute(
                  """
                  INSERT OR IGNORE INTO products
                  (slug, name, short_name, tagline, description, price, category,
                   requires_size, requires_school, available, image_path, sort_order, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                  """,
                  (
                      p["slug"], p["name"], p["short_name"], p["tagline"], p["description"],
                      p["price"], p["category"], p["requires_size"], p["requires_school"],
                      p["image_path"], p["sort_order"], seed_now, seed_now,
                  ),
              )


def open_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def compute_claim_token(username: str, password: str) -> str:
    return hmac.new(
        key=(username + ":" + password).encode("utf-8"),
        msg=b"claim-station-v1",
        digestmod="sha256",
    ).hexdigest()


def compute_qr_token(order_code: str) -> str:
    """Short HMAC token embedded in QR codes so staff can't forge scan codes."""
    if not ORDER_API_TOKEN:
        return ""
    return hmac.new(
        key=ORDER_API_TOKEN.encode("utf-8"),
        msg=f"qr-v1:{order_code}".encode("utf-8"),
        digestmod="sha256",
    ).hexdigest()[:16]


def compute_super_token(username: str, password: str) -> str:
    return hmac.new(
        key=(username + ":" + password).encode("utf-8"),
        msg=b"superadmin-v1",
        digestmod="sha256",
    ).hexdigest()


def get_current_phase(connection: sqlite3.Connection | None = None) -> int:
    if connection is not None:
        row = connection.execute(
            "SELECT value FROM site_settings WHERE key = 'phase_override'"
        ).fetchone()
        if row is not None and row["value"] not in ("", None):
            try:
                return int(row["value"])
            except (ValueError, TypeError):
                pass
        config_row = connection.execute(
            "SELECT value FROM site_settings WHERE key = 'phase_configs'"
        ).fetchone()
        if config_row is not None and config_row["value"]:
            try:
                configs = json.loads(config_row["value"])
                today = datetime.now(TZ_BANGKOK).date()
                for phase_str, info in configs.items():
                    s, e = info.get("start", ""), info.get("end", "")
                    if s and e and date.fromisoformat(s) <= today <= date.fromisoformat(e):
                        return int(phase_str)
            except (json.JSONDecodeError, ValueError, KeyError):
                pass
    now = datetime.now(TZ_BANGKOK)
    m, d = now.month, now.day
    if m == 5 and 18 <= d <= 23: return 1
    if m == 5 and 25 <= d <= 30: return 2
    if m == 6 and  1 <= d <= 7:  return 3
    return 0


def create_order_code(sequence_number: int, connection: sqlite3.Connection | None = None) -> str:
    return f"{ORDER_PREFIX}{sequence_number:04d}{get_current_phase(connection)}"


def create_order_access_token() -> str:
    return secrets.token_hex(24)


def sanitize_file_name(file_name: str) -> str:
    sanitized = re.sub(r"[^a-z0-9.-]+", "-", file_name.strip().lower())
    sanitized = re.sub(r"-+", "-", sanitized).strip("-")
    return sanitized or "slip"


def resolve_slip_extension(file_name: str, mime_type: str) -> str:
    original_extension = Path(file_name).suffix.lower()
    if original_extension:
        return original_extension
    if mime_type == "image/jpeg":
        return ".jpg"
    if mime_type == "image/png":
        return ".png"
    if mime_type == "image/webp":
        return ".webp"
    if mime_type == "application/pdf":
        return ".pdf"
    return ".bin"


def resolve_stored_slip_path(stored_name: str | None, stored_path: str | None = None) -> Path | None:
    if isinstance(stored_path, str) and stored_path.strip():
        candidate = Path(stored_path.strip())
        if not candidate.is_absolute():
            return SLIPS_DIR / candidate.name
        return candidate

    if not stored_name:
        return None

    target_name = Path(str(stored_name)).name
    if not target_name:
        return None
    return SLIPS_DIR / target_name


def delete_local_slip_file(stored_name: str | None, stored_path: str | None = None) -> None:
    target_path = resolve_stored_slip_path(stored_name, stored_path)
    if target_path is None:
        return
    try:
        target_path.unlink()
    except FileNotFoundError:
        return


def persist_slip_file(
    order_code: str,
    original_name: str,
    mime_type: str,
    uploaded_at: str,
    file_content: bytes,
) -> tuple[dict[str, Any] | None, str | None]:
    if mime_type not in ALLOWED_SLIP_TYPES:
        return None, "unsupported slip mime type"

    file_size = len(file_content)
    if file_size < 1 or file_size > MAX_SLIP_SIZE_BYTES:
        return None, "slip.size must be between 1 and 5242880"

    safe_name = sanitize_file_name(Path(original_name).stem)
    extension = resolve_slip_extension(original_name, mime_type)
    stored_name = f"{order_code}-{int(datetime.now(timezone.utc).timestamp())}-{safe_name}{extension}"
    stored_path = SLIPS_DIR / stored_name
    stored_path.write_bytes(file_content)

    normalized_slip = {
        "originalName": original_name,
        "storedName": stored_name,
        "storedPath": str(stored_path),
        "mimeType": mime_type,
        "size": file_size,
        "uploadedAt": uploaded_at,
    }
    return normalized_slip, None


def materialize_slip_payload(order_code: str, slip: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    file_content_base64 = slip.get("fileContentBase64")
    if not isinstance(file_content_base64, str) or not file_content_base64.strip():
        stored_name = slip.get("storedName")
        stored_path = slip.get("storedPath")
        if (not isinstance(stored_name, str) or not stored_name.strip()) and isinstance(stored_path, str) and stored_path.strip():
            stored_name = Path(stored_path).name
        if not isinstance(stored_name, str) or not stored_name.strip():
            return None, "slip.storedName is required"
        return {
            "originalName": slip["originalName"],
            "storedName": Path(stored_name).name,
            "storedPath": str(resolve_stored_slip_path(stored_name, str(stored_path) if isinstance(stored_path, str) else None)),
            "mimeType": slip["mimeType"],
            "size": int(slip["size"]),
            "uploadedAt": slip["uploadedAt"],
        }, None

    mime_type = slip.get("mimeType")
    if not isinstance(mime_type, str) or mime_type not in ALLOWED_SLIP_TYPES:
        return None, "unsupported slip mime type"

    file_size = slip.get("size")
    if not isinstance(file_size, int) or file_size < 1 or file_size > MAX_SLIP_SIZE_BYTES:
        return None, "slip.size must be between 1 and 5242880"

    try:
        file_content = base64.b64decode(file_content_base64.encode("utf-8"), validate=True)
    except (binascii.Error, ValueError):
        return None, "slip.fileContentBase64 is invalid"

    if len(file_content) != file_size:
        return None, "slip.size does not match uploaded content"

    return persist_slip_file(
        order_code,
        str(slip["originalName"]),
        mime_type,
        str(slip["uploadedAt"]),
        file_content,
    )


def serialize_order(row: sqlite3.Row, include_access_token: bool = False) -> dict[str, Any]:
    row_keys = set(row.keys())
    slip = None
    if row["slip_stored_name"]:
        slip = {
            "originalName": row["slip_original_name"],
            "storedName": row["slip_stored_name"],
            "storedPath": row["slip_storage_path"] or str(resolve_stored_slip_path(row["slip_stored_name"])),
            "mimeType": row["slip_mime_type"],
            "size": row["slip_size"],
            "uploadedAt": row["slip_uploaded_at"],
        }
    items: list[dict[str, Any]] = []
    if "items_json" in row_keys and row["items_json"]:
        try:
            parsed_items = json.loads(row["items_json"])
            if isinstance(parsed_items, list):
                items = [item for item in parsed_items if isinstance(item, dict)]
        except json.JSONDecodeError:
            items = []

    if not items:
        items = [
            {
                "id": row["product_slug"],
                "product": {
                    "slug": row["product_slug"],
                    "name": row["product_name"],
                    "shortName": row["product_short_name"],
                    "tagline": row["product_tagline"],
                    "price": row["product_price"],
                    "image": row["product_image"],
                    "category": row["product_category"],
                },
                "size": row["size"],
                "quantity": row["quantity"],
                "unitPrice": row["product_price"],
                "totalAmount": row["product_price"] * row["quantity"],
            }
        ]

    payload = {
        "id": row["order_code"],
        "sequenceNumber": row["internal_id"],
        "roundNumber": row["round_number"],
        "status": row["status"],
        "paymentStatus": row["payment_status"],
        "khantokTicket": bool(
            row["khantok_ticket"] if "khantok_ticket" in row_keys else row["lucky_ticket"]
        ),
        "khantokTicketClaimedAt": (
            row["khantok_ticket_claimed_at"]
            if "khantok_ticket_claimed_at" in row_keys
            else row["lucky_ticket_claimed_at"]
        ),
        "khantokTicketAlreadyClaimed": bool(row["khantok_ticket_already_claimed"]) if "khantok_ticket_already_claimed" in row_keys else False,
        "khantokTicketValue": int(row["khantok_ticket_value"]) if "khantok_ticket_value" in row_keys and row["khantok_ticket_value"] is not None else None,
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
        "items": items,
        "customer": {
            "studentCode": row["student_code"] or "",
            "email": row["email"],
            "fullName": row["full_name"] or " ".join(
                value for value in [row["first_name"], row["last_name"]] if value
            ).strip(),
            "phone": row["phone"],
            "school": row["school"],
            "parentPhone": row["parent_phone"] or "",
        },
        "slip": slip,
        "adminNote": row["admin_note"] if "admin_note" in row_keys else None,
        "receivedAt": row["received_at"] if "received_at" in row_keys else None,
        "receivedBy": row["received_by"] if "received_by" in row_keys else None,
        "qrToken": compute_qr_token(row["order_code"]),
    }
    if include_access_token:
        payload["accessToken"] = row["access_token"]
    return payload


def create_sheet_row_payload(order: dict[str, Any], event: str) -> dict[str, Any]:
    product = order.get("product") or {}
    customer = order.get("customer") or {}
    slip = order.get("slip") or {}
    return {
        "orderId": order.get("id", ""),
        "orderNumber": order.get("id", ""),
        "roundNumber": order.get("roundNumber", ""),
        "sequenceNumber": order.get("sequenceNumber", ""),
        "status": order.get("status", ""),
        "paymentStatus": order.get("paymentStatus", ""),
        "khantokTicket": order.get("khantokTicket", order.get("luckyTicket", False)),
        "khantokTicketValue": order.get("khantokTicketValue"),
        "khantokTicketClaimedAt": order.get(
            "khantokTicketClaimedAt", order.get("luckyTicketClaimedAt", "")
        ),
        "createdAt": order.get("createdAt", ""),
        "updatedAt": order.get("updatedAt", ""),
        "lastEvent": event,
        "lastSyncedAt": now_iso(),
        "productSlug": product.get("slug", ""),
        "productName": product.get("name", ""),
        "productShortName": product.get("shortName", ""),
        "productTagline": product.get("tagline", ""),
        "productCategory": product.get("category", ""),
        "productImage": product.get("image", ""),
        "unitPrice": product.get("price", ""),
        "size": order.get("size", ""),
        "quantity": order.get("quantity", ""),
        "totalAmount": order.get("totalAmount", ""),
        "studentCode": customer.get("studentCode", ""),
        "email": customer.get("email", ""),
        "fullName": customer.get("fullName", ""),
        "phone": customer.get("phone", ""),
        "school": customer.get("school", ""),
        "parentPhone": customer.get("parentPhone", ""),
        "slipOriginalName": slip.get("originalName", ""),
        "slipStoredName": slip.get("storedName", ""),
        "slipStoredPath": slip.get("storedPath", ""),
        "slipMimeType": slip.get("mimeType", ""),
        "slipSize": slip.get("size", ""),
        "slipUploadedAt": slip.get("uploadedAt", ""),
    }


def sync_order_to_google_sheets(order: dict[str, Any], event: str) -> None:
    if not GOOGLE_SHEETS_WEBHOOK_URL:
        return

    payload = {
        "event": event,
        "syncedAt": now_iso(),
        "token": GOOGLE_SHEETS_WEBHOOK_TOKEN,
        "row": create_sheet_row_payload(order, event),
        "order": order,
    }
    request_headers = {
        "Content-Type": "application/json; charset=utf-8",
    }

    request = urllib.request.Request(
        GOOGLE_SHEETS_WEBHOOK_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"unexpected response status {response.status}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as error:
        print(f"[google-sheets-sync] failed to sync order {order.get('id', '')}: {error}")


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

    required_customer_fields = [
        "studentCode",
        "email",
        "fullName",
        "phone",
        "school",
        "parentPhone",
    ]
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

    raw_items = payload.get("items")
    normalized_items: list[dict[str, Any]] = []
    if isinstance(raw_items, list) and raw_items:
        for index, item in enumerate(raw_items):
            if not isinstance(item, dict):
                return None, "items must contain objects"

            item_product = item.get("product")
            if not isinstance(item_product, dict):
                return None, "item.product is required"

            for field in required_product_fields:
                if field not in item_product or item_product[field] in (None, ""):
                    return None, f"items[{index}].product.{field} is required"

            item_size = item.get("size")
            item_quantity = item.get("quantity")
            item_unit_price = item.get("unitPrice", item_product.get("price"))
            item_total_amount = item.get("totalAmount")

            if not isinstance(item_size, str) or not item_size.strip():
                return None, f"items[{index}].size is required"
            if not isinstance(item_quantity, int) or item_quantity < 1:
                return None, f"items[{index}].quantity must be a positive integer"
            if not isinstance(item_unit_price, int) or item_unit_price < 0:
                return None, f"items[{index}].unitPrice must be a non-negative integer"
            if not isinstance(item_total_amount, int):
                item_total_amount = item_unit_price * item_quantity

            item_school = item.get("school")
            normalized_items.append(
                {
                    "id": str(item.get("id") or f"{item_product.get('slug', 'item')}-{index + 1}"),
                    "product": item_product,
                    "size": item_size.strip(),
                    "school": item_school if isinstance(item_school, str) and item_school.strip() else None,
                    "quantity": item_quantity,
                    "unitPrice": item_unit_price,
                    "totalAmount": item_total_amount,
                }
            )

    if not normalized_items:
        normalized_items = [
            {
                "id": str(product.get("slug") or "item-1"),
                "product": product,
                "size": size.strip(),
                "quantity": quantity,
                "unitPrice": int(product["price"]),
                "totalAmount": int(product["price"]) * quantity,
            }
        ]

    return {
        "product": product,
        "customer": customer,
        "size": size.strip(),
        "quantity": quantity,
        "total_amount": total_amount,
        "items": normalized_items,
    }, None


def validate_slip_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "payload ต้องเป็น JSON object"
    slip = payload.get("slip")
    if not isinstance(slip, dict):
        return None, "payload ต้องมี slip"

    required_fields = ["originalName", "mimeType", "size", "uploadedAt"]
    for field in required_fields:
        if field not in slip or slip[field] in (None, ""):
            return None, f"slip.{field} is required"

    if (
        ("storedName" not in slip or slip["storedName"] in (None, ""))
        and ("storedPath" not in slip or slip["storedPath"] in (None, ""))
        and ("fileContentBase64" not in slip or slip["fileContentBase64"] in (None, ""))
    ):
        return None, "slip.storedName, slip.storedPath or slip.fileContentBase64 is required"

    return slip, None


def fetch_order_by_code(connection: sqlite3.Connection, order_code: str) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM orders WHERE order_code = ?",
        (order_code,),
    ).fetchone()


def list_orders(
    connection: sqlite3.Connection,
    *,
    page: int = 1,
    per_page: int = 50,
    search: str = "",
    status_filter: str = "",
    round_filter: int = 0,
    student_code_filter: str = "",
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[str] = []
    params: list[Any] = []
    if round_filter > 0:
        conditions.append("round_number = ?")
        params.append(round_filter)
    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)
    if student_code_filter:
        conditions.append("student_code LIKE ?")
        params.append(f"%{student_code_filter}%")
    if search:
        like = f"%{search}%"
        conditions.append(
            "(order_code LIKE ? OR full_name LIKE ? OR student_code LIKE ? OR phone LIKE ? OR school LIKE ? OR product_name LIKE ?)"
        )
        params.extend([like] * 6)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    total_row = connection.execute(f"SELECT COUNT(*) AS cnt FROM orders {where}", params).fetchone()
    total = int(total_row["cnt"] if total_row else 0)
    offset = (page - 1) * per_page
    rows = connection.execute(
        f"SELECT * FROM orders {where} ORDER BY internal_id DESC LIMIT ? OFFSET ?",
        params + [per_page, offset],
    ).fetchall()
    return [serialize_order(row) for row in rows], total


def create_orders_summary(connection: sqlite3.Connection, round_filter: int = 0) -> dict[str, int]:
    settings_rows = connection.execute("SELECT key, value FROM site_settings WHERE key IN ('khantok_quota_100','khantok_quota_50')").fetchall()
    settings_map = {row["key"]: row["value"] for row in settings_rows}
    quota_100 = int(settings_map.get("khantok_quota_100") or KHANTOK_QUOTA_100)
    quota_50 = int(settings_map.get("khantok_quota_50") or KHANTOK_QUOTA_50)
    round_where = "AND round_number = ?" if round_filter > 0 else ""
    round_params: list[Any] = [round_filter] if round_filter > 0 else []
    used_100 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 100"
    ).fetchone()["c"])
    used_50 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 50"
    ).fetchone()["c"])
    counts = {
        row["status"]: row["cnt"]
        for row in connection.execute(
            f"SELECT status, COUNT(*) AS cnt FROM orders WHERE 1=1 {round_where} GROUP BY status",
            round_params,
        ).fetchall()
    }
    total_row = connection.execute(f"SELECT COUNT(*) AS cnt FROM orders WHERE 1=1 {round_where}", round_params).fetchone()
    # Count per-category qty from items_json so multi-item orders are fully counted
    # Exclude rejected and cancelled orders from product quantity totals
    category_counts: dict[str, int] = {}
    for row in connection.execute(
        f"SELECT items_json, product_category, quantity FROM orders WHERE status NOT IN ('rejected', 'cancelled') {round_where}",
        round_params,
    ).fetchall():
        counted = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list) and parsed:
                    for item in parsed:
                        cat = (item.get("product") or {}).get("category") or ""
                        qty = item.get("quantity") or 0
                        if cat:
                            category_counts[cat] = category_counts.get(cat, 0) + int(qty)
                    counted = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if not counted:
            cat = row["product_category"] or ""
            if cat:
                category_counts[cat] = category_counts.get(cat, 0) + int(row["quantity"] or 0)
    return {
        "total": int(total_row["cnt"] if total_row else 0),
        "pendingPayment": counts.get("pending_payment", 0),
        "waitingConfirm": counts.get("waiting_confirm", 0),
        "paid": counts.get("paid", 0) + counts.get("preparing", 0) + counts.get("shipped", 0) + counts.get("received", 0),
        "received": counts.get("received", 0),
        "rejected": counts.get("rejected", 0),
        "cancelled": counts.get("cancelled", 0),
        "khantokTicket100Quota": quota_100,
        "khantokTicket100Used": used_100,
        "khantokTicket100Remaining": max(quota_100 - used_100, 0),
        "khantokTicket50Quota": quota_50,
        "khantokTicket50Used": used_50,
        "khantokTicket50Remaining": max(quota_50 - used_50, 0),
        "qtySingle": category_counts.get("single", 0),
        "qtyJacket": category_counts.get("jacket", 0),
        "qtyHeadband": category_counts.get("headband", 0),
    }


def update_order_status(
    connection: sqlite3.Connection,
    order_code: str,
    status: str,
) -> dict[str, Any] | None:
    existing_order = fetch_order_by_code(connection, order_code)
    if existing_order is None:
        return None

    payment_status = PAYMENT_STATUS_BY_ORDER_STATUS[status]
    connection.execute(
        """
        UPDATE orders
        SET status = ?, payment_status = ?, updated_at = ?
        WHERE order_code = ?
        """,
        (status, payment_status, now_iso(), order_code),
    )
    log_audit(connection, order_code, "status_changed", f"{existing_order['status']} → {status}")
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def update_order_fields(
    connection: sqlite3.Connection,
    order_code: str,
    fields: dict[str, Any],
) -> dict[str, Any] | None:
    existing = fetch_order_by_code(connection, order_code)
    if existing is None:
        return None

    allowed: dict[str, Any] = {}
    str_fields = {
        "fullName": "full_name",
        "studentCode": "student_code",
        "phone": "phone",
        "parentPhone": "parent_phone",
        "school": "school",
        "email": "email",
        "nickname": "nickname",
    }
    for key, col in str_fields.items():
        if key in fields and isinstance(fields[key], str):
            allowed[col] = fields[key].strip()

    if "adminNote" in fields:
        note = fields["adminNote"]
        allowed["admin_note"] = note.strip() if isinstance(note, str) else None

    # Khantok ticket — always sync khantok_ticket_claims together with orders fields
    khantok_changed = "khantokTicket" in fields and isinstance(fields["khantokTicket"], bool)
    value_changed = "khantokTicketValue" in fields
    claimed_changed = "khantokTicketAlreadyClaimed" in fields and isinstance(fields["khantokTicketAlreadyClaimed"], bool)

    if khantok_changed or value_changed or claimed_changed:
        order_id = existing["internal_id"]
        old_has_ticket = bool(existing["khantok_ticket"])
        new_has_ticket = fields["khantokTicket"] if khantok_changed else old_has_ticket

        if khantok_changed:
            allowed["khantok_ticket"] = 1 if new_has_ticket else 0
        if claimed_changed:
            allowed["khantok_ticket_already_claimed"] = 1 if fields["khantokTicketAlreadyClaimed"] else 0

        if not old_has_ticket and new_has_ticket:
            # Adding ticket: insert claim record so quota is consumed
            raw_val = fields.get("khantokTicketValue")
            new_value = int(raw_val) if isinstance(raw_val, (int, float)) and raw_val is not None else 100
            claimed_at = now_iso()
            connection.execute(
                "INSERT OR REPLACE INTO khantok_ticket_claims (order_id, claimed_at, ticket_value) VALUES (?, ?, ?)",
                (order_id, claimed_at, new_value),
            )
            allowed["khantok_ticket_value"] = new_value
            allowed["khantok_ticket_claimed_at"] = claimed_at

        elif old_has_ticket and not new_has_ticket:
            # Removing ticket: delete claim record so quota is returned
            connection.execute("DELETE FROM khantok_ticket_claims WHERE order_id = ?", (order_id,))
            allowed["khantok_ticket_value"] = None
            allowed["khantok_ticket_claimed_at"] = None

        elif old_has_ticket and new_has_ticket and value_changed:
            # Ticket stays but value changed: update the claim record's ticket_value
            raw_val = fields["khantokTicketValue"]
            new_value = int(raw_val) if isinstance(raw_val, (int, float)) and raw_val is not None else None
            if new_value is not None:
                connection.execute(
                    "UPDATE khantok_ticket_claims SET ticket_value = ? WHERE order_id = ?",
                    (new_value, order_id),
                )
            allowed["khantok_ticket_value"] = new_value

    if "items" in fields and isinstance(fields["items"], list) and fields["items"]:
        raw_items = fields["items"]
        new_items: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            school = item.get("school")
            new_items.append({
                "id": str(item.get("id") or "item"),
                "product": item.get("product", {}),
                "size": str(item.get("size") or "").strip(),
                "school": school if isinstance(school, str) and school.strip() else None,
                "quantity": max(1, int(item.get("quantity") or 1)),
                "unitPrice": int(item.get("unitPrice") or 0),
                "totalAmount": int(item.get("totalAmount") or 0),
            })
        if new_items:
            allowed["items_json"] = json.dumps(new_items, ensure_ascii=False)
            total = sum(it["totalAmount"] for it in new_items)
            allowed["total_amount"] = total
            first = new_items[0]
            allowed["size"] = first["size"]
            allowed["quantity"] = first["quantity"]

    if not allowed:
        return serialize_order(existing)

    allowed["updated_at"] = now_iso()
    set_clause = ", ".join(f"{col} = ?" for col in allowed)
    values = list(allowed.values()) + [order_code]
    connection.execute(f"UPDATE orders SET {set_clause} WHERE order_code = ?", values)

    changed = ", ".join(f"{k}={v!r}" for k, v in fields.items())
    log_audit(connection, order_code, "order_fields_updated", changed)
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def reserve_khantok_ticket(
    connection: sqlite3.Connection, order_id: int, student_code: str
) -> tuple[bool, str | None, bool, int | None]:
    existing_claim = connection.execute(
        "SELECT claimed_at, ticket_value FROM khantok_ticket_claims WHERE order_id = ?",
        (order_id,),
    ).fetchone()
    if existing_claim is not None:
        return True, str(existing_claim["claimed_at"]), False, int(existing_claim["ticket_value"])

    code = (student_code or "").strip()
    if not code.startswith(KHANTOK_STUDENT_CODE_PREFIX):
        return False, None, False, None

    duplicate = connection.execute(
        "SELECT 1 FROM orders WHERE student_code = ? AND khantok_ticket = 1 AND internal_id != ?",
        (code, order_id),
    ).fetchone()
    if duplicate is not None:
        return False, None, True, None

    count_100 = int(connection.execute(
        "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 100"
    ).fetchone()["c"])
    if count_100 < KHANTOK_QUOTA_100:
        ticket_value = 100
    else:
        count_50 = int(connection.execute(
            "SELECT COUNT(*) AS c FROM khantok_ticket_claims WHERE ticket_value = 50"
        ).fetchone()["c"])
        if count_50 < KHANTOK_QUOTA_50:
            ticket_value = 50
        else:
            return False, None, False, None

    claimed_at = now_iso()
    connection.execute(
        "INSERT INTO khantok_ticket_claims (order_id, claimed_at, ticket_value) VALUES (?, ?, ?)",
        (order_id, claimed_at, ticket_value),
    )
    return True, claimed_at, False, ticket_value


def create_order(connection: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    now = now_iso()
    access_token = create_order_access_token()
    cursor = connection.execute(
        """
        INSERT INTO orders (
            round_number, status, payment_status, created_at, updated_at,
            product_slug, product_name, product_short_name, product_tagline, product_price, product_image, product_category,
            size, quantity, total_amount, items_json, access_token,
            student_code, full_name, parent_phone,
            first_name, last_name, nickname, email, phone, school
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            get_current_phase(connection),
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
            json.dumps(payload["items"], ensure_ascii=False),
            access_token,
            payload["customer"]["studentCode"],
            payload["customer"]["fullName"],
            payload["customer"]["parentPhone"],
            payload["customer"]["fullName"],
            "",
            "",
            payload["customer"]["email"],
            payload["customer"]["phone"],
            payload["customer"]["school"],
        ),
    )
    sequence_number = int(cursor.lastrowid)
    order_code = create_order_code(sequence_number, connection)
    connection.execute(
        "UPDATE orders SET order_code = ? WHERE internal_id = ?",
        (order_code, sequence_number),
    )
    items_for_check = payload.get("items") or []
    is_headband_only = bool(items_for_check) and all(
        (i.get("product") or {}).get("slug") == "fresh-headband" for i in items_for_check
    )
    if is_headband_only:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed, khantok_ticket_value = False, None, False, None
    else:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed, khantok_ticket_value = reserve_khantok_ticket(
            connection, sequence_number, payload["customer"]["studentCode"]
        )
    connection.execute(
        "UPDATE orders SET khantok_ticket = ?, khantok_ticket_claimed_at = ?, khantok_ticket_already_claimed = ?, khantok_ticket_value = ? WHERE internal_id = ?",
        (1 if khantok_ticket else 0, khantok_ticket_claimed_at, 1 if khantok_ticket_already_claimed else 0, khantok_ticket_value, sequence_number),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row, include_access_token=True)


def update_order(connection: sqlite3.Connection, order_code: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    existing_order = fetch_order_by_code(connection, order_code)
    if existing_order is None:
        return None

    delete_local_slip_file(existing_order["slip_stored_name"], existing_order["slip_storage_path"])
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
            items_json = ?,
            student_code = ?,
            full_name = ?,
            parent_phone = ?,
            first_name = ?,
            last_name = ?,
            nickname = ?,
            email = ?,
            phone = ?,
            school = ?,
            slip_original_name = NULL,
            slip_stored_name = NULL,
            slip_storage_path = NULL,
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
            json.dumps(payload["items"], ensure_ascii=False),
            payload["customer"]["studentCode"],
            payload["customer"]["fullName"],
            payload["customer"]["parentPhone"],
            payload["customer"]["fullName"],
            "",
            "",
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
            slip_storage_path = ?,
            slip_mime_type = ?,
            slip_size = ?,
            slip_uploaded_at = ?
        WHERE order_code = ?
        """,
        (
            "waiting_confirm",
            "waiting_confirm",
            now,
            slip["originalName"],
            slip["storedName"],
            slip["storedPath"],
            slip["mimeType"],
            int(slip["size"]),
            slip["uploadedAt"],
            order_code,
        ),
    )
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


# ── Slip OCR ──────────────────────────────────────────────────────────────────

def _run_ocr_for_slip(order_code: str, slip_path: str, expected_amount: float | None) -> None:
    try:
        with open_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO slip_ocr_results (order_code, status, checked_at) VALUES (?, 'pending', ?)",
                (order_code, now_iso()),
            )
            conn.commit()

        if slip_path.lower().endswith(".pdf"):
            with open_db() as conn:
                conn.execute(
                    "UPDATE slip_ocr_results SET status='skipped', raw_reason='PDF ไม่รองรับ OCR', checked_at=? WHERE order_code=?",
                    (now_iso(), order_code),
                )
                conn.commit()
            return

        import ocr as _ocr
        data = _ocr.extract_slip_data(slip_path)

        status = "rejected"
        raw_reason: str | None = None
        duplicate_of: str | None = None
        ref = data.get("ref_number")
        amount = data.get("amount")

        if not data.get("is_slip"):
            raw_reason = "ไม่พบข้อมูลสลิปในรูปภาพ"
        elif not ref:
            raw_reason = "ไม่พบเลขที่รายการในสลิป"
        else:
            with open_db() as conn:
                dup_row = conn.execute(
                    "SELECT order_code FROM slip_ocr_results WHERE ref_number = ? AND order_code != ? AND status NOT IN ('rejected','error','skipped','pending')",
                    (ref, order_code),
                ).fetchone()
            if dup_row:
                status = "duplicate"
                duplicate_of = dup_row["order_code"]
                raw_reason = f"ref ซ้ำกับออเดอร์ {duplicate_of}"
            elif expected_amount is not None and amount is not None and abs(amount - expected_amount) > 0.5:
                status = "amount_mismatch"
                raw_reason = f"จำนวนเงินไม่ตรง (สลิป: {amount:.2f}, ออเดอร์: {expected_amount:.2f})"
            else:
                status = "approved"

        with open_db() as conn:
            conn.execute(
                """UPDATE slip_ocr_results
                   SET status=?, ref_number=?, amount=?, date=?, sender=?, bank=?,
                       duplicate_of=?, raw_reason=?, checked_at=?
                   WHERE order_code=?""",
                (status, ref, amount, data.get("date"), data.get("sender"), data.get("bank"),
                 duplicate_of, raw_reason, now_iso(), order_code),
            )
            log_audit(conn, order_code, "slip_ocr_checked",
                      f"status={status}" + (f" ref={ref}" if ref else ""))
            conn.commit()
    except Exception as exc:
        try:
            with open_db() as conn:
                conn.execute(
                    "UPDATE slip_ocr_results SET status='error', raw_reason=?, checked_at=? WHERE order_code=?",
                    (str(exc)[:300], now_iso(), order_code),
                )
                conn.commit()
        except Exception:
            pass


def trigger_ocr_async(order_code: str, slip_path: str | None, expected_amount: float | None = None) -> None:
    if not slip_path:
        return
    threading.Thread(
        target=_run_ocr_for_slip,
        args=(order_code, slip_path, expected_amount),
        daemon=True,
    ).start()


# ── Product management ────────────────────────────────────────────────────────

def serialize_product(row: sqlite3.Row) -> dict[str, Any]:
    image = row["image_path"] or "/images/POLP_post/Artboard 4.png"
    return {
        "slug": row["slug"],
        "name": row["name"],
        "shortName": row["short_name"],
        "tagline": row["tagline"],
        "description": row["description"],
        "price": row["price"],
        "category": row["category"],
        "requiresSize": bool(row["requires_size"]),
        "requiresSchool": bool(row["requires_school"]),
        "available": bool(row["available"]),
        "image": image,
        "images": [image, image],
        "sortOrder": row["sort_order"],
    }


def get_all_products(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM products ORDER BY sort_order ASC, id ASC"
    ).fetchall()
    return [serialize_product(row) for row in rows]


def get_product(connection: sqlite3.Connection, slug: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM products WHERE slug = ?", (slug,)).fetchone()
    return serialize_product(row) if row else None


def update_product(connection: sqlite3.Connection, slug: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = connection.execute("SELECT * FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        """
        UPDATE products
        SET name = ?, short_name = ?, tagline = ?, description = ?, price = ?, updated_at = ?
        WHERE slug = ?
        """,
        (
            str(payload.get("name", row["name"])).strip(),
            str(payload.get("shortName", row["short_name"])).strip(),
            str(payload.get("tagline", row["tagline"])).strip(),
            str(payload.get("description", row["description"])).strip(),
            max(0, int(payload.get("price", row["price"]))),
            now_iso(),
            slug,
        ),
    )
    return get_product(connection, slug)


def toggle_product_available(connection: sqlite3.Connection, slug: str, available: bool) -> dict[str, Any] | None:
    row = connection.execute("SELECT id FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        "UPDATE products SET available = ?, updated_at = ? WHERE slug = ?",
        (1 if available else 0, now_iso(), slug),
    )
    return get_product(connection, slug)


def update_product_image(connection: sqlite3.Connection, slug: str, image_path: str) -> dict[str, Any] | None:
    row = connection.execute("SELECT id FROM products WHERE slug = ?", (slug,)).fetchone()
    if row is None:
        return None
    connection.execute(
        "UPDATE products SET image_path = ?, updated_at = ? WHERE slug = ?",
        (image_path, now_iso(), slug),
    )
    return get_product(connection, slug)


def save_product_image_file(slug: str, original_name: str, mime_type: str, content: bytes) -> tuple[str | None, str | None]:
    if mime_type not in ALLOWED_IMAGE_TYPES:
        return None, "unsupported image type (use JPEG, PNG, or WebP)"
    if len(content) < 1 or len(content) > MAX_PRODUCT_IMAGE_SIZE_BYTES:
        return None, "image must be between 1 byte and 10 MB"
    PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(original_name).suffix.lower()
    if not suffix:
        suffix = ".jpg" if "jpeg" in mime_type else ".png"
    filename = f"{slug}-{int(datetime.now(timezone.utc).timestamp())}{suffix}"
    (PRODUCT_IMAGES_DIR / filename).write_bytes(content)
    return filename, None


# ── Site settings ─────────────────────────────────────────────────────────────

def get_site_settings(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = connection.execute("SELECT key, value FROM site_settings").fetchall()
    settings: dict[str, str] = {row["key"]: row["value"] for row in rows}
    phase_override_raw = settings.get("phase_override", "")
    phase_override = int(phase_override_raw) if phase_override_raw not in ("", None) else None
    phase_configs_raw = settings.get("phase_configs", "")
    try:
        phase_configs: dict = json.loads(phase_configs_raw) if phase_configs_raw else {}
    except (json.JSONDecodeError, TypeError):
        phase_configs = {}
    if not phase_configs:
        phase_configs = {
            "1": {"start": "2026-05-18", "end": "2026-05-23"},
            "2": {"start": "2026-05-25", "end": "2026-05-30"},
            "3": {"start": "2026-06-01", "end": "2026-06-07"},
        }
    max_phases = max((int(k) for k in phase_configs.keys()), default=3)
    return {
        "announcementBanner": settings.get("announcement_banner", ""),
        "announcementBannerEnabled": settings.get("announcement_banner_enabled", "0") == "1",
        "storeOpen": settings.get("store_open", "1") == "1",
        "siteClosed": settings.get("site_closed", "0") == "1",
        "scheduleEnabled": settings.get("schedule_enabled", "0") == "1",
        "scheduleWarningMessage": settings.get("schedule_warning_message", "เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59"),
        "orderDeadline": settings.get("order_deadline", ""),
        "phaseOverride": phase_override,
        "currentPhase": get_current_phase(connection),
        "phaseConfigs": phase_configs,
        "maxPhases": max_phases,
        "khantokQuota100": int(settings.get("khantok_quota_100") or KHANTOK_QUOTA_100),
        "khantokQuota50": int(settings.get("khantok_quota_50") or KHANTOK_QUOTA_50),
        "beRightBackDates": settings.get("be_right_back_dates", "2026-05-24,2026-05-31,2026-06-07"),
        "beRightBackActive": settings.get("be_right_back_active", "0") == "1",
        "bypassToken": BYPASS_TOKEN,
    }


def upsert_site_setting(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, now_iso()),
    )


# ── CSV export ────────────────────────────────────────────────────────────────

def export_orders_csv(orders: list[dict[str, Any]], ocr_map: dict[str, dict] | None = None) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "order_id", "status", "payment_status", "order_total_amount",
        "item_product_name", "item_category", "item_size", "item_quantity", "item_unit_price", "item_total_amount",
        "created_at", "full_name", "student_code", "phone", "email", "school", "parent_phone",
        "khantok_ticket", "ocr_status", "ocr_ref",
    ])
    for order in orders:
        c = order.get("customer") or {}
        ocr = (ocr_map or {}).get(order.get("id", ""), {})
        common = [
            order.get("id", ""),
            order.get("status", ""),
            order.get("paymentStatus", ""),
            order.get("totalAmount", ""),
        ]
        common_tail = [
            order.get("createdAt", ""),
            c.get("fullName", ""),
            c.get("studentCode", ""),
            c.get("phone", ""),
            c.get("email", ""),
            c.get("school", ""),
            c.get("parentPhone", ""),
            "yes" if order.get("khantokTicket") else "no",
            ocr.get("status", ""),
            ocr.get("ref_number", ""),
        ]
        items = order.get("items") or []
        if not items:
            p = order.get("product") or {}
            writer.writerow(common + [
                p.get("name", ""), p.get("category", ""),
                order.get("size", ""), order.get("quantity", ""),
                "", order.get("totalAmount", ""),
            ] + common_tail)
        else:
            for item in items:
                ip = item.get("product") or {}
                writer.writerow(common + [
                    ip.get("name", ""), ip.get("category", ""),
                    item.get("size", ""), item.get("quantity", ""),
                    item.get("unitPrice", ""), item.get("totalAmount", ""),
                ] + common_tail)
    return output.getvalue()


# ── Backup ────────────────────────────────────────────────────────────────────

def create_backup(connection: sqlite3.Connection) -> dict[str, Any]:
    orders, _ = list_orders(connection, page=1, per_page=999999)
    now = now_iso()
    orders_json = json.dumps(orders, ensure_ascii=False)
    cursor = connection.execute(
        "INSERT INTO order_backups (created_at, order_count, orders_json) VALUES (?, ?, ?)",
        (now, len(orders), orders_json),
    )
    connection.commit()
    return {"id": cursor.lastrowid, "createdAt": now, "label": "", "orderCount": len(orders)}


def list_backups(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT id, created_at, label, order_count FROM order_backups ORDER BY id DESC"
    ).fetchall()
    return [
        {"id": r["id"], "createdAt": r["created_at"], "label": r["label"], "orderCount": r["order_count"]}
        for r in rows
    ]


def get_backup(connection: sqlite3.Connection, backup_id: int) -> dict[str, Any] | None:
    row = connection.execute(
        "SELECT id, created_at, label, order_count, orders_json FROM order_backups WHERE id = ?",
        (backup_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "label": row["label"],
        "orderCount": row["order_count"],
        "orders": json.loads(row["orders_json"]),
    }


def delete_backup(connection: sqlite3.Connection, backup_id: int) -> bool:
    result = connection.execute("DELETE FROM order_backups WHERE id = ?", (backup_id,))
    connection.commit()
    return result.rowcount > 0


def get_product_breakdown(connection: sqlite3.Connection, category: str, round_filter: int = 0) -> dict[str, Any]:
    SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"]
    COLOR_ORDER = ["Blue", "Red", "White"]
    COLOR_THAI = {"Blue": "สีน้ำเงิน", "Red": "สีแดง", "White": "สีขาว"}
    rw = "WHERE status NOT IN ('rejected', 'cancelled')" + (" AND round_number = ?" if round_filter > 0 else "")
    rp: list[Any] = [round_filter] if round_filter > 0 else []

    if category == "jacket":
        # color → size → count
        color_size: dict[str, dict[str, int]] = {}
        for row in connection.execute(f"SELECT items_json, product_category, size, quantity FROM orders {rw}", rp).fetchall():
            items_processed = False
            if row["items_json"]:
                try:
                    parsed = json.loads(row["items_json"])
                    if isinstance(parsed, list):
                        for item in parsed:
                            if (item.get("product") or {}).get("category") != "jacket":
                                continue
                            qty = int(item.get("quantity") or 0)
                            raw_size = (item.get("size") or "").strip()
                            parts = raw_size.split(" / ")
                            sz = parts[0].strip() or "ONE SIZE"
                            color = parts[1].strip() if len(parts) > 1 else "(ไม่ระบุสี)"
                            color_size.setdefault(color, {})
                            color_size[color][sz] = color_size[color].get(sz, 0) + qty
                        items_processed = True
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass
            if not items_processed and (row["product_category"] or "") == "jacket":
                qty = int(row["quantity"] or 0)
                raw_size = (row["size"] or "").strip()
                parts = raw_size.split(" / ")
                sz = parts[0].strip() or "ONE SIZE"
                color = parts[1].strip() if len(parts) > 1 else "(ไม่ระบุสี)"
                color_size.setdefault(color, {})
                color_size[color][sz] = color_size[color].get(sz, 0) + qty

        groups = []
        for color in COLOR_ORDER + [c for c in color_size if c not in COLOR_ORDER]:
            if color not in color_size:
                continue
            sz_map = color_size[color]
            sorted_sizes = sorted(sz_map.keys(), key=lambda k: SIZE_ORDER.index(k) if k in SIZE_ORDER else 99)
            rows = [{"label": sz, "count": sz_map[sz]} for sz in sorted_sizes]
            groups.append({
                "color": color,
                "colorThai": COLOR_THAI.get(color, color),
                "total": sum(sz_map.values()),
                "rows": rows,
            })
        return {"category": category, "groups": groups}

    # single / headband — flat rows
    counts: dict[str, int] = {}
    for row in connection.execute(f"SELECT items_json, product_category, size, quantity FROM orders {rw}", rp).fetchall():  # noqa: E501
        items_processed = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list):
                    for item in parsed:
                        if (item.get("product") or {}).get("category") != category:
                            continue
                        qty = int(item.get("quantity") or 0)
                        if category == "headband":
                            key = (item.get("school") or "").strip() or "(ไม่ระบุสำนัก)"
                        else:
                            key = (item.get("size") or "").strip() or "ONE SIZE"
                        counts[key] = counts.get(key, 0) + qty
                    items_processed = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if not items_processed and (row["product_category"] or "") == category:
            qty = int(row["quantity"] or 0)
            key = "(ไม่ระบุสำนัก)" if category == "headband" else (row["size"] or "").strip() or "ONE SIZE"
            counts[key] = counts.get(key, 0) + qty

    if category == "single":
        sorted_keys = sorted(counts.keys(), key=lambda k: SIZE_ORDER.index(k) if k in SIZE_ORDER else 99)
    else:
        sorted_keys = sorted(counts.keys(), key=lambda k: -counts[k])

    return {"category": category, "rows": [{"label": k, "count": counts[k]} for k in sorted_keys]}


PRODUCT_COST: dict[str, int] = {"single": 158, "jacket": 685, "headband": 20}

def get_analytics(connection: sqlite3.Connection) -> dict[str, Any]:
    total_row = connection.execute("SELECT COUNT(*) AS cnt FROM orders").fetchone()
    total = int(total_row["cnt"] if total_row else 0)
    revenue_row = connection.execute(
        "SELECT COALESCE(SUM(total_amount), 0) AS rev FROM orders WHERE status IN ('paid','preparing','shipped','received')"
    ).fetchone()
    revenue = int(revenue_row["rev"] if revenue_row else 0)
    school_count_row = connection.execute("SELECT COUNT(DISTINCT school) AS cnt FROM orders").fetchone()
    school_count = int(school_count_row["cnt"] if school_count_row else 0)
    by_school = connection.execute(
        "SELECT school, COUNT(*) AS cnt FROM orders GROUP BY school ORDER BY cnt DESC"
    ).fetchall()
    by_product = connection.execute(
        "SELECT product_name, COUNT(*) AS cnt FROM orders GROUP BY product_name ORDER BY cnt DESC"
    ).fetchall()
    by_status = connection.execute(
        "SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status ORDER BY cnt DESC"
    ).fetchall()
    by_size = connection.execute(
        "SELECT size, COUNT(*) AS cnt FROM orders WHERE size != '' GROUP BY size ORDER BY cnt DESC LIMIT 20"
    ).fetchall()
    by_day = connection.execute(
        "SELECT DATE(created_at, '+7 hours') AS day, COUNT(*) AS cnt FROM orders WHERE DATE(created_at, '+7 hours') != '2026-05-17' GROUP BY day ORDER BY day"
    ).fetchall()
    # คำนวณต้นทุนจากออเดอร์ที่ confirmed เท่านั้น
    confirmed_rows = connection.execute(
        "SELECT items_json, product_category, quantity FROM orders WHERE status IN ('paid','preparing','shipped','received')"
    ).fetchall()
    cost_qty: dict[str, int] = {}
    for row in confirmed_rows:
        counted = False
        if row["items_json"]:
            try:
                parsed = json.loads(row["items_json"])
                if isinstance(parsed, list) and parsed:
                    for item in parsed:
                        cat = (item.get("product") or {}).get("category") or ""
                        qty = int(item.get("quantity") or 0)
                        if cat:
                            cost_qty[cat] = cost_qty.get(cat, 0) + qty
                    counted = True
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
        if not counted:
            cat = row["product_category"] or ""
            if cat:
                cost_qty[cat] = cost_qty.get(cat, 0) + int(row["quantity"] or 0)
    total_cost = sum(cost_qty.get(cat, 0) * price for cat, price in PRODUCT_COST.items())
    profit = revenue - total_cost
    return {
        "total": total,
        "revenue": revenue,
        "schoolCount": school_count,
        "profit": profit,
        "bySchool": [[row["school"], row["cnt"]] for row in by_school],
        "byProduct": [[row["product_name"], row["cnt"]] for row in by_product],
        "byStatus": [[row["status"], row["cnt"]] for row in by_status],
        "bySize": [[row["size"], row["cnt"]] for row in by_size],
        "byDay": [[row["day"], row["cnt"]] for row in by_day],
    }


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
            ).encode("utf-8")
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
        expected = f"Bearer {ORDER_API_TOKEN}"
        return bool(ORDER_API_TOKEN) and hmac.compare_digest(incoming, expected)

    def _has_claim_station_authorization(self) -> bool:
        incoming = self.headers.get("Authorization", "")
        if not incoming.startswith("Claim "):
            return False
        token = incoming[6:]
        with open_db() as conn:
            row = conn.execute("SELECT 1 FROM admin_users WHERE claim_token=?", (token,)).fetchone()
        return row is not None

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
        return self.headers.get("X-Order-Token") == row["access_token"]

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
        if path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
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

        if path == "/orders":
            self._send_html(HTTPStatus.OK, ORDER_VIEW_HTML)
            return

        if path == "/claim-station":
            self._send_html(HTTPStatus.OK, CLAIM_STATION_HTML)
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
                        "SELECT * FROM orders WHERE student_code=? AND status='shipped' ORDER BY created_at DESC",
                        (student_code,),
                    ).fetchall()
                    not_found_msg = "ไม่พบออเดอร์พร้อมรับสำหรับรหัสนักศึกษานี้"
                elif phone:
                    rows = connection.execute(
                        "SELECT * FROM orders WHERE phone=? AND status='shipped' ORDER BY created_at DESC",
                        (phone,),
                    ).fetchall()
                    not_found_msg = "ไม่พบออเดอร์พร้อมรับสำหรับเบอร์โทรนี้"
                else:
                    pat = f"%{full_name}%"
                    rows = connection.execute(
                        "SELECT * FROM orders WHERE (full_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?) AND status='shipped' ORDER BY created_at DESC",
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
            slip_path = resolve_stored_slip_path(row["slip_stored_name"], row["slip_storage_path"] if "slip_storage_path" in row.keys() else None)
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
            if qr_token and ORDER_API_TOKEN:
                expected = compute_qr_token(order_code)
                if qr_token != expected:
                    self._send_json(HTTPStatus.FORBIDDEN, {"message": "QR code ไม่ถูกต้อง — สแกนใหม่อีกครั้ง"})
                    return
            with open_db() as connection:
                row = fetch_order_by_code(connection, order_code)
            if row is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                return
            self._send_json(HTTPStatus.OK, {"order": serialize_order(row)})
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
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            last_hash = None
            tick = 0
            try:
                while True:
                    cutoff = time.time() - _VISITOR_ACTIVE_SECONDS
                    with _global_lock:
                        visitors = sum(1 for t in list(_visitor_registry.values()) if t >= cutoff)
                    with open_db() as conn:
                        summary = create_orders_summary(conn)
                        rev_row = conn.execute(
                            "SELECT COALESCE(SUM(total_amount),0) AS r FROM orders WHERE status IN ('paid','preparing','shipped','received')"
                        ).fetchone()
                        revenue = int(rev_row["r"] if rev_row else 0)
                        school_cnt = conn.execute(
                            "SELECT COUNT(DISTINCT school) AS c FROM orders"
                        ).fetchone()["c"]
                        cost_rows = conn.execute(
                            "SELECT items_json, product_category, quantity FROM orders WHERE status IN ('paid','preparing','shipped','received')"
                        ).fetchall()
                    cq: dict[str, int] = {}
                    for row in cost_rows:
                        ok = False
                        if row["items_json"]:
                            try:
                                for itm in json.loads(row["items_json"]):
                                    cat = (itm.get("product") or {}).get("category") or ""
                                    if cat:
                                        cq[cat] = cq.get(cat, 0) + int(itm.get("quantity") or 0)
                                ok = True
                            except Exception:
                                pass
                        if not ok:
                            cat = row["product_category"] or ""
                            if cat:
                                cq[cat] = cq.get(cat, 0) + int(row["quantity"] or 0)
                    profit = revenue - sum(cq.get(c, 0) * p for c, p in PRODUCT_COST.items())
                    payload = {
                        "visitors": visitors,
                        "summary": summary,
                        "analytics": {"total": summary["total"], "revenue": revenue, "schoolCount": school_cnt, "profit": profit},
                    }
                    h = hash(json.dumps(payload, sort_keys=True))
                    if h != last_hash:
                        self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
                        self.wfile.flush()
                        last_hash = h
                    time.sleep(1 if tick < 10 else 5)
                    tick += 1
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
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
                summary = create_orders_summary(connection, round_filter=round_f)
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
            from datetime import date
            filename = f"orders-{date.today().isoformat()}.csv"
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
            limit = min(max(1, int((qs.get("limit") or ["200"])[0])), 1000)
            with open_db() as connection:
                if order_code:
                    rows = connection.execute(
                        "SELECT * FROM order_audit_log WHERE order_code = ? ORDER BY created_at DESC LIMIT ?",
                        (order_code, limit),
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
            image_path = PRODUCT_IMAGES_DIR / safe_filename
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
            self._send_json(HTTPStatus.OK, serialize_order(row))

    def do_POST(self) -> None:
        global _test_warning_until
        path = urlparse(self.path).path

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
            trigger_ocr_async(order_code, materialized_slip.get("storedPath"), serialized.get("totalAmount"))
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
                (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode("utf-8") + raw_body
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
                cursor = connection.execute(
                    "UPDATE orders SET status='received', payment_status='paid', received_at=?, received_by=?, updated_at=?"
                    " WHERE order_code=? AND status='shipped'",
                    (ts, received_by or "staff", ts, order_code),
                )
                if cursor.rowcount == 0:
                    row = fetch_order_by_code(connection, order_code)
                    if row is None:
                        self._send_json(HTTPStatus.NOT_FOUND, {"message": "ไม่พบออเดอร์"})
                    else:
                        st = row["status"]
                        if st == "received":
                            self._send_json(HTTPStatus.CONFLICT, {"message": "ออเดอร์นี้ถูกรับสินค้าไปแล้ว", "alreadyReceived": True})
                        else:
                            self._send_json(HTTPStatus.BAD_REQUEST, {"message": f"ออเดอร์มีสถานะ '{st}' ยังไม่พร้อมรับ"})
                    return
                log_audit(connection, order_code, "claim_received", f"received by {received_by or 'staff'}")
                connection.commit()
                updated = fetch_order_by_code(connection, order_code)
            self._send_json(HTTPStatus.OK, {"order": serialize_order(updated)})
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
            with open_db() as connection:
                order = update_order_fields(connection, order_edit_match.group(1), payload)
                if order is None:
                    self._send_json(HTTPStatus.NOT_FOUND, {"message": "order not found"})
                    return
                connection.commit()
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
            for oid in updated:
                pass  # could sync sheets here if needed
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
            trigger_ocr_async(order_match.group(1), materialized_slip.get("storedPath") if materialized_slip else None, order.get("totalAmount"))
            sync_order_to_google_sheets(order, "payment_slip_uploaded")
            self._send_json(HTTPStatus.OK, order)

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path

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


if __name__ == "__main__":
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), OrderRequestHandler)
    print(f"Order API listening on http://{HOST}:{PORT}")
    server.serve_forever()
