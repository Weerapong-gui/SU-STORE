"use client";

import { useLang } from "@/lib/i18n";

export function BankName() {
  const { t } = useLang();
  return <>{t.payment.bankName}</>;
}
