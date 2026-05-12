import { ProductCard } from "@/components/ProductCard";
import { Container } from "@/components/ui/Container";
import { getProducts } from "@/lib/getProducts";

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <section className="bg-mist py-20 md:py-28">
      <Container>
        <div className="mb-14 text-center">
          <p className="text-xs font-semibold tracking-[0.16em] text-ink-tertiary">
            FRESHER PACKAGE 28TH
          </p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight text-ink md:text-6xl">
            Products
          </h1>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </Container>
    </section>
  );
}
