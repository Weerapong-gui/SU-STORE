import Link from "next/link";
import { OrderAccessFallback } from "@/components/OrderAccessFallback";
import { PaymentSlipUploadForm } from "@/components/PaymentSlipUploadForm";
import { Container } from "@/components/ui/Container";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { canUploadPaymentSlip, getOrderById } from "@/lib/orderStore";
import { formatPrice } from "@/lib/formatPrice";

export const dynamic = "force-dynamic";

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-5 py-2.5 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const BANK_NAME = "ธนาคารกรุงเทพ";
const ACCOUNT_NUMBER = "672 - 3000 - 425";

type CheckoutPaymentPageProps = {
  params: {
    orderId: string;
  };
};

export default async function CheckoutPaymentPage({ params }: CheckoutPaymentPageProps) {
  const order = await getOrderById(params.orderId);

  if (!order) {
    return <OrderAccessFallback orderId={params.orderId} title="เปิดหน้าชำระเงินไม่ได้" />;
  }

  const slipUploadEnabled = canUploadPaymentSlip();

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            โอนชำระเงินและอัปโหลดสลิป
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            หมายเลขออเดอร์ {formatOrderNumber(order)} ถูกบันทึกแล้ว กรุณาโอนเงินตามข้อมูลบัญชีด้านล่าง และอัปโหลดสลิปเพื่อยืนยันการชำระเงิน
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">BANK ACCOUNT</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{BANK_NAME}</h2>

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">ACCOUNT NUMBER</p>
                <p className="mt-2 text-2xl font-semibold tracking-[0.08em] text-zinc-900 md:text-3xl">
                  {ACCOUNT_NUMBER}
                </p>
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-apple-blue">
                  {formatPrice(order.totalAmount)}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  ยอดนี้ถูกล็อกตามคำสั่งซื้อแล้ว หลังโอนเสร็จกรุณาแนบสลิปเพื่อให้ทีมงานตรวจสอบการชำระเงิน
                </p>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SUMMARY</p>
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
                <p className="font-semibold text-zinc-900">
                  Total: <span className="text-apple-blue">{formatPrice(order.totalAmount)}</span>
                </p>
                <p>Status: {order.paymentStatus === "slip_uploaded" ? "Slip uploaded" : "Awaiting slip"}</p>
              </div>

              <div className="mt-5 border-t border-zinc-200 pt-4 text-sm text-zinc-700">
                <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">UPLOAD PAYMENT SLIP</p>
                <div className="mt-3">
                  {slipUploadEnabled ? (
                    <PaymentSlipUploadForm
                      orderId={order.id}
                      hasUploadedSlip={Boolean(order.slip)}
                    />
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      deployment บน Vercel นี้ยังไม่ได้เชื่อม Blob storage สำหรับเก็บสลิป
                      กรุณาเพิ่ม <code className="rounded bg-amber-100 px-1">BLOB_READ_WRITE_TOKEN</code>
                      แล้ว redeploy ก่อนเปิดใช้งานขั้นตอนนี้
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href={`/checkout/summary/${order.id}`}
                  className={SECONDARY_ACTION_LINK_CLASSES}
                >
                  Back to Summary
                </Link>
                <Link
                  href={`/checkout?orderId=${order.id}`}
                  className={SECONDARY_ACTION_LINK_CLASSES}
                >
                  Edit Order
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
