import { redirect } from "next/navigation";

type CheckoutSummaryPageProps = {
  params: {
    orderId: string;
  };
};

export default function CheckoutSummaryPage({ params }: CheckoutSummaryPageProps) {
  redirect(`/checkout/payment/${params.orderId}`);
}
