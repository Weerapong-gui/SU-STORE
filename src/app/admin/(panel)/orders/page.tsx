"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminFetch, formatBaht, formatThaiDateTime } from "@/lib/adminApi";
import { Badge, Button, EmptyState, inputClass, ORDER_STATUS_LABEL, useToast } from "@/components/admin/ui";
import type { OrderStatus, StoreOrder } from "@/types/store";

type ListResponse = {
  orders: StoreOrder[];
  total: number;
  page: number;
  perPage: number;
  statusCounts: Record<OrderStatus, number>;
};

const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

export default function OrdersPage() {
  const toast = useToast();
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), per_page: "50" });
    if (status) qs.set("status", status);
    if (query) qs.set("q", query);
    adminFetch<ListResponse>(`orders?${qs}`)
      .then(setData)
      .catch((e: Error) => toast(e.message, "error"));
  }, [page, status, query, toast]);

  useEffect(load, [load]);

  const totalAll = data ? Object.values(data.statusCounts).reduce((a, b) => a + b, 0) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const csvHref = `/api/admin/v2/orders.csv${status ? `?status=${status}` : ""}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ออเดอร์</h1>
          <p className="text-sm text-zinc-500">กดที่ออเดอร์เพื่อดูสลิปและเปลี่ยนสถานะ</p>
        </div>
        <a href={csvHref} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-zinc-50">
          ⬇ ดาวน์โหลด Excel (CSV)
        </a>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ key: "" as const, label: "ทั้งหมด", count: totalAll }, ...STATUSES.map((s) => ({
          key: s,
          label: ORDER_STATUS_LABEL[s],
          count: data?.statusCounts[s] ?? 0,
        }))].map((tab) => (
          <button
            key={tab.key || "all"}
            type="button"
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              status === tab.key ? "bg-zinc-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {tab.label} <span className="opacity-60">{tab.count}</span>
          </button>
        ))}
      </div>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
          setPage(1);
        }}
      >
        <input
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขออเดอร์ ชื่อ เบอร์โทร หรือรหัสนักศึกษา"
        />
        <Button type="submit">ค้นหา</Button>
      </form>

      {data === null ? (
        <p className="text-sm text-zinc-500">กำลังโหลด...</p>
      ) : data.orders.length === 0 ? (
        <EmptyState title={query || status ? "ไม่พบออเดอร์ที่ตรงกับเงื่อนไข" : "ยังไม่มีออเดอร์"} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">เลขออเดอร์</th>
                <th className="px-4 py-3 font-semibold">ผู้ซื้อ</th>
                <th className="px-4 py-3 font-semibold">สินค้า</th>
                <th className="px-4 py-3 text-right font-semibold">ยอด</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 font-semibold">วันที่สั่ง</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.orderCode} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${o.orderCode}`} className="font-mono font-semibold text-zinc-900 hover:underline">
                      {o.orderCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p>{o.customer.name}</p>
                    <p className="text-xs text-zinc-500">{o.customer.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    {o.items.map((i) => `${i.productName} (${i.variantLabel}) ×${i.quantity}`).join(", ")}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatBaht(o.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge kind="order" status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{formatThaiDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← ก่อนหน้า
          </Button>
          <span>
            หน้า {page} / {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            ถัดไป →
          </Button>
        </div>
      )}
    </div>
  );
}
