import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { ProductDetail } from "@/components/store/ProductDetail";
import { getStoreProduct } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const product = await getStoreProduct(params.slug);
  return { title: product ? `${product.name} · SU STORE` : "SU STORE" };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const product = await getStoreProduct(params.slug);
  if (!product) notFound();
  return (
    <Container className="py-10 md:py-14">
      <ProductDetail product={product} />
    </Container>
  );
}
