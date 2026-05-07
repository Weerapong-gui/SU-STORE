import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { getProductBySlug, products } from "@/data/products";
import { createConfiguratorHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";

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
  const selectedProduct = getProductBySlug(params.slug);

  if (!selectedProduct) {
    notFound();
  }

  return (
    <section className="bg-white py-20 md:py-24">
      <Container>
        <div className="grid gap-10 md:grid-cols-2 md:items-start">
          <div className="space-y-4">
            {selectedProduct.images.map((image, index) => (
              <div
                key={image}
                className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-50 p-3 shadow-soft"
              >
                <Image
                  src={image}
                  alt={`${selectedProduct.name} view ${index + 1}`}
                  width={1400}
                  height={980}
                  className="h-auto w-full rounded-2xl"
                  priority={index === 0}
                />
              </div>
            ))}
          </div>

          <div className="self-start lg:sticky lg:top-24">
            <p className="text-xs tracking-[0.14em] text-zinc-500">{selectedProduct.shortName}</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink md:text-6xl">
              {selectedProduct.name}
            </h1>
            <p className="mt-6 text-xl text-zinc-600 md:text-2xl">{selectedProduct.tagline}</p>
            <p className="mt-5 text-zinc-600">{selectedProduct.description}</p>

            <p className="mt-10 text-3xl font-semibold text-apple-blue">
              {formatPrice(selectedProduct.price)}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <BuyButton href={createConfiguratorHref(selectedProduct.slug, "payment")}>
                Buy Now
              </BuyButton>
              <BuyButton href={createConfiguratorHref(selectedProduct.slug, "cart")} variant="secondary">
                Add to Cart
              </BuyButton>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
