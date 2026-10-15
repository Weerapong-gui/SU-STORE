import { redirect } from "next/navigation";
import { Suspense } from "react";
import { localePath } from "@/lib/locale";
import { requestLang } from "@/lib/requestLocale";
import { Container } from "@/components/ui/Container";
import { TrackOrder } from "@/components/store/TrackOrder";

export default function CheckOrderPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // Old FP28 links searched by student ID; send them to the legacy lookup.
  if (searchParams.studentCode || searchParams.orderId) {
    redirect(localePath(requestLang(), `/check-order/fp28?${new URLSearchParams(searchParams as Record<string, string>)}`));
  }
  return (
    <Container className="py-12 md:py-16">
      <Suspense>
        <TrackOrder />
      </Suspense>
    </Container>
  );
}
