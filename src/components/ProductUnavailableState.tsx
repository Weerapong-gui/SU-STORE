"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

type Props = {
  productShortName: string;
  productName: string;
};

export function ProductUnavailableState({ productShortName, productName }: Props) {
  const { t } = useLang();
  return (
    <div className="flex min-h-[calc(100svh-8.5rem)] flex-col items-center justify-center gap-5 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">{productShortName}</p>
      <h1 className="text-4xl font-bold tracking-tight text-zinc-900 md:text-5xl">{productName}</h1>
      <span className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white">
        {t.configurePage.productClosed}
      </span>
      <p className="max-w-xs text-sm text-zinc-500">{t.configurePage.productClosedMessage}</p>
      <Link href="/products" className="mt-2 text-sm font-semibold text-apple-blue hover:underline">
        {t.configurePage.viewOtherProducts}
      </Link>
    </div>
  );
}
