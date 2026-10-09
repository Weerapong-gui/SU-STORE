import { Container } from "@/components/ui/Container";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionHeading } from "@/components/store/SectionHeading";
import { getStoreProducts } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await getStoreProducts();
  return (
    <Container className="py-12 md:py-16">
      <SectionHeading textKey="allProducts" className="mb-8 text-3xl font-semibold tracking-tight text-ink md:text-4xl" />
      <ProductGrid products={products} />
    </Container>
  );
}
