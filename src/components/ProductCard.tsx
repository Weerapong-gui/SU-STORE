"use client";

import Link from "next/link";
import { SkeletonImage } from "@/components/SkeletonImage";
import { Product } from "@/types/product";
import { createConfiguratorHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type ProductCardProps = {
  product: Product;
};

export function ProductCard({ product }: ProductCardProps) {
  const { t } = useLang();
  const isUnavailable = product.available === false;

  if (isUnavailable) {
    return (
      <article className="overflow-hidden rounded-3xl bg-zinc-100 opacity-60 grayscale">
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200">
          <SkeletonImage
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover object-top"
          />
        </div>
        <div className="space-y-1.5 p-6 pb-7">
          <p className="text-xs font-medium tracking-[0.1em] text-zinc-400">{t.products[product.slug]?.shortName ?? product.shortName}</p>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-500">{product.name}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{product.tagline}</p>
          <p className="pt-2 text-base font-semibold text-zinc-400">{t.product.outOfStock}</p>
        </div>
      </article>
    );
  }

  return (
    <article className={cn("group overflow-hidden rounded-3xl bg-mist transition duration-300 hover:shadow-card")}>
      <Link
        href={createConfiguratorHref(product.slug, "payment")}
        className="block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200">
          <SkeletonImage
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover object-top transition duration-500 group-hover:scale-[1.03]"
          />
        </div>
        <div className="space-y-1.5 p-6 pb-7">
          <p className="text-xs font-medium tracking-[0.1em] text-ink-tertiary">
            {t.products[product.slug]?.shortName ?? product.shortName}
          </p>
          <h3 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h3>
          <p className="text-sm leading-relaxed text-ink-soft">{t.products[product.slug]?.description ?? product.description}</p>
          {product.fabricNote && (
            <p className="text-xs text-ink-soft" translate="no">{product.fabricNote}</p>
          )}
          <p className="pt-2 text-base font-semibold text-apple-blue">
            {formatPrice(product.price)}
          </p>
        </div>
      </Link>
    </article>
  );
}
