"use client";

import { useLang, type Lang } from "@/lib/i18n";
import type { StoreOrderItem, StoreVariant } from "@/types/store";

export function localized(th: string, en: string | null | undefined, lang: Lang): string {
  return lang === "en" ? en || th : th || en || "";
}

export function useLocalized(): (th: string, en: string | null | undefined) => string {
  const { lang } = useLang();
  return (th, en) => localized(th, en, lang);
}

// Label shown for a live catalog variant: "CODE design name" for designs, the
// size/colour label for options products (not bilingual), "" when there is none.
export function variantDisplayLabel(variant: StoreVariant, lang: Lang): string {
  if (variant.designCode) return `${variant.designCode} ${localized(variant.designName, variant.designNameEn, lang)}`;
  return variant.label === "-" ? "" : variant.label;
}

function withoutDot(text: string): string {
  return text.replaceAll(" · ", " ");
}

// Name and label of an order line in the chosen language; old orders have no English text.
export function orderItemText(item: StoreOrderItem, lang: Lang): { name: string; label: string } {
  const label = withoutDot(localized(item.variantLabel, item.variantLabelEn, lang));
  return { name: localized(item.productName, item.productNameEn, lang), label: label === "-" ? "" : label };
}
