import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { ProductDetail } from "@/components/store/ProductDetail";
import { getStoreProduct } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

type PageProps = { params: { slug: string }; searchParams: { design?: string } };

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const product = await getStoreProduct(params.slug);
  if (!product) return { title: "SU STORE" };
  const design = product.variants.find((v) => v.designCode.toLowerCase() === searchParams.design?.toLowerCase());
  return { title: `${design?.designName || product.name} · SU STORE` };
}

export default async function ProductPage({ params, searchParams }: PageProps) {
  const product = await getStoreProduct(params.slug);
  if (!product) notFound();
  // Bottom padding below md clears the fixed buy bar.
  return (
    <Container className="py-10 pb-36 md:py-14">
      <ProductDetail product={product} initialDesign={searchParams.design} />
    </Container>
  );
}
