import { Container } from "@/components/ui/Container";
import { CheckoutView } from "@/components/store/CheckoutView";

export default function CheckoutPage() {
  return (
    <Container className="py-10 md:py-14">
      <CheckoutView />
    </Container>
  );
}
