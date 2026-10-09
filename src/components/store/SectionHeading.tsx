"use client";

import { useStoreText, type StoreText } from "@/lib/storeI18n";

// Client-side heading so server pages can show translated titles.
export function SectionHeading({ textKey, className }: { textKey: keyof StoreText; className?: string }) {
  const t = useStoreText();
  const value = t[textKey];
  return <h1 className={className ?? "text-3xl font-semibold tracking-tight text-ink md:text-4xl"}>{typeof value === "string" ? value : ""}</h1>;
}
