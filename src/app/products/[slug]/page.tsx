import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getProductBySlug, products } from "@/data/products";
import { createConfiguratorHref } from "@/lib/cart";

type ProductDetailPageProps = {
  params: {
    slug: string;
  };
};

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export function generateMetadata({ params }: ProductDetailPageProps): Metadata {
  const selectedProduct = getProductBySlug(params.slug);

  if (!selectedProduct) {
    return {
      title: "Product Not Found"
    };
  }

  return {
    title: `${selectedProduct.name} | SU STORE`,
    description: selectedProduct.description
  };
}

export default function ProductDetailPage({ params }: ProductDetailPageProps) {
  redirect(createConfiguratorHref(params.slug, "payment"));
}
