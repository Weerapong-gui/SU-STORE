import { Product } from "@/types/product";
import { products as staticProducts } from "@/data/products";

type ApiProduct = {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  price: number;
  image: string;
  images: string[];
  category: string;
  requiresSize: boolean;
  requiresSchool: boolean;
  available: boolean;
};

function mapApiProduct(p: ApiProduct): Product {
  const image = p.image || p.images?.[0] || "";
  return {
    slug: p.slug,
    name: p.name,
    shortName: p.shortName,
    tagline: p.tagline,
    description: p.description,
    price: p.price,
    images: image ? [image, image] : p.images ?? [],
    category: p.category as Product["category"],
    requiresSize: p.requiresSize,
    requiresSchool: p.requiresSchool,
    available: p.available,
  };
}

export async function getProducts(): Promise<Product[]> {
  const baseUrl = process.env.ORDER_API_BASE_URL;
  if (!baseUrl) return staticProducts;

  try {
    const res = await fetch(`${baseUrl}/products`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return staticProducts;
    const data: ApiProduct[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return staticProducts;
    return data.map(mapApiProduct);
  } catch {
    return staticProducts;
  }
}

export async function getAvailableProducts(): Promise<Product[]> {
  const all = await getProducts();
  return all.filter((p) => p.available !== false);
}
