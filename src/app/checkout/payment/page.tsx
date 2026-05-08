import { redirect } from "next/navigation";
import { CheckoutPaymentForm } from "@/components/CheckoutPaymentForm";
import { Container } from "@/components/ui/Container";
import { getOrderById, getPaymentSlipUploadAvailability } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

type CheckoutPaymentPageProps = {
  searchParams?: {
    product?: string;
    orderId?: string;
    size?: string;
    quantity?: string;
    school?: string;
    itemId?: string;
  };
};

export default async function CheckoutPaymentPage({ searchParams }: CheckoutPaymentPageProps) {
  const orderId = searchParams?.orderId;
  const existingOrder = orderId ? await getOrderById(orderId) : null;
  const slipUploadAvailability = await getPaymentSlipUploadAvailability();

  if (!existingOrder && !searchParams?.product) {
    redirect("/checkout");
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutPaymentForm
          existingOrder={existingOrder}
          defaultProduct={searchParams?.product}
          defaultSize={searchParams?.size}
          defaultQuantity={searchParams?.quantity}
          defaultSchool={searchParams?.school}
          cartItemId={searchParams?.itemId}
          slipUploadEnabled={slipUploadAvailability.enabled}
          slipUploadMessage={slipUploadAvailability.message}
        />
      </Container>
    </section>
  );
}
