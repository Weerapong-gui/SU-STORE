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

  // Block if the specific product is unavailable — redirect to configure page which shows the closed UI
  if (!existingOrder) {
    const allProducts = await getProducts();
    const requestedSlug = !cartMode ? searchParams?.product : undefined;
    if (requestedSlug) {
      const requestedProduct = allProducts.find((p) => p.slug === requestedSlug);
      if (requestedProduct && requestedProduct.available === false) {
        redirect(`/products/${requestedSlug}/configure`);
      }
    } else {
      const allClosed = allProducts.length > 0 && allProducts.every((p) => p.available === false);
      if (allClosed) {
        redirect("/products");
      }
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
