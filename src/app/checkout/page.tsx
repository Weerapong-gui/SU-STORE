import { CheckoutForm } from "@/components/CheckoutForm";
import { Container } from "@/components/ui/Container";
import { SectionTitle } from "@/components/ui/SectionTitle";

type CheckoutPageProps = {
  searchParams?: {
    product?: string;
  };
};

export default function CheckoutPage({ searchParams }: CheckoutPageProps) {
  return (
    <section className="bg-mist py-20 md:py-24">
      <Container className="max-w-3xl">
        <SectionTitle
          align="center"
          title="Checkout"
          subtitle="กรอกข้อมูลสั่งซื้อ แล้วเราจะติดต่อกลับเพื่อยืนยันออเดอร์"
        />

        <div className="mt-12">
          <CheckoutForm defaultProduct={searchParams?.product} />
        </div>
      </Container>
    </section>
  );
}
