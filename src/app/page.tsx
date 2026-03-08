import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { products } from "@/data/products";

export default function HomePage() {
  const single = products.find((item) => item.category === "single") ?? products[0];
  const set = products.find((item) => item.category === "set") ?? products[1];

  return (
    <>
      <Hero />
      <ProductShowcase product={single} />
      <ProductShowcase product={set} reversed dark />
    </>
  );
}
