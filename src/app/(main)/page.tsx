import { Hero } from "@/components/Hero";
import { Container } from "@/components/ui/Container";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionHeading } from "@/components/store/SectionHeading";
import { getStoreProducts } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const products = await getStoreProducts();
  return (
    <>
      <Hero />
      <Container className="py-14 md:py-20">
        <SectionHeading textKey="allProducts" className="mb-8 text-2xl font-semibold tracking-tight text-ink md:text-3xl" />
        <ProductGrid products={products} />
      </Container>
    </>
  );
}
