import Image from "next/image";
import Link from "next/link";
import { Product } from "@/types/product";
import { createConfiguratorHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";

type ProductCardProps = {
  product: Product;
};

export function ProductCard({ product }: ProductCardProps) {
  const cardClasses =
    "overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-soft transition hover:-translate-y-1 hover:border-apple-blue/30";
  const productLinkClasses =
    "group block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";

  return (
    <article className={cardClasses}>
      <Link href={createConfiguratorHref(product.slug, "payment")} className={productLinkClasses}>
        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100">
          <Image
            src={product.images[0]}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        </div>
        <div className="space-y-2 p-6">
          <p className="text-xs tracking-[0.12em] text-zinc-500">{product.shortName}</p>
          <h3 className="text-3xl font-semibold tracking-tight text-ink">{product.name}</h3>
          <p className="text-zinc-600">{product.tagline}</p>
          <p className="pt-2 text-lg font-semibold text-apple-blue">{formatPrice(product.price)}</p>
        </div>
      </Link>
    </article>
  );
}
