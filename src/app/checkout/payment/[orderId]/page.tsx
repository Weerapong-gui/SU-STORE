import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import generatePayload from "promptpay-qr";
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

  const promptPayId = process.env.PROMPTPAY_ID ?? process.env.NEXT_PUBLIC_PROMPTPAY_ID ?? "";
  const slipUploadEnabled = canUploadPaymentSlip();

  let promptPayQrCodeDataUrl = "";
  if (promptPayId) {
    const promptPayPayload = generatePayload(promptPayId, { amount: order.totalAmount });
    promptPayQrCodeDataUrl = await QRCode.toDataURL(promptPayPayload, {
      margin: 1,
      width: 520,
      color: {
        dark: "#111111",
        light: "#f5f5f7"
      }
    });
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            สแกน QR เพื่อชำระเงิน
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            หมายเลขออเดอร์ {formatOrderNumber(order)} ถูกบันทึกแล้ว หลังโอนเสร็จให้อัปโหลดสลิปเพื่อยืนยันการชำระเงิน
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className={INFO_CARD_CLASSES}>
              {promptPayQrCodeDataUrl ? (
                <Image
                  src={promptPayQrCodeDataUrl}
                  alt={`PromptPay QR for ${formatPrice(order.totalAmount)}`}
                  width={280}
                  height={280}
                  unoptimized
                  className="mx-auto w-full max-w-[280px] rounded-2xl"
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
                  ยังไม่พบ PromptPay ID
                  <br />
                  กรุณาตั้งค่า <code className="rounded bg-zinc-200 px-1">PROMPTPAY_ID</code> ใน
                  <code className="ml-1 rounded bg-zinc-200 px-1">.env.local</code>
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
                <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-apple-blue">
                  {formatPrice(order.totalAmount)}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  ยอดนี้ถูกล็อกตามคำสั่งซื้อแล้ว คุณสามารถกลับไปแก้ไขก่อนอัปโหลดสลิปได้
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
