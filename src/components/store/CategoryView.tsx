"use client";

import { useState } from "react";
import Link from "next/link";
import { cardMatches, designCards } from "@/lib/designCards";
import { useLocalized } from "@/lib/localized";
import { useStoreText } from "@/lib/storeI18n";
import type { StoreCategory, StoreProduct } from "@/types/store";
import { Container } from "@/components/ui/Container";
import { CategoryImage } from "./CategoryTile";
import { ProductCardGrid } from "./ProductCardGrid";

export function CategoryView({ category, products }: { category: StoreCategory; products: StoreProduct[] }) {
  const t = useStoreText();
  const pick = useLocalized();
  const [query, setQuery] = useState("");

  const cards = designCards(products);
  const searching = query.trim() !== "";
  const shown = searching ? cards.filter((card) => cardMatches(card, query)) : cards;
  const name = pick(category.name, category.nameEn);
  const tagline = pick(category.tagline, category.taglineEn);

  return (
    <Container className="pb-16">
      <Link href="/products" className="inline-flex min-h-11 items-center text-[15px] text-apple-blue">
        ‹ {t.backToShop}
      </Link>
      <section className="grid items-end gap-6 pb-2 pt-2 md:grid-cols-2 md:gap-10 md:pt-6">
        <div>
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink md:text-[56px] md:leading-[1.05]">{name}</h1>
          {tagline && <p className="mt-2 whitespace-pre-line text-[17px] leading-snug text-ink-soft md:mt-3.5 md:text-[21px]">{tagline}</p>}
        </div>
        {category.coverImage && (
          <CategoryImage src={category.coverImage} name={name} className="hidden aspect-[2/1] w-full rounded-3xl md:block" />
        )}
      </section>

      {cards.length === 0 ? (
        <ProductCardGrid cards={[]} />
      ) : (
        <>
      {/* Sticks under the 64px navbar; the margin bleeds the background to the container edges. */}
      <div className="sticky top-16 z-10 -mx-4 mt-6 bg-white/95 px-4 pb-3 pt-4 md:-mx-0 md:mt-10 md:border-t md:border-black/[0.06] md:px-0 md:py-4">
        <div className="md:flex md:items-center md:gap-5">
          <label htmlFor="category-search" className="sr-only">{t.searchLabel}</label>
          <div className="flex h-11 items-center gap-2 rounded-xl bg-mist px-3.5 md:w-[420px] md:max-w-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="flex-none text-ink-soft">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="category-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-soft"
            />
          </div>
          <p aria-live="polite" className="mt-2 px-0.5 text-[13px] text-ink-soft md:mt-0 md:text-sm">
            {searching ? t.designFound(shown.length) : t.designTotal(cards.length)}
          </p>
        </div>
      </div>

      {shown.length > 0 ? (
        <div className="pt-2">
          <ProductCardGrid cards={shown} />
        </div>
      ) : (
        <div className="px-4 py-12 text-center md:py-20">
          <p className="text-[19px] font-bold text-ink md:text-2xl">{t.noResultsTitle(query.trim())}</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft md:text-[17px]">{t.noResultsHint}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-4 min-h-11 rounded-full bg-mist px-5 text-[15px] font-semibold text-apple-blue"
          >
            {t.showAllDesigns}
          </button>
        </div>
      )}
        </>
      )}
    </Container>
  );
}
