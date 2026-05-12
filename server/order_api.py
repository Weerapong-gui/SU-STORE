#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import csv
import html
import io
import json
import os
import re
import secrets
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
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
GOOGLE_SHEETS_WEBHOOK_URL = os.environ.get("GOOGLE_SHEETS_WEBHOOK_URL", "").strip()
GOOGLE_SHEETS_WEBHOOK_TOKEN = os.environ.get("GOOGLE_SHEETS_WEBHOOK_TOKEN", "").strip()
KHANTOK_TICKET_QUOTA = int(
    os.environ.get("KHANTOK_TICKET_QUOTA", os.environ.get("LUCKY_TICKET_QUOTA", "2000"))
)
ORDER_ID_PATTERN = re.compile(r"^[A-Z0-9-]+$")
ALLOWED_SLIP_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024
ORDER_STATUSES = {
    "pending_payment",
    "waiting_confirm",
    "paid",
    "preparing",
    "shipped",
    "cancelled",
    "rejected",
}
PAYMENT_STATUS_BY_ORDER_STATUS = {
    "pending_payment": "awaiting_payment",
    "waiting_confirm": "waiting_confirm",
    "paid": "paid",
    "preparing": "paid",
    "shipped": "paid",
    "cancelled": "rejected",
    "rejected": "rejected",
}

