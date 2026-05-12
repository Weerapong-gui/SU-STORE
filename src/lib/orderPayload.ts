import { OrderProductSnapshot } from "@/types/order";
import { Product } from "@/types/product";

export function productToSnapshot(product: Product): OrderProductSnapshot {
  return {
    slug: product.slug,
    name: product.name,
    shortName: product.shortName,
    tagline: product.tagline,
    price: product.price,
    image: product.images[0],
    category: product.category
  };
}
