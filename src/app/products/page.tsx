import { ProductCard } from "@/components/ProductCard";
import { Container } from "@/components/ui/Container";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { products } from "@/data/products";

export default function ProductsPage() {
  return (
    <section className="bg-mist py-20 md:py-24">
      <Container>
        <SectionTitle
          title="Products"
          subtitle="Two focused choices. One premium standard."
          align="center"
        />

        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </Container>
    </section>
  );
}
