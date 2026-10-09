"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Search, Package, CheckCircle2, Clock, XCircle, Truck, AlertCircle, Ticket } from "lucide-react";
import { useLang } from "@/lib/i18n";
import QRCode from "qrcode";
import { FeedbackModal } from "@/components/FeedbackModal";

type OrderStatus = "pending_payment" | "waiting_confirm" | "paid" | "preparing" | "shipped" | "received" | "cancelled" | "rejected" | "refund" | "refunded";

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
  items: { product: { name: string; category: string }; size: string; quantity: number; totalAmount: number; school?: string | null }[];
  khantokTicket: boolean;
  khantokTicketValue?: number | null;
  khantokTicketAlreadyClaimed: boolean;
  customer: { fullName: string; studentCode: string; school: string };
  slip: { uploadedAt: string } | null;
  qrToken?: string | null;
  feedbackSubmitted?: boolean;
}

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending_payment: "text-zinc-500 bg-zinc-100",
  waiting_confirm: "text-amber-700 bg-amber-50",
  paid:            "text-emerald-700 bg-emerald-50",
  preparing:       "text-blue-700 bg-blue-50",
  shipped:         "text-emerald-700 bg-emerald-50",
  received:        "text-purple-700 bg-purple-50",
  cancelled:       "text-zinc-500 bg-zinc-100",
  rejected:        "text-red-700 bg-red-50",
  refund:          "text-white bg-[#4d6d99]",
  refunded:        "text-zinc-500 bg-zinc-100",
};

const STATUS_ICONS: Record<OrderStatus, React.ReactNode> = {
  pending_payment: <Clock className="h-5 w-5" />,
  waiting_confirm: <Clock className="h-5 w-5" />,
  paid:            <CheckCircle2 className="h-5 w-5" />,
  preparing:       <Package className="h-5 w-5" />,
  shipped:         <Truck className="h-5 w-5" />,
  received:        <CheckCircle2 className="h-5 w-5" />,
  cancelled:       <XCircle className="h-5 w-5" />,
  rejected:        <XCircle className="h-5 w-5" />,
  refund:          <AlertCircle className="h-5 w-5" />,
  refunded:        <CheckCircle2 className="h-5 w-5" />,
};

