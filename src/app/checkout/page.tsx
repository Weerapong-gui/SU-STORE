import { CheckoutForm } from "@/components/CheckoutForm";
import { Container } from "@/components/ui/Container";
import { getOrderById } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

type CheckoutPageProps = {
  searchParams?: {
    product?: string;
    orderId?: string;
  };
};

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const orderId = searchParams?.orderId;
  const existingOrder = orderId ? await getOrderById(orderId) : null;

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutForm
          existingOrderId={existingOrder?.id}
          defaultProduct={searchParams?.product ?? existingOrder?.product.slug}
          defaultSize={existingOrder?.size}
          defaultQuantity={existingOrder ? String(existingOrder.quantity) : undefined}
          defaultFirstName={existingOrder?.customer.firstName}
          defaultLastName={existingOrder?.customer.lastName}
          defaultNickname={existingOrder?.customer.nickname}
          defaultEmail={existingOrder?.customer.email}
          defaultPhone={existingOrder?.customer.phone}
          defaultSchool={existingOrder?.customer.school}
        />
      </Container>
    </section>
  );
}
