"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { formatPrice } from "@/lib/formatPrice";

type Analytics = {
  total: number;
  revenue: number;
  schoolCount: number;
  profit: number;
  bySchool: [string, number][];
  byProduct: [string, number][];
  byStatus: [string, number][];
  bySize: [string, number][];
  byDay: [string, number][];
};

const STATUS_TH: Record<string, string> = {
  pending_payment: "รอชำระ",
  waiting_confirm: "รอยืนยัน",
  paid: "ชำระแล้ว",
  preparing: "กำลังเตรียม",
  shipped: "พร้อมรับ",
  received: "รับแล้ว",
  cancelled: "ยกเลิก",
  rejected: "ปฏิเสธ",
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-zinc-900">{value}</p>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then(async (res) => {
        if (res.status === 401) { router.push("/admin/login"); return; }
        setData(await res.json() as Analytics);
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <AdminNav />
        <div className="flex items-center justify-center py-20 text-zinc-400">Loading analytics...</div>
      </div>
    );
  }

  if (!data) return null;

  const maxDayCount = Math.max(...data.byDay.map(([, c]) => c), 1);

  return (
    <div className="min-h-screen">
      <AdminNav />
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <h1 className="text-xl font-bold text-zinc-900">Analytics</h1>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total Orders" value={String(data.total)} />
          <StatCard label="Revenue" value={formatPrice(data.revenue)} />
          <StatCard label="Net Profit (~)" value={formatPrice(data.profit)} />
          <StatCard label="Schools" value={String(data.schoolCount)} />
        </div>

        {/* Daily bar chart */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">Orders per Day</p>
          {data.byDay.length === 0 ? (
            <p className="text-sm text-zinc-400">No data</p>
          ) : (
            <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ height: 120 }}>
              {data.byDay.map(([day, count]) => (
                <div key={day} className="flex flex-1 min-w-[20px] flex-col items-center gap-1">
                  <span className="text-[9px] text-zinc-400">{count}</span>
                  <div
                    className="w-full rounded-t bg-blue-500"
                    style={{ height: `${Math.round((count / maxDayCount) * 80)}px` }}
                  />
                  <span className="text-[8px] text-zinc-300 rotate-45 origin-left whitespace-nowrap">
                    {day.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* By Status */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">By Status</p>
            <ul className="space-y-1">
              {data.byStatus.map(([status, count]) => (
                <li key={status} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{STATUS_TH[status] ?? status}</span>
                  <span className="font-semibold text-zinc-900">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* By Product */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">By Product</p>
            <ul className="space-y-1">
              {data.byProduct.map(([name, count]) => (
                <li key={name} className="flex justify-between text-sm">
                  <span className="text-zinc-700 truncate pr-2">{name}</span>
                  <span className="font-semibold text-zinc-900">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* By School (top 10) */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">By School (Top 10)</p>
            <ul className="space-y-1">
              {data.bySchool.slice(0, 10).map(([school, count]) => (
                <li key={school} className="flex justify-between text-sm">
                  <span className="text-zinc-700 truncate pr-2">{school}</span>
                  <span className="font-semibold text-zinc-900">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
