import { CheckoutForm } from "@/components/CheckoutForm";
import { Container } from "@/components/ui/Container";
import { getOrderById } from "@/lib/orderStore";

export const dynamic = "force-dynamic";

type BuyNowPageProps = {
  searchParams?: {
    product?: string;
    orderId?: string;
    size?: string;
    quantity?: string;
    school?: string;
  };
};

export default async function BuyNowPage({ searchParams }: BuyNowPageProps) {
  const orderId = searchParams?.orderId;
  const existingOrder = orderId ? await getOrderById(orderId) : null;

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutForm
          existingOrderId={existingOrder?.id}
          defaultProduct={searchParams?.product ?? existingOrder?.product.slug}
          defaultSize={searchParams?.size ?? existingOrder?.size}
          defaultQuantity={searchParams?.quantity ?? (existingOrder ? String(existingOrder.quantity) : undefined)}
          defaultFirstName={existingOrder?.customer.firstName}
          defaultLastName={existingOrder?.customer.lastName}
          defaultNickname={existingOrder?.customer.nickname}
          defaultEmail={existingOrder?.customer.email}
          defaultPhone={existingOrder?.customer.phone}
          defaultSchool={searchParams?.school ?? existingOrder?.customer.school}
        />
      </Container>
    </section>
  );
}
