import { redirect } from "next/navigation";
import { CheckoutPaymentForm } from "@/components/CheckoutPaymentForm";
import { Container } from "@/components/ui/Container";
import { getOrderById } from "@/lib/orderStore";
import { getProducts } from "@/lib/getProducts";

export const dynamic = "force-dynamic";

type CheckoutPaymentPageProps = {
  searchParams?: {
    product?: string;
    orderId?: string;
    size?: string;
    quantity?: string;
    school?: string;
    itemId?: string;
    cart?: string;
  };
};

export default async function CheckoutPaymentPage({ searchParams }: CheckoutPaymentPageProps) {
  const orderId = searchParams?.orderId;
  const existingOrder = orderId ? await getOrderById(orderId) : null;
  const cartMode = searchParams?.cart === "1";

  if (!existingOrder && !searchParams?.product && !cartMode) {
    redirect("/checkout");
  }

  if (existingOrder && existingOrder.status !== "pending_payment") {
    redirect(`/checkout/payment/${existingOrder.id}`);
  }

  // Block if the specific product is unavailable, or if all products are closed (for cart mode)
  if (!existingOrder) {
    const allProducts = await getProducts();
    const requestedSlug = !cartMode ? searchParams?.product : undefined;
    const requestedProduct = requestedSlug
      ? allProducts.find((p) => p.slug === requestedSlug)
      : null;
    const unavailable = requestedProduct
      ? requestedProduct.available === false
      : allProducts.length > 0 && allProducts.every((p) => p.available === false);
    if (unavailable) {
      const productLabel = requestedProduct?.name ?? "สินค้า";
      return (
        <section className="bg-[#ececec] py-6 md:py-8">
          <Container className="max-w-[1440px]">
            <div className="flex min-h-[calc(100svh-8.5rem)] flex-col items-center justify-center gap-3 text-center">
              <p className="text-2xl font-semibold tracking-tight text-zinc-900">ปิดรับสั่งซื้อ</p>
              <p className="text-sm text-zinc-500">{productLabel} ไม่เปิดรับสั่งซื้อในขณะนี้ กรุณากลับมาใหม่ในภายหลัง</p>
            </div>
          </Container>
        </section>
      );
    }
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <CheckoutPaymentForm
          existingOrder={existingOrder}
          defaultProduct={searchParams?.product}
          defaultSize={searchParams?.size}
          defaultQuantity={searchParams?.quantity}
          defaultSchool={searchParams?.school}
          cartItemId={searchParams?.itemId}
          cartMode={cartMode}
        />
      </Container>
    </section>
  );
}