DEFAULT_PRODUCTS = [
    {
        "slug": "single-shirt",
        "name": "FRESHER POLO SHIRT",
        "short_name": "เสื้อเดี่ยว",
        "tagline": "Classic fresher polo for everyday campus wear.",
        "description": "เสื้อเดี่ยวทรงเรียบ ใส่ง่าย และเป็นฐานหลักของคอลเลกชัน Fresher 28th.",
        "price": 399,
        "category": "single",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/polo.png",
        "sort_order": 1,
    },
    {
        "slug": "set-shirt",
        "name": "FRESHER BUNDLE",
        "short_name": "ชุดเซต",
        "tagline": "A fuller set for students who want the complete look.",
        "description": "ชุดเซตสำหรับคนที่อยากได้ลุคครบในคำสั่งซื้อเดียว พร้อมเลือกไซซ์และสำนักวิชาได้เหมือนกลุ่มเสื้อ.",
        "price": 799,
        "category": "bundle",
        "requires_size": 1,
        "requires_school": 1,
        "image_path": "/images/FRESHER BUNDLE.png",
        "sort_order": 2,
    },
    {
        "slug": "fresh-jacket",
        "name": "FRESHER JACKET",
        "short_name": "แจ็กเก็ต",
        "tagline": "Layer up with a clean campus-ready jacket.",
        "description": "แจ็กเก็ตสำหรับวันกิจกรรมหรือวันที่อยากได้เลเยอร์เพิ่ม โดยใช้ flow เลือกไซซ์ จำนวน และสำนักวิชาเหมือนสินค้ากลุ่มเสื้อ.",
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
        "short_name": "เฮดแบนด์",
        "tagline": "A lightweight accessory for sports day and activity looks.",
        "description": "เฮดแบนด์ที่ใช้ขนาดแบบ one size โดยเลือกจำนวนและสำนักวิชาได้ก่อนเพิ่มลง cart หรือไปชำระเงินต่อ.",
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
      color-scheme: light;
      --bg: #f4f4f5; --panel: #fff; --line: #d8d8dd; --text: #111114;
      --muted: #666a73; --accent: #0071e3; --danger: #b42318; --ok: #027a48; --warn: #b45309;
    }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header {
      position: sticky; top: 0; z-index: 10;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 14px clamp(16px,4vw,44px); border-bottom: 1px solid var(--line);
      background: rgba(255,255,255,.9); backdrop-filter: blur(18px);
    }
    header h1 { font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
    .hdr-right { display: flex; gap: 8px; align-items: center; }
    nav.tab-bar {
      display: flex; overflow-x: auto;
      border-bottom: 1px solid var(--line); background: #fff;
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
    main { width: min(1280px, calc(100% - 32px)); margin: 24px auto 56px; }
    input, select, textarea, button {
      border: 1px solid var(--line); border-radius: 8px;
      background: #fff; color: var(--text); font: inherit; min-height: 40px;
    }
    input, select { padding: 0 12px; width: 100%; }
    textarea { padding: 8px 12px; width: 100%; resize: vertical; }
    button { cursor: pointer; padding: 0 16px; font-weight: 600; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    button.danger-btn { border-color: var(--danger); background: var(--danger); color: #fff; }
    button.ok-btn { border-color: var(--ok); background: var(--ok); color: #fff; }
    button.ghost { background: #fff; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    .stats {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 1px; background: var(--line); border: 1px solid var(--line);
      border-radius: 8px; overflow: hidden; margin-bottom: 16px;
    }
    .stat { background: #fff; padding: 14px 16px; }
    .stat span { display: block; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 6px; font-size: 24px; letter-spacing: -.04em; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; align-items: center; }
    .toolbar input, .toolbar select { max-width: 220px; }
    .table-card { border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #f9f9fa; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--muted); font-size: 12px; }
    .money { color: var(--accent); font-weight: 700; }
    .badge { display: inline-flex; align-items: center; padding: 2px 9px; border-radius: 999px; background: #eef2ff; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .badge.waiting_confirm { background: #fff7ed; color: var(--warn); }
    .badge.paid, .badge.preparing, .badge.shipped { background: #ecfdf3; color: var(--ok); }
    .badge.rejected, .badge.cancelled { background: #fef3f2; color: var(--danger); }
    .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 16px; }
    .product-card { background: #fff; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; transition: box-shadow .2s; }
    .product-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    .product-card.unavailable { opacity: .5; filter: grayscale(.7); }
    .product-img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: #f0f0f0; display: block; }
    .product-body { padding: 14px; }
    .product-name { font-size: 15px; font-weight: 700; }
    .product-meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .product-price { font-size: 16px; font-weight: 700; color: var(--accent); margin-top: 6px; }
    .product-actions { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
    .toggle { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-track { position: absolute; inset: 0; background: #d0d0d5; border-radius: 999px; transition: background .2s; }
    .toggle input:checked + .toggle-track { background: var(--ok); }
    .toggle-thumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 4px rgba(0,0,0,.2); pointer-events: none; }
    .toggle input:checked ~ .toggle-thumb { transform: translateX(20px); }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100; overflow-y: auto; padding: 32px 16px; }
    .modal-backdrop.open { display: flex; align-items: flex-start; justify-content: center; }
    .modal { background: #fff; border-radius: 16px; width: min(520px,100%); padding: 28px; }
    .modal h2 { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 5px; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .notice { padding: 6px 0; color: var(--muted); font-size: 13px; min-height: 22px; }
    .notice.err { color: var(--danger); }
    .analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .analytics-card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
    .analytics-card h3 { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .bar-label { font-size: 13px; width: 150px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 8px; background: #eef2ff; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--accent); border-radius: 999px; }
    .bar-count { font-size: 12px; color: var(--muted); width: 32px; text-align: right; }
    .settings-card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .settings-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 14px; }
    @media (max-width: 720px) {
      .analytics-grid { grid-template-columns: 1fr; }
      .toolbar input, .toolbar select { max-width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <h1>SU STORE Admin</h1>
    <div class="hdr-right">
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="API Token" style="max-width:200px" />
      <button class="primary" id="saveTokenBtn">บันทึก</button>
      <button class="ghost" id="clearTokenBtn">Clear</button>
    </div>
  </header>

  <nav class="tab-bar">
    <button class="tab-btn active" data-tab="orders">Orders</button>
    <button class="tab-btn" data-tab="products">Products</button>
    <button class="tab-btn" data-tab="analytics">Analytics</button>
    <button class="tab-btn" data-tab="settings">Settings</button>
  </nav>

  <!-- ORDERS TAB -->
  <div class="tab-pane active" id="tab-orders">
    <main>
      <div class="stats" id="orderStats"></div>
      <div class="toolbar">
        <input id="searchInput" type="search" placeholder="Search order, name, school..." />
        <select id="statusFilter">
          <option value="">All status</option>
          <option value="pending_payment">pending_payment</option>
          <option value="waiting_confirm">waiting_confirm</option>
          <option value="paid">paid</option>
          <option value="preparing">preparing</option>
          <option value="shipped">shipped</option>
          <option value="cancelled">cancelled</option>
          <option value="rejected">rejected</option>
        </select>
        <button class="ghost" id="exportCsvBtn">Export CSV</button>
        <button class="primary" id="refreshOrdersBtn">Refresh</button>
      </div>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th style="width:11%">Order</th>
              <th style="width:17%">Customer</th>
              <th style="width:19%">Product</th>
              <th style="width:10%">Payment</th>
              <th style="width:13%">Status</th>
              <th style="width:30%">Actions</th>
            </tr>
          </thead>
          <tbody id="ordersBody"></tbody>
        </table>
      </div>
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
        <h3>Announcement Banner</h3>
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
      <div style="display:flex;gap:10px;align-items:center">
        <button class="primary" id="saveSettingsBtn">Save Settings</button>
        <span id="settingsNotice" style="color:var(--muted);font-size:13px"></span>
      </div>
    </main>
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

  <script>
    // ── Token ──────────────────────────────────────────────────────────────────
    const tokenInput = document.querySelector("#tokenInput");
    tokenInput.value = localStorage.getItem("suStoreAdminToken") || "";

    function authHeaders(extra) {
      return Object.assign({ "Authorization": "Bearer " + tokenInput.value.trim(), "Content-Type": "application/json" }, extra || {});
    }

    document.querySelector("#saveTokenBtn").addEventListener("click", () => {
      localStorage.setItem("suStoreAdminToken", tokenInput.value.trim());
      loadOrders();
      loadProducts();
    });
    document.querySelector("#clearTokenBtn").addEventListener("click", () => {
      localStorage.removeItem("suStoreAdminToken");
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
      });
    });

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
    var statuses = ["pending_payment","waiting_confirm","paid","preparing","shipped","cancelled","rejected"];
    var allOrders = [];
    var serverSummary = {};

    function setOrdersNotice(msg, err) {
      var el = document.querySelector("#ordersNotice");
      el.textContent = msg;
      el.className = "notice" + (err ? " err" : "");
    }

    function renderOrderStats(summary) {
      var items = [
        ["Total", summary.total || 0],
        ["Waiting Slip", summary.pendingPayment || 0],
        ["Waiting Confirm", summary.waitingConfirm || 0],
        ["Paid", summary.paid || 0],
        ["Rejected", summary.rejected || 0],
      ];
      document.querySelector("#orderStats").innerHTML = items.map(function(item) {
        return '<div class="stat"><span>' + esc(item[0]) + '</span><strong>' + esc(item[1]) + '</strong></div>';
      }).join("");
    }

    function filteredOrders() {
      var q = document.querySelector("#searchInput").value.trim().toLowerCase();
      var s = document.querySelector("#statusFilter").value;
      return allOrders.filter(function(o) {
        var c = o.customer || {};
        var p = o.product || {};
        var hay = [o.id, o.status, p.name, c.fullName, c.studentCode, c.phone, c.school, o.size].join(" ").toLowerCase();
        return (!s || o.status === s) && (!q || hay.includes(q));
      });
    }

    function renderOrders() {
      var orders = filteredOrders();
      document.querySelector("#ordersBody").innerHTML = orders.map(function(order) {
        var c = order.customer || {};
        var p = order.product || {};
        var opts = statuses.map(function(s) {
          return '<option value="' + s + '"' + (order.status === s ? " selected" : "") + '>' + s + '</option>';
        }).join("");
        return '<tr>' +
          '<td><strong>' + esc(order.id) + '</strong><br/><span class="muted">' + esc(order.createdAt||"") + '</span><br/><span class="badge ' + esc(order.status) + '">' + esc(order.status) + '</span></td>' +
          '<td><strong>' + esc(c.fullName||"-") + '</strong><br/><span class="muted">' + esc(c.studentCode||"-") + '</span><br/><span class="muted">' + esc(c.phone||"") + '</span></td>' +
          '<td><strong>' + esc(p.name||"-") + '</strong><br/><span class="muted">Size: ' + esc(order.size||"-") + ' / Qty: ' + esc(order.quantity||0) + '</span><br/><span class="money">' + esc(baht(order.totalAmount)) + '</span><br/><span class="muted">' + esc(c.school||"") + '</span></td>' +
          '<td><span class="muted">' + esc(order.paymentStatus||"-") + '</span><br/><span class="muted">' + (order.slip ? "Slip uploaded" : "No slip") + '</span></td>' +
          '<td><select data-oid="' + esc(order.id) + '" class="statusSel" style="min-width:0;font-size:12px;min-height:36px">' + opts + '</select></td>' +
          '<td><div style="display:grid;gap:5px">' +
            '<button class="primary updateBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:32px">Update Status</button>' +
            '<button class="ok-btn confirmBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:32px"' + (order.status==="waiting_confirm" ? "" : " disabled") + '>✓ Confirm Paid</button>' +
            '<button class="danger-btn rejectBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:32px"' + (["waiting_confirm","pending_payment"].includes(order.status) ? "" : " disabled") + '>✗ Reject</button>' +
            '<button class="ghost slipBtn" data-oid="' + esc(order.id) + '" style="font-size:12px;min-height:32px"' + (order.slip ? "" : " disabled") + '>View Slip</button>' +
          '</div></td>' +
        '</tr>';
      }).join("");
    }

    async function loadOrders() {
      setOrdersNotice("Loading...");
      try {
        var res = await fetch("/admin/orders", { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var data = await res.json();
        allOrders = data.orders || [];
        serverSummary = data.summary || {};
        renderOrderStats(serverSummary);
        renderOrders();
        setOrdersNotice("Loaded " + allOrders.length + " orders");
      } catch(e) { setOrdersNotice(e.message, true); }
    }

    async function patchStatus(orderId, status) {
      var res = await fetch("/admin/orders/" + encodeURIComponent(orderId) + "/status", {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status: status })
      });
      if (!res.ok) throw new Error(await res.text());
    }

    async function viewSlip(orderId) {
      var res = await fetch("/admin/orders/" + encodeURIComponent(orderId) + "/slip", {
        headers: { "Authorization": "Bearer " + tokenInput.value.trim() }
      });
      if (!res.ok) throw new Error(await res.text());
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    }

    function exportCsv() {
      var orders = filteredOrders();
      var cols = ["id","status","paymentStatus","totalAmount","size","quantity","createdAt","fullName","studentCode","phone","email","school","productName","productCategory"];
      var rows = orders.map(function(o) {
        var c = o.customer || {};
        var p = o.product || {};
        return [o.id, o.status, o.paymentStatus, o.totalAmount, o.size, o.quantity, o.createdAt,
          c.fullName, c.studentCode, c.phone, c.email, c.school, p.name, p.category
        ].map(function(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(",");
      });
      var csv = [cols.join(",")].concat(rows).join("\n");
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "orders-" + new Date().toISOString().slice(0,10) + ".csv"; a.click();
      setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
    }

    document.querySelector("#refreshOrdersBtn").addEventListener("click", function() { loadOrders().catch(function(e) { setOrdersNotice(e.message, true); }); });
    document.querySelector("#exportCsvBtn").addEventListener("click", exportCsv);
    document.querySelector("#searchInput").addEventListener("input", renderOrders);
    document.querySelector("#statusFilter").addEventListener("change", renderOrders);

    document.addEventListener("click", async function(e) {
      var updateBtn = e.target.closest(".updateBtn");
      if (updateBtn) {
        var oid = updateBtn.dataset.oid;
        var sel = document.querySelector('select[data-oid="' + oid + '"]');
        try { await patchStatus(oid, sel.value); setOrdersNotice("Updated " + oid); await loadOrders(); }
        catch(err) { setOrdersNotice(err.message, true); }
        return;
      }
      var confirmBtn = e.target.closest(".confirmBtn");
      if (confirmBtn) {
        try { await patchStatus(confirmBtn.dataset.oid, "paid"); setOrdersNotice("Confirmed " + confirmBtn.dataset.oid); await loadOrders(); }
        catch(err) { setOrdersNotice(err.message, true); }
        return;
      }
      var rejectBtn = e.target.closest(".rejectBtn");
      if (rejectBtn) {
        if (!confirm("Reject order " + rejectBtn.dataset.oid + "?")) return;
        try { await patchStatus(rejectBtn.dataset.oid, "rejected"); setOrdersNotice("Rejected " + rejectBtn.dataset.oid); await loadOrders(); }
        catch(err) { setOrdersNotice(err.message, true); }
        return;
      }
      var slipBtn = e.target.closest(".slipBtn");
      if (slipBtn) { viewSlip(slipBtn.dataset.oid).catch(function(err) { setOrdersNotice(err.message, true); }); return; }
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
        return '<div class="product-card' + (p.available ? "" : " unavailable") + '" data-slug="' + esc(p.slug) + '">' +
          '<img class="product-img" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" onerror="this.style.background=\'#eee\'" />' +
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

    function renderBarChart(container, items, maxVal) {
      container.innerHTML = items.map(function(item) {
        var pct = maxVal ? Math.round(item[1] / maxVal * 100) : 0;
        return '<div class="bar-row">' +
          '<div class="bar-label" title="' + esc(item[0]) + '">' + esc(item[0]) + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="bar-count">' + item[1] + '</div></div>';
      }).join("");
    }

    async function loadAnalytics() {
      if (!allOrders.length) {
        try {
          var res = await fetch("/admin/orders", { headers: authHeaders(), cache: "no-store" });
          if (!res.ok) throw new Error(await res.text());
          var data = await res.json();
          allOrders = data.orders || [];
          serverSummary = data.summary || {};
        } catch(e) { setAnalyticsNotice(e.message, true); return; }
      }
      var schoolMap = {}, productMap = {}, statusMap = {}, totalRevenue = 0;
      allOrders.forEach(function(o) {
        var school = (o.customer||{}).school || "Unknown";
        var prod = (o.product||{}).name || "Unknown";
        var status = o.status || "unknown";
        schoolMap[school] = (schoolMap[school]||0) + 1;
        productMap[prod] = (productMap[prod]||0) + 1;
        statusMap[status] = (statusMap[status]||0) + 1;
        if (["paid","preparing","shipped"].includes(status)) totalRevenue += Number(o.totalAmount||0);
      });
      var sortDesc = function(obj) { return Object.entries(obj).sort(function(a,b) { return b[1]-a[1]; }); };
      var schoolItems = sortDesc(schoolMap), productItems = sortDesc(productMap), statusItems = sortDesc(statusMap);

      document.querySelector("#analyticsGrid").innerHTML =
        '<div class="analytics-card" style="grid-column:1/-1">' +
          '<div class="stats" style="margin:0">' +
            '<div class="stat"><span>Total Orders</span><strong>' + allOrders.length + '</strong></div>' +
            '<div class="stat"><span>Confirmed Revenue</span><strong>' + baht(totalRevenue) + '</strong></div>' +
            '<div class="stat"><span>Schools</span><strong>' + schoolItems.length + '</strong></div>' +
            '<div class="stat"><span>Avg Order</span><strong>' + (allOrders.length ? baht(totalRevenue/allOrders.length) : "฿0") + '</strong></div>' +
          '</div>' +
        '</div>' +
        '<div class="analytics-card"><h3>By School</h3><div id="schoolChart"></div></div>' +
        '<div class="analytics-card"><h3>By Product</h3><div id="productChart"></div></div>' +
        '<div class="analytics-card"><h3>By Status</h3><div id="statusChart"></div></div>';

      renderBarChart(document.querySelector("#schoolChart"), schoolItems, schoolItems[0]?.[1]||1);
      renderBarChart(document.querySelector("#productChart"), productItems, productItems[0]?.[1]||1);
      renderBarChart(document.querySelector("#statusChart"), statusItems, statusItems[0]?.[1]||1);
      setAnalyticsNotice("Analytics from " + allOrders.length + " orders");
    }

    document.querySelector("#refreshAnalyticsBtn").addEventListener("click", function() {
      allOrders = [];
      loadAnalytics().catch(function(e) { setAnalyticsNotice(e.message, true); });
    });

    // ── SETTINGS ──────────────────────────────────────────────────────────────
    function setSettingsNotice(msg, err) {
      var el = document.querySelector("#settingsNotice");
      el.textContent = msg; el.style.color = err ? "var(--danger)" : "var(--muted)";
    }

    async function loadSettings() {
      try {
        var res = await fetch("/site-settings", { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        var s = await res.json();
        document.querySelector("#bannerText").value = s.announcementBanner || "";
        document.querySelector("#bannerEnabled").checked = s.announcementBannerEnabled === true;
        document.querySelector("#storeOpen").checked = s.storeOpen !== false;
        if (s.orderDeadline) document.querySelector("#orderDeadline").value = s.orderDeadline.slice(0,16);
        setSettingsNotice("Settings loaded");
      } catch(e) { setSettingsNotice(e.message, true); }
    }

    document.querySelector("#saveSettingsBtn").addEventListener("click", async function() {
      var payload = {
        announcementBanner: document.querySelector("#bannerText").value,
        announcementBannerEnabled: document.querySelector("#bannerEnabled").checked,
        storeOpen: document.querySelector("#storeOpen").checked,
        orderDeadline: document.querySelector("#orderDeadline").value || null,
      };
      try {
        var res = await fetch("/admin/site-settings", {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());
        setSettingsNotice("Settings saved");
      } catch(e) { setSettingsNotice(e.message, true); }
    });

    // ── Init ───────────────────────────────────────────────────────────────────
    loadProducts();
    if (tokenInput.value) {
      loadOrders();
    } else {
      setOrdersNotice("Enter API Token to load orders");
    }
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
        <option value="shipped">shipped</option>
        <option value="cancelled">cancelled</option>
        <option value="rejected">rejected</option>
      </select>
      <button class="primary" id="refreshButton">Refresh</button>
    </section>
    <section class="summary" id="summary"></section>
    <p class="notice" id="notice"></p>
    <section class="table-wrap" id="tableWrap"></section>
  </main>
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
      const khantokUsed = Number(serverSummary.khantokTicketUsed || 0);
      const khantokRemaining = Number(serverSummary.khantokTicketRemaining || 0);
      const khantokQuota = Number(serverSummary.khantokTicketQuota || 0);
      const items = [
        ["Showing", orders.length],
        ["All Orders", serverSummary.total || allOrders.length],
        ["Waiting Confirm", serverSummary.waitingConfirm || 0],
        ["Total Amount", baht(totalAmount)],
        ["Khantok Used", `${khantokUsed} ใบ`],
        ["Khantok Remaining", `${khantokRemaining} / ${khantokQuota} ใบ`]
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
                  <td><span class="badge ${text(order.status || "")}">${text(order.status || "-")}</span></td>
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
                  <td>${order.khantokTicket ? "ได้รับ" : order.khantokTicketAlreadyClaimed ? "รับไปแล้ว " + (order.customer?.studentCode || "") : "ไม่ได้รับ"}</td>
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

    async function openSlip(orderId) {
      const response = await fetch(`/admin/orders/${encodeURIComponent(orderId)}/slip`, {
        headers: { "Authorization": `Bearer ${tokenInput.value.trim()}` }
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    refreshButton.addEventListener("click", () => loadOrders().catch((error) => setNotice(error.message, true)));
    searchInput.addEventListener("input", renderOrders);
    statusFilter.addEventListener("change", renderOrders);
    document.addEventListener("click", (event) => {
      const slipButton = event.target.closest(".slipButton");
      if (slipButton) {
        openSlip(slipButton.dataset.orderId).catch((error) => setNotice(error.message, true));
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


TZ_BANGKOK = timezone(timedelta(hours=7))


def now_iso() -> str:
    return datetime.now(TZ_BANGKOK).replace(microsecond=0).isoformat()


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SLIPS_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
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
      if "student_code" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN student_code TEXT NOT NULL DEFAULT ''")
      if "full_name" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN full_name TEXT NOT NULL DEFAULT ''")
      if "parent_phone" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN parent_phone TEXT NOT NULL DEFAULT ''")
      if "items_json" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'")
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
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def get_current_phase() -> int:
    now = datetime.now(TZ_BANGKOK)
    m, d = now.month, now.day
    if m == 5 and 18 <= d <= 23: return 1
    if m == 5 and 25 <= d <= 30: return 2
    if m == 6 and  1 <= d <= 7:  return 3
    return 0


def create_order_code(sequence_number: int) -> str:
    return f"{ORDER_PREFIX}{sequence_number:04d}{get_current_phase()}"


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

            normalized_items.append(
                {
                    "id": str(item.get("id") or f"{item_product.get('slug', 'item')}-{index + 1}"),
                    "product": item_product,
                    "size": item_size.strip(),
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


def list_orders(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM orders ORDER BY internal_id DESC LIMIT 500"
    ).fetchall()
    return [serialize_order(row) for row in rows]


def create_orders_summary(connection: sqlite3.Connection, orders: list[dict[str, Any]]) -> dict[str, int]:
    khantok_ticket_used_row = connection.execute(
        "SELECT COUNT(*) AS count FROM khantok_ticket_claims"
    ).fetchone()
    khantok_ticket_used = int(khantok_ticket_used_row["count"] if khantok_ticket_used_row else 0)
    khantok_ticket_quota = max(KHANTOK_TICKET_QUOTA, 0)

    return {
        "total": len(orders),
        "pendingPayment": sum(1 for order in orders if order.get("status") == "pending_payment"),
        "waitingConfirm": sum(1 for order in orders if order.get("status") == "waiting_confirm"),
        "paid": sum(1 for order in orders if order.get("status") in {"paid", "preparing", "shipped"}),
        "rejected": sum(1 for order in orders if order.get("status") == "rejected"),
        "cancelled": sum(1 for order in orders if order.get("status") == "cancelled"),
        "khantokTicketQuota": khantok_ticket_quota,
        "khantokTicketUsed": khantok_ticket_used,
        "khantokTicketRemaining": max(khantok_ticket_quota - khantok_ticket_used, 0),
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
    row = fetch_order_by_code(connection, order_code)
    assert row is not None
    return serialize_order(row)


def reserve_khantok_ticket(
    connection: sqlite3.Connection, order_id: int, student_code: str
) -> tuple[bool, str | None, bool]:
    existing_claim = connection.execute(
        "SELECT claimed_at FROM khantok_ticket_claims WHERE order_id = ?",
        (order_id,),
    ).fetchone()
    if existing_claim is not None:
        return True, str(existing_claim["claimed_at"]), False

    code = (student_code or "").strip()
    if code:
        duplicate = connection.execute(
            "SELECT 1 FROM orders WHERE student_code = ? AND khantok_ticket = 1 AND internal_id != ?",
            (code, order_id),
        ).fetchone()
        if duplicate is not None:
            return False, None, True

    current_claims = connection.execute("SELECT COUNT(*) AS count FROM khantok_ticket_claims").fetchone()
    if current_claims is not None and int(current_claims["count"]) >= KHANTOK_TICKET_QUOTA:
        return False, None, False

    claimed_at = now_iso()
    connection.execute(
        "INSERT INTO khantok_ticket_claims (order_id, claimed_at) VALUES (?, ?)",
        (order_id, claimed_at),
    )
    return True, claimed_at, False


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
    order_code = create_order_code(sequence_number)
    connection.execute(
        "UPDATE orders SET order_code = ? WHERE internal_id = ?",
        (order_code, sequence_number),
    )
    items_for_check = payload.get("items") or []
    is_headband_only = bool(items_for_check) and all(
        (i.get("product") or {}).get("slug") == "fresh-headband" for i in items_for_check
    )
    if is_headband_only:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed = False, None, False
    else:
        khantok_ticket, khantok_ticket_claimed_at, khantok_ticket_already_claimed = reserve_khantok_ticket(
            connection, sequence_number, payload["customer"]["studentCode"]
        )
    connection.execute(
        "UPDATE orders SET khantok_ticket = ?, khantok_ticket_claimed_at = ?, khantok_ticket_already_claimed = ? WHERE internal_id = ?",
        (1 if khantok_ticket else 0, khantok_ticket_claimed_at, 1 if khantok_ticket_already_claimed else 0, sequence_number),
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


# ── Product management ────────────────────────────────────────────────────────

def serialize_product(row: sqlite3.Row) -> dict[str, Any]:
    image = row["image_path"] or "/images/polo.png"
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
    return {
        "announcementBanner": settings.get("announcement_banner", ""),
        "announcementBannerEnabled": settings.get("announcement_banner_enabled", "0") == "1",
        "storeOpen": settings.get("store_open", "1") == "1",
        "orderDeadline": settings.get("order_deadline", ""),
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

def export_orders_csv(orders: list[dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "order_id", "status", "payment_status", "total_amount", "size", "quantity",
        "created_at", "full_name", "student_code", "phone", "email", "school", "parent_phone",
        "product_name", "product_category", "khantok_ticket",
    ])
    for order in orders:
        c = order.get("customer") or {}
        p = order.get("product") or {}
        writer.writerow([
            order.get("id", ""),
            order.get("status", ""),
            order.get("paymentStatus", ""),
            order.get("totalAmount", ""),
            order.get("size", ""),
            order.get("quantity", ""),
            order.get("createdAt", ""),
            c.get("fullName", ""),
            c.get("studentCode", ""),
            c.get("phone", ""),
            c.get("email", ""),
            c.get("school", ""),
            c.get("parentPhone", ""),
            p.get("name", ""),
            p.get("category", ""),
            "yes" if order.get("khantokTicket") else "no",
        ])
    return output.getvalue()


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
        return bool(ORDER_API_TOKEN) and self.headers.get("Authorization") == f"Bearer {ORDER_API_TOKEN}"

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

        if path == "/admin":
            self._send_html(HTTPStatus.OK, ADMIN_HTML)
            return

        if path == "/orders":
            self._send_html(HTTPStatus.OK, ORDER_VIEW_HTML)
            return

        if path == "/admin/orders":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                orders = list_orders(connection)
                summary = create_orders_summary(connection, orders)
            self._send_json(
                HTTPStatus.OK,
                {
                    "orders": orders,
                    "summary": summary,
                },
            )
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
                self._send_json(HTTPStatus.OK, get_site_settings(connection))
            return

        if path == "/admin/orders/export.csv":
            if not self._require_admin_authorization():
                return
            with open_db() as connection:
                orders = list_orders(connection)
            csv_content = export_orders_csv(orders)
            response_body = ("﻿" + csv_content).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Content-Disposition", 'attachment; filename="orders.csv"')
            self.end_headers()
            self.wfile.write(response_body)
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
            if not self._is_authorized_for_order(row):
                self._deny_unauthorized()
                return
            self._send_json(HTTPStatus.OK, serialize_order(row))

    def do_POST(self) -> None:
        path = urlparse(self.path).path

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
            if not self._is_authorized_for_order(existing_order):
                self._deny_unauthorized()
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
            sync_order_to_google_sheets(order, "payment_slip_uploaded")
            self._send_json(HTTPStatus.OK, order)

    def log_message(self, format: str, *args: Any) -> None:
        timestamp = datetime.now(TZ_BANGKOK).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.client_address[0]} {format % args}")


if __name__ == "__main__":
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), OrderRequestHandler)
    print(f"Order API listening on http://{HOST}:{PORT}")
    server.serve_forever()
