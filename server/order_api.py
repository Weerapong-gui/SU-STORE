#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import html
import io
import json
import os
import re
import secrets
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone
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
ORDER_PREFIX = os.environ.get("ORDER_PREFIX", "FP28")
ORDER_ROUND = int(os.environ.get("ORDER_ROUND", "1"))
ORDER_API_TOKEN = os.environ.get("ORDER_API_TOKEN", "")
GOOGLE_SHEETS_WEBHOOK_URL = os.environ.get("GOOGLE_SHEETS_WEBHOOK_URL", "").strip()
GOOGLE_SHEETS_WEBHOOK_TOKEN = os.environ.get("GOOGLE_SHEETS_WEBHOOK_TOKEN", "").strip()
KHANTOKE_TICKET_QUOTA = int(
    os.environ.get("KHANTOKE_TICKET_QUOTA", os.environ.get("LUCKY_TICKET_QUOTA", "2000"))
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


ADMIN_HTML = r"""<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SU STORE Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f4f5;
      --panel: #ffffff;
      --line: #d8d8dd;
      --text: #111114;
      --muted: #666a73;
      --accent: #0071e3;
      --danger: #b42318;
      --ok: #027a48;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px clamp(16px, 4vw, 44px);
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(18px);
    }
    h1 {
      margin: 0;
      font-size: clamp(24px, 4vw, 44px);
      letter-spacing: 0;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 28px auto 56px;
    }
    .toolbar, .stats, .orders {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto auto;
      gap: 10px;
      padding: 14px;
      align-items: center;
    }
    input, select, button {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    input, select { padding: 0 12px; width: 100%; }
    button {
      cursor: pointer;
      padding: 0 16px;
      font-weight: 700;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button.ghost { background: #fff; }
    button:disabled { cursor: not-allowed; opacity: 0.55; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
      margin: 16px 0;
    }
    .stat {
      padding: 16px;
      background: #fff;
    }
    .stat span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .12em;
    }
    .stat strong {
      display: block;
      margin-top: 8px;
      font-size: 26px;
    }
    .orders { overflow: hidden; }
    table {
      width: 100%;
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
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .1em;
      background: #fbfbfc;
    }
    tr:last-child td { border-bottom: 0; }
    .muted { color: var(--muted); }
    .money { color: var(--accent); font-weight: 800; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 0 9px;
      border-radius: 999px;
      background: #eef2ff;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .badge.waiting_confirm { background: #fff7ed; color: #9a3412; }
    .badge.paid, .badge.preparing, .badge.shipped { background: #ecfdf3; color: var(--ok); }
    .badge.rejected, .badge.cancelled { background: #fef3f2; color: var(--danger); }
    .actions {
      display: grid;
      gap: 8px;
    }
    .notice {
      margin-top: 12px;
      color: var(--muted);
      min-height: 24px;
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      .toolbar { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table, thead, tbody, tr, th, td { display: block; }
      thead { display: none; }
      tr { border-bottom: 1px solid var(--line); padding: 12px; }
      td { border-bottom: 0; padding: 6px 0; }
      td::before {
        content: attr(data-label);
        display: block;
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .1em;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Admin Orders</h1>
    <button class="primary" id="refreshButton">Refresh</button>
  </header>
  <main>
    <section class="toolbar">
      <input id="tokenInput" type="password" autocomplete="current-password" placeholder="ORDER_API_TOKEN" />
      <button class="primary" id="saveTokenButton">Save Token</button>
      <button class="ghost" id="clearTokenButton">Clear</button>
    </section>
    <section class="stats" id="stats"></section>
    <section class="orders">
      <table>
        <thead>
          <tr>
            <th style="width: 12%">Order</th>
            <th style="width: 20%">Customer</th>
            <th style="width: 22%">Product</th>
            <th style="width: 12%">Payment</th>
            <th style="width: 14%">Status</th>
            <th style="width: 20%">Actions</th>
          </tr>
        </thead>
        <tbody id="ordersBody"></tbody>
      </table>
    </section>
    <p class="notice" id="notice"></p>
  </main>
  <script>
    const statuses = [
      "pending_payment",
      "waiting_confirm",
      "paid",
      "preparing",
      "shipped",
      "cancelled",
      "rejected"
    ];
    const tokenInput = document.querySelector("#tokenInput");
    const notice = document.querySelector("#notice");
    const ordersBody = document.querySelector("#ordersBody");
    const stats = document.querySelector("#stats");

    tokenInput.value = localStorage.getItem("suStoreAdminToken") || "";

    function headers() {
      return {
        "Authorization": `Bearer ${tokenInput.value.trim()}`,
        "Content-Type": "application/json"
      };
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
      notice.style.color = isError ? "var(--danger)" : "var(--muted)";
    }

    function renderStats(summary) {
      const items = [
        ["Total", summary.total || 0],
        ["Waiting Slip", summary.pendingPayment || 0],
        ["Waiting Confirm", summary.waitingConfirm || 0],
        ["Paid", summary.paid || 0],
      ];
      stats.innerHTML = items.map(([label, value]) => `
        <div class="stat"><span>${label}</span><strong>${value}</strong></div>
      `).join("");
    }

    function renderOrders(orders) {
      ordersBody.innerHTML = orders.map((order) => {
        const customer = order.customer || {};
        const product = order.product || {};
        const slip = order.slip;
        const options = statuses.map((status) => `
          <option value="${status}" ${order.status === status ? "selected" : ""}>${status}</option>
        `).join("");
        return `
          <tr>
            <td data-label="Order">
              <strong>${order.id}</strong><br />
              <span class="muted">${order.createdAt || ""}</span><br />
              <span class="badge ${order.status}">${order.status}</span>
            </td>
            <td data-label="Customer">
              <strong>${customer.fullName || "-"}</strong><br />
              <span>${customer.studentCode || "-"}</span><br />
              <span class="muted">${customer.email || ""}</span><br />
              <span class="muted">${customer.phone || ""}</span>
            </td>
            <td data-label="Product">
              <strong>${product.name || "-"}</strong><br />
              <span>Size: ${order.size || "-"} / Qty: ${order.quantity || 0}</span><br />
              <span class="money">${baht(order.totalAmount)}</span><br />
              <span class="muted">${customer.school || ""}</span>
            </td>
            <td data-label="Payment">
              <strong>${order.paymentStatus || "-"}</strong><br />
              <span>${slip ? "Slip uploaded" : "No slip"}</span><br />
              <span class="muted">${slip?.uploadedAt || ""}</span>
            </td>
            <td data-label="Status">
              <select data-order-id="${order.id}" class="statusSelect">${options}</select>
            </td>
            <td data-label="Actions">
              <div class="actions">
                <button class="primary updateButton" data-order-id="${order.id}">Update Status</button>
                <button class="ghost slipButton" data-order-id="${order.id}" ${slip ? "" : "disabled"}>View Slip</button>
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }

    async function loadOrders() {
      setNotice("Loading orders...");
      const response = await fetch("/admin/orders", { headers: headers(), cache: "no-store" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      renderStats(payload.summary || {});
      renderOrders(payload.orders || []);
      setNotice(`Loaded ${payload.orders?.length || 0} orders`);
    }

    async function updateStatus(orderId) {
      const select = document.querySelector(`select[data-order-id="${orderId}"]`);
      const status = select.value;
      const response = await fetch(`/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status })
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setNotice(`Updated ${orderId} to ${status}`);
      await loadOrders();
    }

    async function viewSlip(orderId) {
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

    document.querySelector("#saveTokenButton").addEventListener("click", () => {
      localStorage.setItem("suStoreAdminToken", tokenInput.value.trim());
      setNotice("Token saved");
      loadOrders().catch((error) => setNotice(error.message, true));
    });
    document.querySelector("#clearTokenButton").addEventListener("click", () => {
      localStorage.removeItem("suStoreAdminToken");
      tokenInput.value = "";
      ordersBody.innerHTML = "";
      stats.innerHTML = "";
      setNotice("Token cleared");
    });
    document.querySelector("#refreshButton").addEventListener("click", () => {
      loadOrders().catch((error) => setNotice(error.message, true));
    });
    document.addEventListener("click", (event) => {
      const updateButton = event.target.closest(".updateButton");
      if (updateButton) {
        updateStatus(updateButton.dataset.orderId).catch((error) => setNotice(error.message, true));
      }
      const slipButton = event.target.closest(".slipButton");
      if (slipButton) {
        viewSlip(slipButton.dataset.orderId).catch((error) => setNotice(error.message, true));
      }
    });

    if (tokenInput.value) {
      loadOrders().catch((error) => setNotice(error.message, true));
    } else {
      setNotice("Enter ORDER_API_TOKEN to load orders");
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
      const khantokeUsed = Number(serverSummary.khantokeTicketUsed || 0);
      const khantokeRemaining = Number(serverSummary.khantokeTicketRemaining || 0);
      const khantokeQuota = Number(serverSummary.khantokeTicketQuota || 0);
      const items = [
        ["Showing", orders.length],
        ["All Orders", serverSummary.total || allOrders.length],
        ["Waiting Confirm", serverSummary.waitingConfirm || 0],
        ["Total Amount", baht(totalAmount)],
        ["Khantoke Used", `${khantokeUsed} ใบ`],
        ["Khantoke Remaining", `${khantokeRemaining} / ${khantokeQuota} ใบ`]
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
              <th style="width: 10%">Khantoke</th>
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
                  <td>${order.khantokeTicket ? "ได้รับ" : "ไม่ได้รับ"}</td>
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


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
              khantoke_ticket INTEGER NOT NULL DEFAULT 0,
              khantoke_ticket_claimed_at TEXT,
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
      if "khantoke_ticket" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantoke_ticket INTEGER NOT NULL DEFAULT 0")
      if "khantoke_ticket_claimed_at" not in columns:
          connection.execute("ALTER TABLE orders ADD COLUMN khantoke_ticket_claimed_at TEXT")
      if "lucky_ticket" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantoke_ticket = lucky_ticket
              WHERE khantoke_ticket = 0 AND lucky_ticket = 1
              """
          )
      if "lucky_ticket_claimed_at" in columns:
          connection.execute(
              """
              UPDATE orders
              SET khantoke_ticket_claimed_at = lucky_ticket_claimed_at
              WHERE
                  (khantoke_ticket_claimed_at IS NULL OR khantoke_ticket_claimed_at = '')
                  AND lucky_ticket_claimed_at IS NOT NULL
                  AND lucky_ticket_claimed_at != ''
              """
          )
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
          CREATE TABLE IF NOT EXISTS khantoke_ticket_claims (
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
              INSERT OR IGNORE INTO khantoke_ticket_claims (order_id, claimed_at)
              SELECT order_id, claimed_at FROM lucky_ticket_claims
              """
          )
      connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code)")


def open_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def create_order_code(sequence_number: int) -> str:
    return f"{ORDER_PREFIX}{sequence_number:05d}"


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
        "khantokeTicket": bool(
            row["khantoke_ticket"] if "khantoke_ticket" in row_keys else row["lucky_ticket"]
        ),
        "khantokeTicketClaimedAt": (
            row["khantoke_ticket_claimed_at"]
            if "khantoke_ticket_claimed_at" in row_keys
            else row["lucky_ticket_claimed_at"]
        ),
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
        "khantokeTicket": order.get("khantokeTicket", order.get("luckyTicket", False)),
        "khantokeTicketClaimedAt": order.get(
            "khantokeTicketClaimedAt", order.get("luckyTicketClaimedAt", "")
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
    khantoke_ticket_used_row = connection.execute(
        "SELECT COUNT(*) AS count FROM khantoke_ticket_claims"
    ).fetchone()
    khantoke_ticket_used = int(khantoke_ticket_used_row["count"] if khantoke_ticket_used_row else 0)
    khantoke_ticket_quota = max(KHANTOKE_TICKET_QUOTA, 0)

    return {
        "total": len(orders),
        "pendingPayment": sum(1 for order in orders if order.get("status") == "pending_payment"),
        "waitingConfirm": sum(1 for order in orders if order.get("status") == "waiting_confirm"),
        "paid": sum(1 for order in orders if order.get("status") in {"paid", "preparing", "shipped"}),
        "rejected": sum(1 for order in orders if order.get("status") == "rejected"),
        "cancelled": sum(1 for order in orders if order.get("status") == "cancelled"),
        "khantokeTicketQuota": khantoke_ticket_quota,
        "khantokeTicketUsed": khantoke_ticket_used,
        "khantokeTicketRemaining": max(khantoke_ticket_quota - khantoke_ticket_used, 0),
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


def reserve_khantoke_ticket(connection: sqlite3.Connection, order_id: int) -> tuple[bool, str | None]:
    existing_claim = connection.execute(
        "SELECT claimed_at FROM khantoke_ticket_claims WHERE order_id = ?",
        (order_id,),
    ).fetchone()
    if existing_claim is not None:
        return True, str(existing_claim["claimed_at"])

    current_claims = connection.execute("SELECT COUNT(*) AS count FROM khantoke_ticket_claims").fetchone()
    if current_claims is not None and int(current_claims["count"]) >= KHANTOKE_TICKET_QUOTA:
        return False, None

    claimed_at = now_iso()
    connection.execute(
        "INSERT INTO khantoke_ticket_claims (order_id, claimed_at) VALUES (?, ?)",
        (order_id, claimed_at),
    )
    return True, claimed_at


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
    khantoke_ticket, khantoke_ticket_claimed_at = reserve_khantoke_ticket(connection, sequence_number)
    connection.execute(
        "UPDATE orders SET khantoke_ticket = ?, khantoke_ticket_claimed_at = ? WHERE internal_id = ?",
        (1 if khantoke_ticket else 0, khantoke_ticket_claimed_at, sequence_number),
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

            if field_name == "uploadedAt":
                uploaded_at = str(part.get_content() or uploaded_at)
                continue

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
                    "khantokeTicket": bool(order.get("khantokeTicket")),
                    "message": "ได้รับ Khantoke ticket" if order.get("khantokeTicket") else "สิทธิ์ Khantoke ticket เต็มแล้ว",
                },
            )

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
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
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] {self.client_address[0]} {format % args}")


if __name__ == "__main__":
    ensure_db()
    server = ThreadingHTTPServer((HOST, PORT), OrderRequestHandler)
    print(f"Order API listening on http://{HOST}:{PORT}")
    server.serve_forever()
