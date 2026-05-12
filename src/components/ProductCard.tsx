import Image from "next/image";
import Link from "next/link";
import { Product } from "@/types/product";
import { createConfiguratorHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";
import { cn } from "@/lib/utils";

type ProductCardProps = {
  product: Product;
};

export function ProductCard({ product }: ProductCardProps) {
  const isUnavailable = product.available === false;

  if (isUnavailable) {
    return (
      <article className="overflow-hidden rounded-3xl bg-zinc-100 opacity-60 grayscale">
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-200">
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
        <div className="space-y-1.5 p-6 pb-7">
          <p className="text-xs font-medium tracking-[0.1em] text-zinc-400">{product.shortName}</p>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-500">{product.name}</h3>
          <p className="text-sm leading-relaxed text-zinc-400">{product.tagline}</p>
          <p className="pt-2 text-base font-semibold text-zinc-400">หมดแล้ว / ไม่พร้อมจำหน่าย</p>
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
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        </div>
        <div className="space-y-1.5 p-6 pb-7">
          <p className="text-xs font-medium tracking-[0.1em] text-ink-tertiary">
            {product.shortName}
          </p>
          <h3 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h3>
          <p className="text-sm leading-relaxed text-ink-soft">{product.tagline}</p>
          <p className="pt-2 text-base font-semibold text-apple-blue">
            {formatPrice(product.price)}
          </p>
        </div>
      </Link>
    </article>
  );
}
