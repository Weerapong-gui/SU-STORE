"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminFetch, formatBaht, formatThaiDateTime } from "@/lib/adminApi";
import { Badge, Button, Card, inputClass, ORDER_STATUS_LABEL, useToast } from "@/components/admin/ui";
import type { OrderStatus, StoreMeta, StoreOrder } from "@/types/store";

// What staff normally do next from each status — shown as the big buttons.
const NEXT_STEPS: Partial<Record<OrderStatus, { to: OrderStatus; label: string }[]>> = {
  pending_payment: [{ to: "paid", label: "ยืนยันว่าได้รับเงินแล้ว" }],
  waiting_confirm: [
    { to: "paid", label: "✓ สลิปถูกต้อง ยืนยันการชำระ" },
    { to: "pending_payment", label: "สลิปไม่ถูกต้อง ให้ลูกค้าส่งใหม่" },
  ],
  paid: [{ to: "ready", label: "สินค้าพร้อมให้มารับ" }],
  ready: [{ to: "completed", label: "ลูกค้ารับสินค้าแล้ว" }],
};

const SLIP_CHECK_TEXT: Record<string, string> = {
  pending: "กำลังตรวจสลิปอัตโนมัติ...",
  approved: "ระบบอ่านสลิปได้ ยอดตรง",
  amount_mismatch: "ยอดในสลิปไม่ตรงกับยอดออเดอร์",
  duplicate: "สลิปนี้เคยใช้กับออเดอร์อื่นแล้ว",
  rejected: "ระบบอ่านสลิปไม่ได้ กรุณาตรวจด้วยตา",
  skipped: "ไฟล์ PDF ระบบไม่ตรวจอัตโนมัติ กรุณาตรวจด้วยตา",
  error: "ตรวจอัตโนมัติไม่สำเร็จ กรุณาตรวจด้วยตา",
};

export default function OrderDetailPage({ params }: { params: { code: string } }) {
  const toast = useToast();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminFetch<StoreMeta>("meta").then(setMeta).catch(() => {});
    adminFetch<StoreOrder>(`orders/${params.code}`)
      .then((o) => {
        setOrder(o);
        setNote(o.adminNote);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [params.code, toast]);

  async function patch(body: { status?: OrderStatus; adminNote?: string }, done: string) {
    setBusy(true);
    try {
      const updated = await adminFetch<StoreOrder>(`orders/${params.code}`, { method: "PATCH", json: body });
      setOrder((o) => ({ ...updated, slipCheck: o?.slipCheck }));
      toast(done);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function changeStatus(to: OrderStatus) {
    if (to === "cancelled" && !window.confirm("ยกเลิกออเดอร์นี้? สต็อกจะถูกคืน และเปลี่ยนกลับไม่ได้")) return;
    patch({ status: to }, `เปลี่ยนเป็น "${ORDER_STATUS_LABEL[to]}" แล้ว`);
  }

  if (!order) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const fieldLabel = (key: string) => meta?.buyerFields.find((f) => f.key === key)?.label ?? key;
  const slipUrl = `/api/admin/v2/orders/${order.orderCode}/slip`;
  const steps = NEXT_STEPS[order.status] ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/orders" className="text-sm text-zinc-500 hover:underline">
          ← ออเดอร์ทั้งหมด
        </Link>
        <h1 className="font-mono text-2xl font-bold">{order.orderCode}</h1>
        <Badge kind="order" status={order.status} />
        <span className="text-sm text-zinc-500">สั่งเมื่อ {formatThaiDateTime(order.createdAt)}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="รายการสินค้า">
            <table className="w-full text-sm">
              <tbody>
                {order.items.map((i, idx) => (
                  <tr key={idx} className="border-b border-zinc-100">
                    <td className="py-2">
                      <p className="font-medium">{i.productName}</p>
                      <p className="text-xs text-zinc-500">{i.variantLabel}</p>
                    </td>
                    <td className="py-2 text-zinc-600">
                      {formatBaht(i.unitPrice)} × {i.quantity}
                    </td>
                    <td className="py-2 text-right font-semibold">{formatBaht(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-right text-lg font-bold">รวม {formatBaht(order.totalAmount)}</p>
          </Card>

          <Card title="ข้อมูลผู้ซื้อ">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {Object.entries(order.customer).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-zinc-500">{fieldLabel(key)}</dt>
                  <dd className="text-sm font-medium">{value || "-"}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="สลิปโอนเงิน">
            {order.hasSlip ? (
              <div className="space-y-3">
                {order.slipCheck && (
                  <p
                    className={`rounded-lg px-3 py-2 text-sm ${
                      order.slipCheck.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {SLIP_CHECK_TEXT[order.slipCheck.status] ?? order.slipCheck.status}
                    {order.slipCheck.duplicate_of && ` (${order.slipCheck.duplicate_of})`}
                  </p>
                )}
                <a href={slipUrl} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={slipUrl} alt="สลิป" className="max-h-[480px] rounded-xl border border-zinc-200" />
                </a>
                <p className="text-xs text-zinc-500">
                  อัปโหลดเมื่อ {order.slipUploadedAt ? formatThaiDateTime(order.slipUploadedAt) : "-"} · กดที่รูปเพื่อเปิดเต็มจอ
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">ลูกค้ายังไม่ได้อัปโหลดสลิป</p>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="ขั้นตอนถัดไป">
            {steps.length > 0 ? (
              <div className="space-y-2">
                {steps.map((s) => (
                  <Button key={s.to} className="w-full" disabled={busy} onClick={() => changeStatus(s.to)}
                    variant={s.to === "pending_payment" ? "secondary" : "primary"}>
                    {s.label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                {order.status === "cancelled" ? "ออเดอร์นี้ถูกยกเลิกแล้ว" : "ออเดอร์นี้เสร็จสมบูรณ์แล้ว"}
              </p>
            )}
            {order.status !== "cancelled" && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-zinc-500">เปลี่ยนสถานะเอง</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[])
                    .filter((s) => s !== order.status)
                    .map((s) => (
                      <Button key={s} variant={s === "cancelled" ? "danger" : "secondary"} disabled={busy}
                        className="px-3 py-1.5 text-xs" onClick={() => changeStatus(s)}>
                        {ORDER_STATUS_LABEL[s]}
                      </Button>
                    ))}
                </div>
              </details>
            )}
          </Card>

          <Card title="หมายเหตุ (เห็นเฉพาะทีมงาน)">
            <textarea className={`${inputClass} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="secondary" className="mt-2" disabled={busy || note === order.adminNote}
              onClick={() => patch({ adminNote: note }, "บันทึกหมายเหตุแล้ว")}>
              บันทึกหมายเหตุ
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
