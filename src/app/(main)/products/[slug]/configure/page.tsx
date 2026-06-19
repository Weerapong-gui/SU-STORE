import { notFound } from "next/navigation";
import { ProductConfigurator } from "@/components/ProductConfigurator";
import { ProductUnavailableState } from "@/components/ProductUnavailableState";
import { Container } from "@/components/ui/Container";
import { getProductBySlug } from "@/data/products";
import { getProducts } from "@/lib/getProducts";
import { normalizeConfigureIntent } from "@/lib/cart";

export const dynamic = "force-dynamic";

type ProductConfigurePageProps = {
  params: {
    slug: string;
  };
  searchParams?: {
    intent?: string;
    itemId?: string;
    size?: string;
    quantity?: string;
    school?: string;
  };
};

export default async function ProductConfigurePage({
  params,
  searchParams
}: ProductConfigurePageProps) {
  const product = getProductBySlug(params.slug);

  if (!product) {
    notFound();
  }

  const apiProducts = await getProducts();
  const apiProduct = apiProducts.find((p) => p.slug === params.slug);
  if (apiProduct && apiProduct.available === false) {
    return (
      <section className="bg-[#ececec] py-6 md:py-8">
        <Container className="max-w-[1440px]">
          <ProductUnavailableState productShortName={product.shortName} productName={product.name} />
        </Container>
      </section>
    );
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-8">
      <Container className="max-w-[1440px]">
        <ProductConfigurator
          product={product}
        intent={normalizeConfigureIntent(searchParams?.intent)}
        editingItemId={searchParams?.itemId}
        defaultSize={searchParams?.size}
        defaultQuantity={searchParams?.quantity}
        defaultSchool={searchParams?.school}
      />
      </Container>
    </section>
  );
}
