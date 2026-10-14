"use client";

import { productCard } from "@/lib/designCards";
import type { StoreProduct } from "@/types/store";
import { ProductCardGrid } from "./ProductCardGrid";

// One card per product (a design product is one card). Category pages use ProductCardGrid directly with one card per design.
export function ProductGrid({ products }: { products: StoreProduct[] }) {
  return <ProductCardGrid cards={products.map(productCard)} />;
}
