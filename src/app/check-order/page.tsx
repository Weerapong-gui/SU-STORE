"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Search, Package, CheckCircle2, Clock, XCircle, Truck, AlertCircle, Ticket } from "lucide-react";

type OrderStatus = "pending_payment" | "waiting_confirm" | "paid" | "preparing" | "shipped" | "cancelled" | "rejected";

interface PublicOrder {
  id: string;
  status: OrderStatus;
  paymentStatus: string;
  totalAmount: number;
  size: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product: { name: string; shortName: string; image: string; category: string };
  items: { product: { name: string }; size: string; quantity: number; totalAmount: number; school?: string | null }[];
  khantokTicket: boolean;
  khantokTicketValue?: number | null;
  khantokTicketAlreadyClaimed: boolean;
  customer: { fullName: string; studentCode: string; school: string };
  slip: { uploadedAt: string } | null;
}

const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; icon: React.ReactNode; description: string }> = {
  pending_payment:  { label: "รอชำระเงิน",      color: "text-zinc-500 bg-zinc-100",         icon: <Clock className="h-5 w-5" />,         description: "กรุณาชำระเงินและแนบสลิป" },
  waiting_confirm:  { label: "รอยืนยันการชำระ", color: "text-amber-700 bg-amber-50",        icon: <Clock className="h-5 w-5" />,         description: "ทีมงานกำลังตรวจสอบสลิปการโอน" },
  paid:             { label: "ชำระเงินแล้ว",     color: "text-emerald-700 bg-emerald-50",    icon: <CheckCircle2 className="h-5 w-5" />,  description: "ยืนยันการชำระเงินเรียบร้อย" },
  preparing:        { label: "กำลังเตรียมของ",   color: "text-blue-700 bg-blue-50",          icon: <Package className="h-5 w-5" />,       description: "กำลังเตรียมสินค้าของคุณ" },
  shipped:          { label: "พร้อมรับสินค้า",   color: "text-emerald-700 bg-emerald-50",    icon: <Truck className="h-5 w-5" />,         description: "สินค้าพร้อมแล้ว นัดรับได้เลย" },
  cancelled:        { label: "ยกเลิก",           color: "text-zinc-500 bg-zinc-100",         icon: <XCircle className="h-5 w-5" />,       description: "ออเดอร์ถูกยกเลิก" },
  rejected:         { label: "ปฏิเสธ",           color: "text-red-700 bg-red-50",            icon: <XCircle className="h-5 w-5" />,       description: "ไม่ผ่านการยืนยัน กรุณาติดต่อทีมงาน" },
};

function baht(n: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

function OrderCard({ order }: { order: PublicOrder }) {
  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending_payment;
  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">เลขออเดอร์</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-zinc-900">{order.id}</p>
          <p className="mt-1 text-xs text-zinc-400">{formatDate(order.createdAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${cfg.color}`}>
          {cfg.icon}
          {cfg.label}
        </span>
      </div>

      {/* Status description */}
      <div className={`flex items-center gap-2 px-6 py-3 text-sm font-medium ${cfg.color}`}>
        <AlertCircle className="h-4 w-4 shrink-0" />
        {cfg.description}
      </div>

      {/* Products */}
      <div className="divide-y divide-black/[0.05] px-6">
        {(order.items?.length ? order.items : [{
          product: order.product,
          size: order.size,
          quantity: order.quantity,
          totalAmount: order.totalAmount,
        }]).map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-semibold text-zinc-800">{item.product.name}</p>
              <p className="text-xs text-zinc-400">Size {item.size} × {item.quantity}</p>
              {item.school && (
                <p className="text-xs text-zinc-400">{item.school}</p>
              )}
            </div>
            <p className="text-sm font-bold text-apple-blue">{baht(item.totalAmount)}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-zinc-50/60 px-6 py-4">
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
          <span>{order.customer.fullName}</span>
          <span>{order.customer.studentCode}</span>
          <span>{order.customer.school}</span>
        </div>
        <div className="flex items-center gap-3">
          {order.khantokTicket ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Ticket className="h-3.5 w-3.5" /> ได้รับ Khantok ticket{order.khantokTicketValue ? ` ฿${order.khantokTicketValue}` : ""}
            </span>
          ) : order.khantokTicketAlreadyClaimed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <Ticket className="h-3.5 w-3.5" /> รับไปแล้ว
            </span>
          ) : null}
          <p className="text-base font-bold text-zinc-900">รวม {baht(order.totalAmount)}</p>
        </div>
      </div>
    </div>
  );
}

function CheckOrderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [input, setInput] = useState(searchParams.get("studentCode") ?? "");
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (value: string) => {
    const q = value.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    const param = `studentCode=${encodeURIComponent(q)}`;
    router.replace(`/check-order?${param}`, { scroll: false });

    try {
      const res = await fetch(`/api/check-order?${param}`, { cache: "no-store" });
      if (res.status === 404) { setOrders([]); setLoading(false); return; }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setOrders(data.order ? [data.order] : (data.orders ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Auto-search from URL params on mount
  useEffect(() => {
    const code = searchParams.get("studentCode");
    if (code) search(code);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(input);
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-50/50 py-12">
      <Container className="max-w-2xl">
        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">เช็คสถานะออเดอร์</h1>
          <p className="mt-2 text-zinc-500">กรอกรหัสนักศึกษาเพื่อดูสถานะออเดอร์</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="รหัสนักศึกษา เช่น 68XXXXXXXX"
                className="h-12 w-full rounded-xl border border-black/[0.1] bg-white pl-10 pr-4 text-sm shadow-sm outline-none ring-apple-blue focus:border-apple-blue focus:ring-1"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 rounded-xl bg-apple-blue px-5 text-sm font-semibold text-white transition hover:bg-apple-blue-dark disabled:opacity-50"
            >
              {loading ? "กำลังค้นหา..." : "ค้นหา"}
            </button>
          </div>
        </form>

        {/* Results */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && searched && !error && orders.length === 0 && (
          <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-12 text-center shadow-sm">
            <Package className="mx-auto mb-3 h-10 w-10 text-zinc-300" />
            <p className="font-semibold text-zinc-600">ไม่พบออเดอร์</p>
            <p className="mt-1 text-sm text-zinc-400">ลองตรวจสอบเลขออเดอร์หรือรหัสนักศึกษาอีกครั้ง</p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </Container>
    </div>
  );
}

export default function CheckOrderPage() {
  return (
    <Suspense>
      <CheckOrderContent />
    </Suspense>
  );
}
