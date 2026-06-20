import Link from "next/link";
import { OrderAccessFallback } from "@/components/OrderAccessFallback";
import { Container } from "@/components/ui/Container";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import { getOrderCustomerName } from "@/lib/orderStatus";
import { getOrderById } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

type CheckoutCompletePageProps = {
  params: { orderId: string };
};

export default async function CheckoutCompletePage({ params }: CheckoutCompletePageProps) {
  const order = await getOrderById(params.orderId);

  if (!order) {
    return <OrderAccessFallback orderId={params.orderId} title="Unable to open the order status page" />;
  }

  const items =
    order.items.length > 0
      ? order.items
      : [{ product: order.product, size: order.size, quantity: order.quantity, totalAmount: order.totalAmount }];

  return (
    <section className="min-h-screen bg-mist py-12 md:py-20">
      <Container className="max-w-xl">
        {/* Success mark */}
        <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white ring-4 ring-emerald-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden="true">
            <path d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>

        <p className="text-xs font-semibold tracking-[0.14em] text-zinc-400">ORDER CONFIRMED</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
          We have your order.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-500">
          Slip received for{" "}
          <span className="font-mono font-semibold text-zinc-700">{formatOrderNumber(order)}</span>.
          {" "}We&apos;ll review and confirm soon.
        </p>

        {/* Items */}
        <div className="mt-8 overflow-hidden rounded-3xl border border-zinc-200 bg-white">
          <div className="divide-y divide-zinc-100">
            {items.map((item, i) => (
              <div key={i} className="flex items-start justify-between gap-4 px-6 py-4">
                <div>
                  <p className="font-semibold text-zinc-900">{item.product.name}</p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    Size {item.size}
                    {item.quantity > 1 && <span> · Qty {item.quantity}</span>}
                  </p>
                </div>
                <p className="shrink-0 font-semibold text-zinc-900">{formatPrice(item.totalAmount)}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-6 py-4">
            <span className="text-xs font-semibold tracking-[0.1em] text-zinc-400">TOTAL</span>
            <span className="text-2xl font-semibold tracking-tight text-zinc-900">{formatPrice(order.totalAmount)}</span>
          </div>
        </div>

        {/* Customer info */}
        <div className="mt-3 overflow-hidden rounded-3xl border border-zinc-200 bg-white px-6 py-5">
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-8 gap-y-2.5 text-sm">
            <span className="text-zinc-400">Name</span>
            <span className="font-medium text-zinc-800">{getOrderCustomerName(order.customer)}</span>
            <span className="text-zinc-400">Student code</span>
            <span className="font-medium text-zinc-800">{order.customer.studentCode || "—"}</span>
            <span className="text-zinc-400">Phone</span>
            <span className="font-medium text-zinc-800">{order.customer.phone}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <Link
            href={`/check-order?studentCode=${order.customer.studentCode}`}
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-200"
          >
            Track Order
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300"
          >
            Back to Home
          </Link>
        </div>
      </Container>
    </section>
  );
}
