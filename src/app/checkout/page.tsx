import { CheckoutForm } from "@/components/CheckoutForm";
import { Container } from "@/components/ui/Container";

type CheckoutPageProps = {
  searchParams?: {
    product?: string;
    size?: string;
    quantity?: string;
    firstName?: string;
    lastName?: string;
    nickname?: string;
    email?: string;
    phone?: string;
    school?: string;
  };
};

export default function CheckoutPage({ searchParams }: CheckoutPageProps) {
  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutForm
          defaultProduct={searchParams?.product}
          defaultSize={searchParams?.size}
          defaultQuantity={searchParams?.quantity}
          defaultFirstName={searchParams?.firstName}
          defaultLastName={searchParams?.lastName}
          defaultNickname={searchParams?.nickname}
          defaultEmail={searchParams?.email}
          defaultPhone={searchParams?.phone}
          defaultSchool={searchParams?.school}
        />
      </Container>
    </section>
  );
}
