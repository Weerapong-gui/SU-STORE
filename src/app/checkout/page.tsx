import { CartCheckoutView } from "@/components/CartCheckoutView";
import { Container } from "@/components/ui/Container";

export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-6xl">
        <CartCheckoutView />
      </Container>
    </section>
  );
}
