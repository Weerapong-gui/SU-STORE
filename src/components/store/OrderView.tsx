"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BankAccountCopyField } from "@/components/BankAccountCopyField";
import { formatPrice } from "@/lib/formatPrice";
import { getOrderToken, orderPageHref, saveOrderToken } from "@/lib/orderTokens";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { OrderStatus, PaymentAccount, StoreMeta, StoreOrder } from "@/types/store";

const FLOW: OrderStatus[] = ["pending_payment", "waiting_confirm", "paid", "ready", "completed"];
const MAX_SLIP_BYTES = 5 * 1024 * 1024;

export function OrderView({ code }: { code: string }) {
  const t = useStoreText();
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // undefined while loading; the built-in account is only a fallback if settings can't load
  // undefined = loading, null = couldn't load. Never guess an account number: a stale
  // fallback would send customers' money to an old account.
  const [payment, setPayment] = useState<PaymentAccount | null | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (accessToken: string) => {
    try {
      const res = await fetch(`/api/store/orders/${code}`, { headers: { "X-Order-Token": accessToken }, cache: "no-store" });
      if (!res.ok) {
        setState("notfound");
        return;
      }
      setOrder((await res.json()) as StoreOrder);
      setState("ready");
    } catch {
      setState("notfound");
    }
  }, [code]);

  useEffect(() => {
    const fromUrl = searchParams.get("t");
    const accessToken = fromUrl || getOrderToken(code) || null;
    if (fromUrl) saveOrderToken(code, fromUrl);
    setToken(accessToken);
    if (accessToken) load(accessToken);
    else setState("notfound");
  }, [code, searchParams, load]);

  useEffect(() => {
    fetch("/api/store/meta")
      .then((r) => r.json())
      .then((m: StoreMeta) => setPayment(m.payment ?? null))
      .catch(() => setPayment(null));
  }, []);

  useEffect(() => {
    if (!token) return;
    const refresh = () => document.visibilityState === "visible" && load(token);
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [token, load]);

  async function upload(file: File | undefined) {
    if (!file || !token) return;
    setMessage(null);
    if (file.size > MAX_SLIP_BYTES) {
      setMessage({ tone: "error", text: t.slipHint });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("slip", file);
      const res = await fetch(`/api/store/orders/${code}/slip`, { method: "POST", headers: { "X-Order-Token": token }, body: form });
      const data = (await res.json()) as StoreOrder & { message?: string };
      if (!res.ok) {
        setMessage({ tone: "error", text: data.message ?? t.errorGeneric });
        return;
      }
      setOrder(data);
      setMessage({ tone: "ok", text: t.slipUploaded });
    } catch {
      setMessage({ tone: "error", text: t.errorGeneric });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function copyLink() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(new URL(orderPageHref(code, token), window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the address bar already holds the link
    }
  }

  if (state === "loading") return <p className="py-16 text-center text-ink-soft">…</p>;

  if (state === "notfound" || !order) {
    return (
      <div className="rounded-3xl bg-mist px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">{t.orderNotFound}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{t.orderNotFoundHint}</p>
        <Link href={`/check-order?code=${code}`} className="mt-5 inline-block font-semibold text-apple-blue hover:underline">
          {t.trackTitle} →
        </Link>
      </div>
    );
  }

  const status = t.status[order.status];
  const step = FLOW.indexOf(order.status);
  const canUpload = order.status === "pending_payment" || order.status === "waiting_confirm";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="text-center">
        <p className="text-sm font-semibold tracking-[0.1em] text-ink-tertiary">{t.orderNumber}</p>
        <h1 className="mt-1 font-mono text-4xl font-semibold tracking-tight text-ink">{order.orderCode}</h1>
        <p className={cn("mt-4 inline-block rounded-full px-4 py-1.5 text-sm font-semibold",
          order.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-apple-blue-soft text-apple-blue")}>
          {status.label}
        </p>
        <p className="mt-2 text-sm text-ink-soft">{status.description}</p>
      </header>

      {order.status !== "cancelled" && (
        <ol className="grid grid-cols-5 gap-1">
          {FLOW.map((s, i) => (
            <li key={s} className="text-center">
              <div className={cn("h-1.5 rounded-full", i <= step ? "bg-apple-blue" : "bg-zinc-200")} />
              <p className={cn("mt-2 text-[11px] leading-tight sm:text-xs", i <= step ? "font-semibold text-ink" : "text-ink-tertiary")}>
                {t.status[s].label}
              </p>
            </li>
          ))}
        </ol>
      )}

      {canUpload && (
        <section className="space-y-5 rounded-3xl bg-mist p-6">
          <h2 className="text-xl font-semibold text-ink">{t.howToPay}</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
            <li>{t.payStep1(formatPrice(order.totalAmount))}</li>
            <li>{t.payStep2}</li>
            <li>{t.payStep3}</li>
          </ol>
          <div className="rounded-2xl bg-white p-4">
            {payment ? (
              <>
                <p className="text-sm text-ink-soft">{payment.bankName}</p>
                {payment.accountName && <p className="text-sm font-semibold text-ink">{payment.accountName}</p>}
                <BankAccountCopyField
                  formattedAccountNumber={payment.accountNumber}
                  copyValue={payment.accountNumber.replace(/\D/g, "")}
                />
              </>
            ) : payment === null ? (
              <p className="text-sm font-semibold text-red-600">{t.paymentUnavailable}</p>
            ) : (
              <div className="h-16 animate-pulse rounded-xl bg-zinc-100" />
            )}
            <p className="mt-3 text-2xl font-semibold text-apple-blue">{formatPrice(order.totalAmount)}</p>
          </div>
          <div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="w-full rounded-full bg-apple-blue py-3.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgb(var(--accent)/0.35)] transition hover:bg-apple-blue-dark disabled:opacity-50"
            >
              {uploading ? t.uploading : order.hasSlip ? t.replaceSlip : t.uploadSlip}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              hidden
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <p className="mt-2 text-center text-xs text-ink-tertiary">{t.slipHint}</p>
          </div>
          {message && (
            <p role="status" className={cn("rounded-2xl px-4 py-3 text-sm", message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>
              {message.text}
            </p>
          )}
        </section>
      )}

      <section className="rounded-3xl bg-mist p-6">
        <h2 className="mb-3 text-xl font-semibold text-ink">{t.orderSummary}</h2>
        <ul className="divide-y divide-zinc-200">
          {order.items.map((i) => (
            <li key={i.variantId} className="flex justify-between gap-4 py-3 text-sm">
              <span>
                <span className="font-semibold text-ink">{i.productName}</span>
                {i.variantLabel !== "-" && <span className="text-ink-soft"> · {i.variantLabel}</span>}
                <span className="text-ink-soft"> × {i.quantity}</span>
              </span>
              <span className="font-semibold text-ink">{formatPrice(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-zinc-300 pt-3 text-lg font-semibold text-ink">
          <span>{t.subtotal}</span>
          <span>{formatPrice(order.totalAmount)}</span>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-200 p-6">
        <h2 className="font-semibold text-ink">{t.saveLink}</h2>
        <p className="mt-1 text-sm text-ink-soft">{t.saveLinkHint}</p>
        <button type="button" onClick={copyLink} className="mt-3 rounded-full bg-apple-blue-soft px-5 py-2 text-sm font-semibold text-apple-blue hover:bg-apple-blue/15">
          {copied ? t.copied : t.copyLink}
        </button>
      </section>
    </div>
  );
}
