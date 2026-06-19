"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";

export function ProductsEmptyState() {
  const { t } = useLang();
  return (
    <div className="mx-auto max-w-md py-8 text-center">
      <p className="text-2xl font-bold text-ink">{t.productsPage.closed}</p>
      <p className="mt-3 text-sm text-ink-secondary">
        {t.productsPage.closedThankYou}
        <br />
        {t.productsPage.closedHint}
      </p>
      <Link
        href="/check-order"
        className="mt-5 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-white hover:opacity-80"
      >
        {t.productsPage.checkOrderLink}
      </Link>
    </div>
  );
}
