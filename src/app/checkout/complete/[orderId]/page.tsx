import Link from "next/link";
import { OrderAccessFallback } from "@/components/OrderAccessFallback";
import { Container } from "@/components/ui/Container";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import { getLuckyTicketLabel, getOrderCustomerName, getOrderStatusLabel } from "@/lib/orderStatus";
import { getOrderById } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

const ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 py-3 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";

type CheckoutCompletePageProps = {
  params: {
    orderId: string;
  };
};

export default async function CheckoutCompletePage({ params }: CheckoutCompletePageProps) {
  const order = await getOrderById(params.orderId);

  if (!order) {
    return <OrderAccessFallback orderId={params.orderId} title="Unable to open the order status page" />;
  }

  const isPaid = order.status === "paid" || order.status === "preparing" || order.status === "shipped";

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-4xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER STATUS</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            {isPaid ? "Payment confirmed" : "Payment slip submitted"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Order {formatOrderNumber(order)} is now{" "}
            <span className="font-medium text-zinc-900">{getOrderStatusLabel(order.status)}</span>.
            {isPaid
              ? " Your payment has already been approved."
              : " Our team will review the slip and update the order when payment is confirmed."}
          </p>

          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              order.luckyTicket
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {getLuckyTicketLabel(order.luckyTicket)}
          </div>

          <div className="mt-6 rounded-3xl border border-zinc-300 bg-white p-5">
            <div className="grid gap-3 text-sm text-zinc-700 md:grid-cols-2">
              <p>Product: {order.product.name}</p>
              <p>Amount: {formatPrice(order.totalAmount)}</p>
              <p>Name: {getOrderCustomerName(order.customer)}</p>
              <p>Student Code: {order.customer.studentCode || "-"}</p>
              <p>Phone: {order.customer.phone}</p>
              <p>Parent Phone: {order.customer.parentPhone || "-"}</p>
              <p>Status: {getOrderStatusLabel(order.status)}</p>
              <p>Uploaded Slip: {order.slip?.originalName ?? "-"}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/checkout/payment/${order.id}`} className={SECONDARY_ACTION_LINK_CLASSES}>
              View Payment Page
            </Link>
            <Link href="/" className={ACTION_LINK_CLASSES}>
              Back to Home
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
