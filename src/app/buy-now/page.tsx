import { redirect } from "next/navigation";

type BuyNowPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function BuyNowPage({ searchParams }: BuyNowPageProps) {
  const nextSearchParams = new URLSearchParams();

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (typeof value === "string" && value) {
      nextSearchParams.set(key, value);
    }
  });

  const queryString = nextSearchParams.toString();
  redirect(queryString ? `/checkout/payment?${queryString}` : "/checkout/payment");
}
