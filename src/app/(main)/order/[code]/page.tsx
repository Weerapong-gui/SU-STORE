import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { OrderView } from "@/components/store/OrderView";

export const metadata: Metadata = { title: "Order · SU STORE", robots: { index: false } };

export default function OrderPage({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!/^SU\d{4}-\d{4,}$/.test(code)) notFound();
  return (
    <Container className="py-10 md:py-14">
      <Suspense>
        <OrderView code={code} />
      </Suspense>
    </Container>
  );
}
