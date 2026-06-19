"use client";

import { useLang } from "@/lib/i18n";

const INFO_CARD_CLASSES = "rounded-3xl border border-zinc-300 bg-white p-5";

export function StoreClosedPaymentMessage() {
  const { t } = useLang();
  return (
    <div className={INFO_CARD_CLASSES}>
      <p className="text-sm font-semibold text-zinc-900">{t.paymentPage.storeClosed}</p>
      <p className="mt-1 text-sm text-zinc-500">{t.paymentPage.storeClosedMessage}</p>
    </div>
  );
}
