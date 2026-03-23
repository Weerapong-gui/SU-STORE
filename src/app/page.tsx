import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { products } from "@/data/products";

export default function HomePage() {
  const singleProduct = products.find((product) => product.category === "single") ?? products[0];
  const bundleProduct = products.find((product) => product.category === "bundle") ?? products[1];

  return (
    <>
      <Hero />
      <ProductShowcase product={singleProduct} />
      <ProductShowcase product={bundleProduct} isReversedLayout isDarkTheme />
    </>
  );
}
