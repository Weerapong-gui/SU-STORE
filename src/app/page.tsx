import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { products } from "@/data/products";

export default function HomePage() {
  return (
    <>
      <Hero />
      {products.map((product, index) => (
        <ProductShowcase
          key={product.slug}
          product={product}
          isReversedLayout={index % 2 === 1}
          isDarkTheme={index % 2 === 1}
        />
      ))}
    </>
  );
}
