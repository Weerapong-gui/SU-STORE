"use client";

import Link from "next/link";
import type { ProductCard } from "@/lib/designCards";
import { formatPrice } from "@/lib/formatPrice";
import { useLocalized } from "@/lib/localized";
import { useSaleDate, useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import { useLocalePath } from "@/lib/i18n";

function CardBadge({ card }: { card: ProductCard }) {
  const t = useStoreText();
  const saleDate = useSaleDate();
  if (!card.soldOut && card.saleState === "open") return null;
  const label =
    card.saleState === "upcoming" && card.saleStartsAt
      ? t.opensAt(saleDate(card.saleStartsAt))
      : card.saleState === "ended"
        ? t.salesEnded
        : t.soldOut;
  return (
    <span className="absolute left-3 top-3 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{label}</span>
  );
}

export function ProductCardGrid({ cards }: { cards: ProductCard[] }) {
  const t = useStoreText();
  const localePath = useLocalePath();
  const pick = useLocalized();

  if (cards.length === 0) {
    return (
      <div className="rounded-3xl bg-mist px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">{t.noProducts}</p>
        <p className="mt-1 text-sm text-ink-soft">{t.noProductsHint}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-5 md:gap-y-8 lg:grid-cols-4">
      {cards.map((card) => {
        const name = pick(card.name, card.nameEn);
        // Desktop shows the other-language name under the main one, like the approved design.
        const otherName = pick(card.nameEn, card.name);
        return (
          <Link
            key={card.key}
            href={localePath(card.href)}
            className={cn(
              "group block min-w-0 rounded-2xl text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20",
              (card.soldOut || card.saleState === "ended") && "opacity-60"
            )}
          >
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-mist">
              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.image}
                  alt={name}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-2xl font-bold tracking-wide text-ink-soft">
                  {card.code || "SU"}
                </div>
              )}
              <CardBadge card={card} />
            </div>
            {card.code && <p className="mt-2.5 text-xs font-bold tracking-wide text-ink-soft">{card.code}</p>}
            <h3 className={cn("text-[15px] font-semibold leading-snug md:text-[17px]", card.code ? "mt-0.5" : "mt-2.5")}>{name}</h3>
            {card.code && otherName && otherName !== name && (
              <p className="mt-0.5 hidden text-[15px] text-ink-soft md:block">{otherName}</p>
            )}
            {card.price !== null && (
              <p className="mt-1 text-[15px] text-ink">
                {card.priceFrom && <span className="mr-1 text-sm text-ink-soft">{t.from}</span>}
                {formatPrice(card.price)}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
