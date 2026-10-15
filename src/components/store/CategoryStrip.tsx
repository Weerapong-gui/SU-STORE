"use client";

import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { useLocalized } from "@/lib/localized";
import { useStoreText } from "@/lib/storeI18n";
import type { StoreCategory } from "@/types/store";
import { useLocalePath } from "@/lib/i18n";

const itemClass = "flex min-h-11 w-[72px] flex-none flex-col items-center gap-2 rounded-2xl text-center text-[13px] font-medium leading-tight text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 md:w-24 md:text-sm";
const thumbClass = "h-16 w-16 rounded-2xl md:h-[88px] md:w-[88px] md:rounded-3xl";

// Scrolls inside its own container so the page never overflows horizontally.
export function CategoryStrip({ categories }: { categories: StoreCategory[] }) {
  const t = useStoreText();
  const localePath = useLocalePath();
  const pick = useLocalized();

  if (categories.length === 0) return null;
  return (
    <nav aria-label={t.categoriesNav} className="border-b border-black/[0.06]">
      <Container>
      <div className="flex gap-5 overflow-x-auto pb-6 pt-5 md:gap-8">
        <Link href={localePath("/products")} aria-current="page" className={itemClass}>
          <span aria-hidden="true" className={`${thumbClass} bg-mist`} />
          {t.allCategories}
        </Link>
        {categories.map((c) => {
          const name = pick(c.name, c.nameEn);
          return (
            <Link key={c.id} href={localePath(`/products/c/${c.slug}`)} className={itemClass}>
              {c.coverImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.coverImage} alt="" loading="lazy" className={`${thumbClass} object-cover`} />
              ) : (
                <span aria-hidden="true" className={`${thumbClass} bg-mist`} />
              )}
              <span className="break-words">{name}</span>
            </Link>
          );
        })}
      </div>
      </Container>
    </nav>
  );
}
