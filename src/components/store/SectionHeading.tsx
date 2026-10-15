"use client";

import { useStoreText, type StoreText } from "@/lib/storeI18n";

// Client-side heading so server pages can show translated titles.
export function SectionHeading({ textKey, className, level = 1 }: { textKey: keyof StoreText; className?: string; level?: 1 | 2 }) {
  const t = useStoreText();
  const value = t[textKey];
  const Tag = level === 1 ? "h1" : "h2";
  return <Tag className={className ?? "text-3xl font-semibold tracking-tight text-ink md:text-4xl"}>{typeof value === "string" ? value : ""}</Tag>;
}
