import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BuyButton } from "@/components/BuyButton";
import { Container } from "@/components/ui/Container";
import { getProductBySlug, products } from "@/data/products";
import { formatPrice } from "@/lib/formatPrice";

type Params = {
  params: {
    slug: string;
  };
};

export function generateStaticParams() {
  return products.map((product) => ({ slug: product.slug }));
}

export function generateMetadata({ params }: Params): Metadata {
  const product = getProductBySlug(params.slug);

  if (!product) {
    return {
      title: "Product Not Found"
    };
  }

  return {
    title: `${product.name} | SU STORE`,
    description: product.description
  };
}

export default function ProductDetailPage({ params }: Params) {
  const product = getProductBySlug(params.slug);

  if (!product) {
    notFound();
  }

  return (
    <section className="bg-white py-20 md:py-24">
      <Container>
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div className="space-y-4">
            {product.images.map((image, index) => (
              <div
                key={image}
                className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-50 p-3 shadow-soft"
              >
                <Image
                  src={image}
                  alt={`${product.name} view ${index + 1}`}
                  width={1400}
                  height={980}
                  className="h-auto w-full rounded-2xl"
                  priority={index === 0}
                />
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs tracking-[0.14em] text-zinc-500">{product.shortName}</p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight text-ink md:text-6xl">
              {product.name}
            </h1>
            <p className="mt-6 text-xl text-zinc-600 md:text-2xl">{product.tagline}</p>
            <p className="mt-5 text-zinc-600">{product.description}</p>

            <ul className="mt-8 space-y-3">
              {product.features.map((feature) => (
                <li key={feature} className="text-zinc-700">
                  • {feature}
                </li>
              ))}
            </ul>

            <p className="mt-10 text-3xl font-semibold text-ink">{formatPrice(product.price)}</p>
            <div className="mt-8">
              <BuyButton href={`/checkout?product=${product.slug}`}>Proceed to Checkout</BuyButton>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
