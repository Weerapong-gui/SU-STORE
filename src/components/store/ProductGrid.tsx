"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/formatPrice";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { StoreProduct } from "@/types/store";

export function ProductGrid({ products }: { products: StoreProduct[] }) {
  const t = useStoreText();

  if (products.length === 0) {
    return (
      <div className="rounded-3xl bg-mist px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">{t.noProducts}</p>
        <p className="mt-1 text-sm text-ink-soft">{t.noProductsHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <Link
          key={p.id}
          href={`/products/${p.slug}`}
          className={cn(
            "group overflow-hidden rounded-3xl bg-mist transition duration-300 hover:shadow-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20",
            p.soldOut && "opacity-60"
          )}
        >
          <div className="relative aspect-square overflow-hidden bg-zinc-200">
            {p.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.images[0]}
                alt={p.name}
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-4xl font-bold text-zinc-300">SU</div>
            )}
            {p.soldOut && (
              <span className="absolute left-4 top-4 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">
                {t.soldOut}
              </span>
            )}
          </div>
          <div className="space-y-1 p-5 pb-6">
            <h3 className="text-lg font-semibold tracking-tight text-ink">{p.name}</h3>
            {p.minPrice !== null && (
              <p className="text-base font-semibold text-apple-blue">
                {p.minPrice !== p.maxPrice && <span className="mr-1 text-sm font-normal text-ink-soft">{t.from}</span>}
                {formatPrice(p.minPrice)}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
