"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { orderPageHref, saveOrderToken } from "@/lib/orderTokens";
import { useStoreText } from "@/lib/storeI18n";
import type { StoreOrder } from "@/types/store";

const inputClass =
  "w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";

export function TrackOrder() {
  const t = useStoreText();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orderCode, setOrderCode] = useState(searchParams.get("code") ?? "");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/store/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode: orderCode.trim().toUpperCase(), phone }),
      });
      const data = (await res.json()) as StoreOrder & { message?: string };
      if (!res.ok || !data.accessToken) {
        setError(data.message ?? t.orderNotFound);
        return;
      }
      saveOrderToken(data.orderCode, data.accessToken);
      router.push(orderPageHref(data.orderCode, data.accessToken));
    } catch {
      setError(t.errorGeneric);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">{t.trackTitle}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t.trackSubtitle}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink">{t.orderNumber}</span>
          <input
            className={`${inputClass} font-mono uppercase`}
            value={orderCode}
            onChange={(e) => setOrderCode(e.target.value)}
            placeholder="SU2610-0001"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-ink">{t.phone}</span>
          <input className={inputClass} type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </label>
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-apple-blue py-3.5 text-sm font-semibold text-white transition hover:bg-apple-blue-dark disabled:opacity-50"
        >
          {loading ? t.finding : t.find}
        </button>
      </form>
      <p className="mt-10 border-t border-zinc-200 pt-6 text-sm text-ink-soft">
        {t.fp28Link}{" "}
        <Link href="/check-order/fp28" className="font-semibold text-apple-blue hover:underline">
          {t.fp28Cta} →
        </Link>
      </p>
    </div>
  );
}
