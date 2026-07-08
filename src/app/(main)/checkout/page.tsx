import { CartCheckoutView } from "@/components/CartCheckoutView";
import { Container } from "@/components/ui/Container";
import { getProducts } from "@/lib/getProducts";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const products = await getProducts();
  const unavailableSlugs = products
    .filter((p) => p.available === false)
    .map((p) => p.slug);

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-6xl">
        <CartCheckoutView unavailableSlugs={unavailableSlugs} />
      </Container>
    </section>
  );
}
