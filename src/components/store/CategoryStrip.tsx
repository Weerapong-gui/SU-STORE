"use client";

import Link from "next/link";
import { useLocalized } from "@/lib/localized";
import { useStoreText } from "@/lib/storeI18n";
import type { StoreCategory } from "@/types/store";
import { CategoryImage } from "./CategoryTile";

const itemClass = "flex min-h-11 w-[72px] flex-none flex-col items-center gap-2 rounded-2xl text-center text-[13px] font-medium leading-tight text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 md:w-24 md:text-sm";
const thumbClass = "h-16 w-16 rounded-2xl md:h-[88px] md:w-[88px] md:rounded-3xl";

// Scrolls inside its own container so the page never overflows horizontally.
export function CategoryStrip({ categories }: { categories: StoreCategory[] }) {
  const t = useStoreText();
  const pick = useLocalized();

  if (categories.length === 0) return null;
  return (
    <nav aria-label={t.categoriesNav} className="border-b border-black/[0.06]">
      <div className="mx-auto flex w-full max-w-6xl gap-5 overflow-x-auto px-4 pb-6 pt-5 md:gap-8 md:px-8">
        <Link href="/products" aria-current="page" className={itemClass}>
          <span className={`${thumbClass} flex items-center justify-center bg-mist text-xs font-semibold text-ink-soft`}>
            {t.allCategories}
          </span>
          {t.allCategories}
        </Link>
        {categories.map((c) => {
          const name = pick(c.name, c.nameEn);
          return (
            <Link key={c.id} href={`/products/c/${c.slug}`} className={itemClass}>
              <CategoryImage src={c.coverImage} name={name} className={thumbClass} />
              <span className="break-words">{name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
