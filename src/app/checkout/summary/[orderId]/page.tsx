import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { getOrderById } from "@/lib/orderStore";
import { formatPrice } from "@/lib/formatPrice";

export const dynamic = "force-dynamic";

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 py-3 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const PRIMARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";

type CheckoutSummaryPageProps = {
  params: {
    orderId: string;
  };
};

export default async function CheckoutSummaryPage({ params }: CheckoutSummaryPageProps) {
  const order = await getOrderById(params.orderId);

  if (!order) {
    notFound();
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CHECKOUT SUMMARY</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            ตรวจสอบคำสั่งซื้อก่อนชำระเงิน
          </h1>
          <p className="mt-2 text-sm text-zinc-600">Order ID: {order.id}</p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{order.product.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{order.product.tagline}</p>

              <div className="mt-4 space-y-2 text-sm text-zinc-700">
                <p>Size: {order.size}</p>
                <p>Quantity: {order.quantity}</p>
                <p>
                  Unit Price:{" "}
                  <span className="font-semibold text-apple-blue">
                    {formatPrice(order.product.price)}
                  </span>
                </p>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CUSTOMER</p>
              <div className="mt-3 space-y-2 text-sm text-zinc-700">
                <p>Name: {order.customer.firstName} {order.customer.lastName}</p>
                <p>Nickname: {order.customer.nickname}</p>
                <p>Email: {order.customer.email}</p>
                <p>Phone: {order.customer.phone}</p>
                <p>School: {order.customer.school}</p>
              </div>
            </div>
          </div>

          <div className={`mt-6 ${INFO_CARD_CLASSES}`}>
            <div className="flex items-center justify-between text-sm text-zinc-700">
              <span>Subtotal</span>
              <span className="font-semibold text-apple-blue">{formatPrice(order.totalAmount)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-lg font-semibold text-zinc-900">
              <span>Total</span>
              <span className="text-apple-blue">{formatPrice(order.totalAmount)}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/checkout?orderId=${order.id}`}
              className={SECONDARY_ACTION_LINK_CLASSES}
            >
              Back to Edit
            </Link>
            <Link
              href={`/checkout/payment/${order.id}`}
              className={PRIMARY_ACTION_LINK_CLASSES}
            >
              Continue to Payment
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
