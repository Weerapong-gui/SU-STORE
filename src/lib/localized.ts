"use client";

import { useLang, type Lang } from "@/lib/i18n";

export function localized(th: string, en: string | null | undefined, lang: Lang): string {
  return lang === "en" ? en || th : th || en || "";
}

export function useLocalized(): (th: string, en: string | null | undefined) => string {
  const { lang } = useLang();
  return (th, en) => localized(th, en, lang);
}
