import { redirect } from "next/navigation";
import { CheckoutPaymentForm } from "@/components/CheckoutPaymentForm";
import { Container } from "@/components/ui/Container";
import { getOrderById } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

type CheckoutPaymentPageProps = {
  searchParams?: {
    product?: string;
    orderId?: string;
    size?: string;
    quantity?: string;
    itemId?: string;
    cart?: string;
  };
};

export default async function CheckoutPaymentPage({ searchParams }: CheckoutPaymentPageProps) {
  const orderId = searchParams?.orderId;
  const existingOrder = orderId ? await getOrderById(orderId) : null;
  const cartMode = searchParams?.cart === "1";

  if (!existingOrder && !searchParams?.product && !cartMode) {
    redirect("/checkout");
  }

  if (existingOrder && existingOrder.status !== "pending_payment") {
    redirect(`/checkout/payment/${existingOrder.id}`);
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutPaymentForm
          existingOrder={existingOrder}
          defaultProduct={searchParams?.product}
          defaultSize={searchParams?.size}
          defaultQuantity={searchParams?.quantity}
          cartItemId={searchParams?.itemId}
          cartMode={cartMode}
        />
      </Container>
    </section>
  );
}