function isHeadbandCategory(cat?: string) {
  return (cat || "").toLowerCase().includes("headband");
}
function orderAdjustedTotal(order: PublicOrder) {
  return (order.items || []).reduce((s, it) => {
    if (isHeadbandCategory(it.product?.category)) return s;
    return s + (Number(it.totalAmount) || 0);
  }, 0);
}

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
  const { t } = useLang();
  const statusKey = order.status in t.status ? order.status : "pending_payment";
  const cfg = (t.status as Record<string, { label: string; description: string }>)[statusKey];
  const color = STATUS_COLORS[order.status] ?? STATUS_COLORS.pending_payment;
  const icon = STATUS_ICONS[order.status] ?? STATUS_ICONS.pending_payment;
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    if (order.status === "shipped" && order.id) {
      const qrContent = order.qrToken
        ? `SUQR:${order.id}:${order.qrToken}`
        : order.id;
      QRCode.toDataURL(qrContent, { width: 220, margin: 2, color: { dark: "#000000", light: "#ffffff" } })
        .then(setQrDataUrl)
        .catch(() => {});
    } else {
      setQrDataUrl("");
    }
  }, [order.id, order.status, order.qrToken]);

  useEffect(() => {
    if (order.status !== "received" || !order.id) return;
    if (order.feedbackSubmitted) return;
    let done = false;
    try { done = localStorage.getItem(`feedback_${order.id}_done`) === "1"; } catch {}
    if (done) return;
    const timer = setTimeout(() => setFeedbackOpen(true), 600);
    return () => clearTimeout(timer);
  }, [order.id, order.status, order.feedbackSubmitted]);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{t.checkOrder.orderNumber}</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-zinc-900">{order.id}</p>
          <p className="mt-1 text-xs text-zinc-400">{formatDate(order.createdAt)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${color}`}>
          {icon}
          {cfg.label}
        </span>
      </div>

      {/* Status description */}
      <div className={`flex items-center gap-2 px-6 py-3 text-sm font-medium ${color}`}>
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
        }]).map((item, i) => {
          const isHb = isHeadbandCategory(item.product.category);
          const nameClass = isHb ? "text-sm font-semibold text-zinc-400 line-through" : "text-sm font-semibold text-zinc-800";
          const subClass = isHb ? "text-xs text-zinc-300" : "text-xs text-zinc-400";
          return (
          <div key={i} className={`flex items-center justify-between gap-4 py-3 ${isHb ? "opacity-70" : ""}`}>
            <div>
              <p className={nameClass}>
                {item.product.name}
                {isHb && <span className="ml-2 text-xs font-normal text-zinc-400 no-underline">(ยกเลิก)</span>}
              </p>
              <p className={subClass}>Size {item.size} × {item.quantity}</p>
              {item.school && (
                <p className={subClass} translate="no">
                  {item.product.category === "headband" ? "Print on Headband" : "School"}: {item.school}
                </p>
              )}
            </div>
            <p className={isHb ? "text-sm font-bold text-zinc-300" : "text-sm font-bold text-apple-blue"}>{baht(isHb ? 0 : item.totalAmount)}</p>
          </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] bg-zinc-50/60 px-6 py-4">
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500" translate="no">
          <span>{order.customer.fullName}</span>
          <span>{order.customer.studentCode}</span>
          <span>Enrolled at: {order.customer.school}</span>
        </div>
        <div className="flex items-center gap-3">
          {order.khantokTicket ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Ticket className="h-3.5 w-3.5" /> {t.checkOrder.khantokReceived}{order.khantokTicketValue ? ` ฿${order.khantokTicketValue}` : ""}
            </span>
          ) : order.khantokTicketAlreadyClaimed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <Ticket className="h-3.5 w-3.5" /> {t.checkOrder.khantokClaimed}
            </span>
          ) : null}
          <p className="text-base font-bold text-zinc-900">{t.checkOrder.total} {baht(orderAdjustedTotal(order))}</p>
        </div>
      </div>

      {/* QR code for shipped orders */}
      {order.status === "shipped" && qrDataUrl && (
        <div className="border-t border-black/[0.06] px-6 py-5 text-center">
          <p className="mb-3 text-sm font-semibold text-zinc-700">{t.checkOrder.pickupQrHint}</p>
          <div className="inline-block rounded-2xl border border-black/[0.08] bg-white p-3 shadow-sm">
            <img src={qrDataUrl} alt={`QR ${order.id}`} width={200} height={200} className="block" />
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-400">{order.id}</p>
        </div>
      )}


      <FeedbackModal
        orderId={order.id}
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  );
}

const FINAL_STATUSES: OrderStatus[] = ["received", "cancelled", "rejected", "refunded"];

function CheckOrderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useLang();

  const initInput = searchParams.get("studentCode") ?? searchParams.get("code") ?? "";
  const [input, setInput] = useState(initInput);
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const lastParamRef = useRef<string>("");

  function isOrderCode(q: string) {
    return /^[A-Za-z]/.test(q);
  }

  const search = useCallback(async (value: string) => {
    const q = value.trim().toUpperCase();
    if (!q) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    const useCode = isOrderCode(q);
    const param = useCode ? `code=${encodeURIComponent(q)}` : `studentCode=${encodeURIComponent(q)}`;
    lastParamRef.current = param;
    router.replace(`/check-order/fp28?${param}`, { scroll: false });

    try {
      const res = await fetch(`/api/check-order?${param}`, { cache: "no-store" });
      if (res.status === 404) { setOrders([]); setLoading(false); return; }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const allOrders = data.order ? [data.order] : (data.orders ?? []);
      setOrders(allOrders.filter((o: PublicOrder) => o.status !== "cancelled" && o.status !== "rejected"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.checkOrder.errorGeneric);
    } finally {
      setLoading(false);
    }
  }, [router, t.checkOrder.errorGeneric]);

  useEffect(() => {
    const sc = searchParams.get("studentCode");
    const oc = searchParams.get("code");
    if (sc) search(sc);
    else if (oc) search(oc);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll every 15s while any displayed order has a non-final status
  useEffect(() => {
    if (orders.length === 0) return;
    const hasLive = orders.some(o => !FINAL_STATUSES.includes(o.status));
    if (!hasLive) return;
    const param = lastParamRef.current;
    if (!param) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/check-order?${param}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const all = data.order ? [data.order] : (data.orders ?? []);
        setOrders(all.filter((o: PublicOrder) => o.status !== "cancelled" && o.status !== "rejected"));
      } catch {}
    }, 15000);
    return () => clearInterval(id);
  }, [orders]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(input);
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-zinc-50/50 py-12">
      <Container className="max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{t.checkOrder.title}</h1>
          <p className="mt-2 text-zinc-500">{t.checkOrder.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Student ID / Order No."
                className="h-12 w-full rounded-xl border border-black/[0.1] bg-white pl-10 pr-4 text-sm shadow-sm outline-none ring-apple-blue focus:border-apple-blue focus:ring-1"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 rounded-xl bg-apple-blue px-5 text-sm font-semibold text-white transition hover:bg-apple-blue-dark disabled:opacity-50"
            >
              {loading ? t.checkOrder.searching : t.checkOrder.search}
            </button>
          </div>
        </form>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{error}</p>
            <p className="mt-1 text-xs text-red-600">หากพบปัญหาขัดข้องเกี่ยวกับระบบให้ติดต่อผู้ดูแลระบบ โทร : 0838627000 ปาร์ค</p>
          </div>
        )}

        {!loading && searched && !error && orders.length === 0 && (
          <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-12 text-center shadow-sm">
            <Package className="mx-auto mb-3 h-10 w-10 text-zinc-300" />
            <p className="font-semibold text-zinc-600">{t.checkOrder.noOrders}</p>
            <p className="mt-1 text-sm text-zinc-400">{t.checkOrder.noOrdersHint}</p>
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
