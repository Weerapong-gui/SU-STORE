"use client";

import Link from "next/link";
import { useLocalized } from "@/lib/localized";
import { useStoreText } from "@/lib/storeI18n";
import { useLocalePath } from "@/lib/i18n";
import type { StoreCategory } from "@/types/store";
import { Container } from "@/components/ui/Container";

// Full-bleed cover photo when the category has one; otherwise the plain text header.
export function CategoryHero({ category, designCount }: { category: StoreCategory; designCount: number }) {
  const t = useStoreText();
  const localePath = useLocalePath();
  const pick = useLocalized();
  const name = pick(category.name, category.nameEn);
  const tagline = pick(category.tagline, category.taglineEn);
  const backLink = `‹ ${t.backToShop}`;

  if (!category.coverImage) {
    return (
      <Container>
        {/* Mobile gets the back link from the navbar on category pages, so it only shows here from md up. */}
        <Link href={localePath("/products")} className="hidden min-h-11 min-w-11 items-center text-[15px] text-apple-blue md:inline-flex">
          {backLink}
        </Link>
        <section className="pb-2 pt-2 md:pt-6">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-ink md:text-[56px] md:leading-[1.05]">{name}</h1>
          {tagline && <p className="mt-2 whitespace-pre-line text-[17px] leading-snug text-ink-soft md:mt-3.5 md:text-[21px]">{tagline}</p>}
        </section>
      </Container>
    );
  }

  return (
    <section className="relative h-[220px] overflow-hidden text-white md:h-[320px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={category.coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="category-hero-shade absolute inset-0" aria-hidden="true" />
      {/* On mobile the navbar carries the back link (see Navbar), so the hero only shows it from md up. */}
      <Container className="relative flex h-full flex-col justify-end pb-6 pt-3 md:justify-between md:pb-8 md:pt-4">
        <Link href={localePath("/products")} className="hidden min-h-11 min-w-11 items-center self-start text-[15px] text-white md:inline-flex">
          {backLink}
        </Link>
        <div className="max-w-[28rem] md:max-w-xl">
          <h1 className="line-clamp-2 text-[34px] font-bold leading-tight tracking-tight drop-shadow md:text-[56px]">{name}</h1>
          <p className="mt-2 line-clamp-2 whitespace-pre-line text-[15px] leading-snug text-white/85 md:text-[17px]">
            {tagline || t.designTotal(designCount)}
          </p>
        </div>
      </Container>
    </section>
  );
}
