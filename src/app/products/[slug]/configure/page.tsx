import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/ProductConfigurator";
import { Container } from "@/components/ui/Container";
import { getProductBySlug } from "@/data/products";
import { normalizeConfigureIntent } from "@/lib/cart";

export const dynamic = "force-dynamic";

type ProductConfigurePageProps = {
  params: {
    slug: string;
  };
  searchParams?: {
    intent?: string;
  };
};

export default function ProductConfigurePage({
  params,
  searchParams
}: ProductConfigurePageProps) {
  const product = getProductBySlug(params.slug);

  if (!product) {
    notFound();
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <ProductConfigurator
          product={product}
          intent={normalizeConfigureIntent(searchParams?.intent)}
        />
      </Container>
    </section>
  );
}
