import { redirect } from "next/navigation";

type LegacyPaymentPageProps = {
  searchParams?: {
    orderId?: string;
  };
};

export default function LegacyPaymentPage({ searchParams }: LegacyPaymentPageProps) {
  const orderId = searchParams?.orderId;

  if (orderId) {
    redirect(`/checkout/payment/${orderId}`);
  }

  redirect("/checkout");
}
