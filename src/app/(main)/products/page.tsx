import { Container } from "@/components/ui/Container";
import { CategoryCovers } from "@/components/store/CategoryCovers";
import { CategoryStrip } from "@/components/store/CategoryStrip";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionHeading } from "@/components/store/SectionHeading";
import { getStoreCategories, getStoreProducts } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, categories] = await Promise.all([getStoreProducts(), getStoreCategories()]);
  return (
    <>
      <Container className="pb-2 pt-9 md:pt-14">
        <SectionHeading textKey="shopTitle" className="text-[34px] font-bold leading-tight tracking-tight text-ink md:text-[56px]" />
      </Container>
      <CategoryStrip categories={categories} />
      <Container className="pb-12 md:pb-16">
        <CategoryCovers categories={categories} />
        <section className="pt-10 md:pt-14">
          <SectionHeading textKey="allProducts" level={2} className="mb-4 text-2xl font-bold tracking-tight text-ink md:mb-5 md:text-[32px]" />
          <ProductGrid products={products} />
        </section>
      </Container>
    </>
  );
}
