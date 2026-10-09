"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminFetch, formatBaht } from "@/lib/adminApi";
import { Card, EmptyState, useToast } from "@/components/admin/ui";
import type { Dashboard } from "@/types/store";

const RANGES = [7, 30, 90];

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
}

function StatTile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm";
  return href ? <Link href={href} className={`${cls} transition hover:border-zinc-400`}>{body}</Link> : <div className={cls}>{body}</div>;
}

// Single-series daily bar chart: one hue, 4px rounded tops, 2px gaps, hover tooltip.
function DailyBars({ data }: { data: Dashboard["byDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.paidAmount), 1);
  const labelEvery = data.length <= 7 ? 1 : data.length <= 31 ? 7 : 14;
  const active = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 flex h-10 items-end justify-between text-sm">
        {active ? (
          <p>
            <span className="font-semibold text-zinc-900">{shortDate(active.date)}</span>
            <span className="ml-3 text-zinc-700">ชำระแล้ว {formatBaht(active.paidAmount)}</span>
            <span className="ml-3 text-zinc-500">{active.orders} ออเดอร์</span>
          </p>
        ) : (
          <p className="text-zinc-500">ชี้ที่แท่งเพื่อดูยอดของวันนั้น</p>
        )}
        <p className="text-xs text-zinc-400">สูงสุด {formatBaht(max)}</p>
      </div>
      <div className="relative h-48 border-b border-zinc-300" onMouseLeave={() => setHover(null)} role="img" aria-label="ยอดชำระแล้วรายวัน">
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-zinc-200" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-zinc-200" />
        <div className="relative flex h-full items-end gap-[2px]">
          {data.map((d, i) => (
            <div
              key={d.date}
              className="flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              tabIndex={0}
              aria-label={`${shortDate(d.date)} ${formatBaht(d.paidAmount)}`}
            >
              <div
                className={`w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-sky-800" : "bg-sky-600"}`}
                style={{ height: d.paidAmount > 0 ? `max(${(d.paidAmount / max) * 100}%, 2px)` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-zinc-400">
        {data.map((d, i) => (
          <span key={d.date} className="flex-1 overflow-visible whitespace-nowrap">
            {i % labelEvery === 0 ? shortDate(d.date) : ""}
          </span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-zinc-500">ดูเป็นตาราง</summary>
        <table className="mt-2 w-full max-w-md text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr><th className="py-1">วันที่</th><th className="py-1 text-right">ชำระแล้ว</th><th className="py-1 text-right">ออเดอร์</th></tr>
          </thead>
          <tbody>
            {[...data].reverse().filter((d) => d.orders > 0 || d.paidAmount > 0).map((d) => (
              <tr key={d.date} className="border-t border-zinc-100">
                <td className="py-1">{shortDate(d.date)}</td>
                <td className="py-1 text-right">{formatBaht(d.paidAmount)}</td>
                <td className="py-1 text-right">{d.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    adminFetch<Dashboard>(`dashboard?days=${days}`).then(setData).catch((e: Error) => toast(e.message, "error"));
  }, [days, toast]);

  if (!data) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const waiting = data.statusCounts.waiting_confirm;
  const toHandOver = data.statusCounts.paid + data.statusCounts.ready;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ภาพรวม</h1>
        <p className="text-sm text-zinc-500">ยอดขายนับเฉพาะออเดอร์ที่ยืนยันการชำระแล้ว ไม่รวมออเดอร์ที่ยกเลิก</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="ยอดขาย (ชำระแล้ว)" value={formatBaht(data.paidAmount)} />
        <StatTile label="ยอดรอชำระ / รอตรวจ" value={formatBaht(data.awaitingAmount)} hint="ยังไม่นับเป็นยอดขาย" />
        <StatTile
          label="สลิปรอตรวจ"
          value={waiting.toLocaleString("th-TH")}
          hint={waiting > 0 ? "กดเพื่อไปตรวจสลิป →" : "ไม่มีงานค้าง"}
          href="/admin/orders?status=waiting_confirm"
        />
        <StatTile label="รอส่งมอบสินค้า" value={toHandOver.toLocaleString("th-TH")} hint={`จากทั้งหมด ${data.orderCount.toLocaleString("th-TH")} ออเดอร์`} href="/admin/orders?status=paid" />
      </div>

      <Card title="ยอดชำระแล้วรายวัน">
        <div className="-mt-2 mb-4 flex gap-2">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${days === r ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
            >
              {r} วัน
            </button>
          ))}
        </div>
        <DailyBars data={data.byDay} />
      </Card>

      <Card title="จำนวนที่ขายได้ แยกตามสินค้าและตัวเลือก" hint="ใช้ดูว่าต้องสั่งผลิต/เตรียมของแต่ละไซซ์เท่าไร">
        {data.byVariant.length === 0 ? (
          <EmptyState title="ยังไม่มีออเดอร์" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-zinc-500">
                <tr className="border-b border-zinc-200">
                  <th className="py-2 pr-3 font-semibold">สินค้า</th>
                  <th className="py-2 pr-3 font-semibold">ตัวเลือก</th>
                  <th className="py-2 pr-3 text-right font-semibold">ชำระแล้ว (ชิ้น)</th>
                  <th className="py-2 pr-3 text-right font-semibold">รอชำระ (ชิ้น)</th>
                  <th className="py-2 text-right font-semibold">ยอดเงิน (ชำระแล้ว)</th>
                </tr>
              </thead>
              <tbody>
                {data.byVariant.map((r, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 font-medium">{r.productName}</td>
                    <td className="py-2 pr-3 text-zinc-600">{r.variantLabel === "-" ? "—" : r.variantLabel}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{r.paidQuantity.toLocaleString("th-TH")}</td>
                    <td className="py-2 pr-3 text-right text-zinc-500">{r.unpaidQuantity.toLocaleString("th-TH")}</td>
                    <td className="py-2 text-right">{formatBaht(r.paidAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
