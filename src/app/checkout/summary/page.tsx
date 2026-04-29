import { redirect } from "next/navigation";

type LegacySummaryPageProps = {
  searchParams?: {
    orderId?: string;
  };
};

export default function LegacySummaryPage({ searchParams }: LegacySummaryPageProps) {
  const orderId = searchParams?.orderId;

  if (orderId) {
    redirect(`/checkout/summary/${orderId}`);
  }

  redirect("/checkout");
}
