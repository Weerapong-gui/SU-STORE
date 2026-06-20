"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { formatPrice } from "@/lib/formatPrice";

type OrderRow = {
  id: string;           // order_code e.g. "FP28001 1"
  status: string;
  totalAmount: number;
  createdAt: string;
  khantokTicket?: boolean;
  khantokTicketValue?: number;
  customer: {
    fullName: string;
    studentCode: string;
    school: string;
  };
  product: {
    name: string;
  };
  slip?: object | null;
};

type OrdersResponse = {
  orders: OrderRow[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-800",
  waiting_confirm: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  preparing: "bg-purple-100 text-purple-800",
  shipped: "bg-teal-100 text-teal-800",
  received: "bg-zinc-100 text-zinc-600",
  cancelled: "bg-red-100 text-red-600",
  rejected: "bg-red-100 text-red-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "รอชำระเงิน",
  waiting_confirm: "รอยืนยัน",
  paid: "ชำระแล้ว",
  preparing: "กำลังเตรียม",
  shipped: "พร้อมรับ",
  received: "รับแล้ว",
  cancelled: "ยกเลิก",
  rejected: "ปฏิเสธ",
};

const ALL_STATUSES = Object.keys(STATUS_LABELS);

function formatDate(iso: string) {
  if (!iso) return "-";
  // Normalize: SQLite stores "2026-06-09T03:05:00.000000+00:00" or "2026-06-09 03:05:00"
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [changingStatus, setChangingStatus] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), per_page: "50" });
    if (search) qs.set("search", search);
    if (statusFilter) qs.set("status", statusFilter);
    try {
      const res = await fetch(`/api/admin/orders?${qs}`);
      if (res.status === 401) { router.push("/admin/login"); return; }
      const json = await res.json() as OrdersResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, router]);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  async function changeStatus(orderId: string, newStatus: string) {
    setChangingStatus(orderId);
    await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setChangingStatus(null);
    void fetchOrders();
  }

  return (
    <div className="min-h-screen">
      <AdminNav />
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-bold text-zinc-900">
            Orders {data ? `(${data.total})` : ""}
          </h1>
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name / code..."
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <button
            onClick={() => void fetchOrders()}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">Order</th>
                <th className="px-4 py-3 text-left">Name / School</th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">Loading...</td>
                </tr>
              ) : data?.orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">No orders found</td>
                </tr>
              ) : (
                data?.orders.map((order) => (
                  <tr key={order.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-semibold text-zinc-900">{order.id}</p>
                      <p className="text-xs text-zinc-400">{order.customer.studentCode}</p>
                      {order.khantokTicket && (
                        <span className="mt-0.5 inline-block rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          ticket ฿{order.khantokTicketValue}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900">{order.customer.fullName}</p>
                      <p className="text-xs text-zinc-400">{order.customer.school}</p>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">{order.product.name}</td>
                    <td className="px-4 py-3 text-right font-medium text-zinc-900">{formatPrice(order.totalAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[order.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                      {order.slip && (
                        <span className="ml-1 inline-block rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">slip</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{formatDate(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={changingStatus === order.id}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) void changeStatus(order.id, e.target.value);
                          e.target.value = "";
                        }}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none disabled:opacity-50"
                      >
                        <option value="" disabled>Change status...</option>
                        {ALL_STATUSES.filter((s) => s !== order.status).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-sm text-zinc-500">
              Page {data.page} / {data.pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
