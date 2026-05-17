import Image from "next/image";
import { BankAccountCopyField } from "@/components/BankAccountCopyField";
import { OrderAccessFallback } from "@/components/OrderAccessFallback";
import { PaymentSlipUploadForm } from "@/components/PaymentSlipUploadForm";
import { PreventBackNavigation } from "@/components/PreventBackNavigation";
import { Container } from "@/components/ui/Container";
import { formatPrice } from "@/lib/formatPrice";
import {
  PAYMENT_ACCOUNT_COPY_VALUE,
  PAYMENT_ACCOUNT_NUMBER,
  PAYMENT_BANK_NAME
} from "@/lib/paymentDetails";
import { getOrderCustomerName, getOrderStatusLabel } from "@/lib/orderStatus";
import { getOrderById, getPaymentSlipUploadAvailability } from "@/lib/orderStore";
import { formatStoredProductSize } from "@/lib/productSizing";

export const dynamic = "force-dynamic";

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";

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
      {!order.slip && <PreventBackNavigation />}
      <Container className="max-w-5xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            Pay and upload your slip
          </h1>

          <div className="mt-6 space-y-4">
            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SUMMARY</p>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="space-y-2 text-sm text-zinc-700">
                  {order.items.map((item) => (
                    <div key={item.id ?? `${item.product.slug}-${item.size}`} className="rounded-2xl bg-[#f7f7f9] p-4">
                      <h2 className="text-lg font-semibold text-zinc-900">{item.product.name}</h2>
                      <p>Size: {formatStoredProductSize(item.product.category, item.size)}</p>
                      {item.school && <p>{item.product.category === "headband" ? "Print on Headband" : "School"}: {item.school}</p>}
                      <p>Quantity: {item.quantity}</p>
                      <p>Unit Price: {formatPrice(item.unitPrice)}</p>
                      <p className="font-semibold text-zinc-900">
                        Total: <span className="text-apple-blue">{formatPrice(item.totalAmount)}</span>
                      </p>
                    </div>
                  ))}
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
                  <p>Enrolled at: {order.customer.school}</p>
                </div>
              </div>
            </div>

            <div className={INFO_CARD_CLASSES}>
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">BANK ACCOUNT</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-900">{PAYMENT_BANK_NAME}</h2>

              <div className="mx-auto mt-4 max-w-[48rem]">
                <div className="flex items-center justify-center rounded-[1.75rem] border border-zinc-200 bg-white px-5 py-4">
                  <Image
                    src="/images/logoBank.png"
                    alt="Bangkok Bank — องค์การบริหาร องค์การนักศึกษา มหาวิทยาลัยแม่ฟ้าหลวง"
                    width={1000}
                    height={500}
                    className="w-full max-w-sm object-contain"
                  />
                </div>

                <BankAccountCopyField
                  formattedAccountNumber={PAYMENT_ACCOUNT_NUMBER}
                  copyValue={PAYMENT_ACCOUNT_COPY_VALUE}
                />
              </div>

              <div className="mx-auto mt-5 max-w-[48rem] rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
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
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
