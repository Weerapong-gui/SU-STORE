import Link from "next/link";
import { BankAccountCopyField } from "@/components/BankAccountCopyField";
import { OrderAccessFallback } from "@/components/OrderAccessFallback";
import { PaymentSlipUploadForm } from "@/components/PaymentSlipUploadForm";
import { Container } from "@/components/ui/Container";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import {
  PAYMENT_ACCOUNT_COPY_VALUE,
  PAYMENT_ACCOUNT_NUMBER,
  PAYMENT_BANK_NAME
} from "@/lib/paymentDetails";
import { getLuckyTicketLabel, getOrderCustomerName, getOrderStatusLabel } from "@/lib/orderStatus";
import { getOrderById, getPaymentSlipUploadAvailability } from "@/lib/orderStore";
import { formatStoredProductSize } from "@/lib/productSizing";

export const dynamic = "force-dynamic";

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-5 py-2.5 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";

type CheckoutPaymentPageProps = {
  params: {
    orderId: string;
  };
};

export default async function CheckoutPaymentPage({ params }: CheckoutPaymentPageProps) {
  const order = await getOrderById(params.orderId);

  if (!order) {
    return <OrderAccessFallback orderId={params.orderId} title="Unable to open the payment page" />;
  }

  const slipUploadAvailability = await getPaymentSlipUploadAvailability();

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            Pay and upload your slip
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Order {formatOrderNumber(order)} has been created. Complete the transfer, then upload the payment slip for review.
          </p>

          <div className="mt-6 space-y-4">
            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SUMMARY</p>
              <div
                className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                  order.luckyTicket
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {getLuckyTicketLabel(order.luckyTicket)}
              </div>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="space-y-2 text-sm text-zinc-700">
                  <h2 className="text-xl font-semibold text-zinc-900">{order.product.name}</h2>
                  <p>Size: {formatStoredProductSize(order.product.category, order.size)}</p>
                  <p>Quantity: {order.quantity}</p>
                  <p>Unit Price: {formatPrice(order.product.price)}</p>
                  <p className="font-semibold text-zinc-900">
                    Total: <span className="text-apple-blue">{formatPrice(order.totalAmount)}</span>
                  </p>
                </div>

                <div className="space-y-2 text-sm text-zinc-700">
                  <p>
                    Status: <span className="font-medium text-zinc-900">{getOrderStatusLabel(order.status)}</span>
                  </p>
                  <p>Student Code: {order.customer.studentCode || "-"}</p>
                  <p>Name: {getOrderCustomerName(order.customer)}</p>
                  <p>Email: {order.customer.email}</p>
                  <p>Phone: {order.customer.phone}</p>
                  <p>Parent Phone: {order.customer.parentPhone || "-"}</p>
                  <p>School: {order.customer.school}</p>
                </div>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">BANK ACCOUNT</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{PAYMENT_BANK_NAME}</h2>

              <BankAccountCopyField
                formattedAccountNumber={PAYMENT_ACCOUNT_NUMBER}
                copyValue={PAYMENT_ACCOUNT_COPY_VALUE}
              />

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-apple-blue">
                  {formatPrice(order.totalAmount)}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Transfer this exact amount, then attach your slip below using the order number as reference.
                </p>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">UPLOAD SLIP</p>
              <div className="mt-3 text-sm text-zinc-700">
                {slipUploadAvailability.enabled ? (
                  <PaymentSlipUploadForm
                    orderId={order.id}
                    hasUploadedSlip={Boolean(order.slip)}
                  />
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {slipUploadAvailability.message ?? "Slip upload is not available right now."}
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/checkout" className={SECONDARY_ACTION_LINK_CLASSES}>
                  Back to Cart
                </Link>
                <Link href="/" className={SECONDARY_ACTION_LINK_CLASSES}>
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
