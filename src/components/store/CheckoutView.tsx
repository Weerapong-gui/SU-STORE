"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MAX_ITEM_QUANTITY, useCart } from "@/components/CartProvider";
import { SCHOOL_OPTIONS } from "@/lib/checkoutOptions";
import { formatPrice } from "@/lib/formatPrice";
import { useLang } from "@/lib/i18n";
import { orderPageHref, saveOrderToken } from "@/lib/orderTokens";
import { BUYER_FIELD_LABEL_EN, useStoreText } from "@/lib/storeI18n";
import type { StoreMeta, StoreOrder, StoreProduct, StoreVariant } from "@/types/store";

const BUYER_KEY = "su-store-buyer";
const ALWAYS = ["name", "phone", "email"];

const inputClass =
  "w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";

export function CheckoutView() {
  const t = useStoreText();
  const { lang } = useLang();
  const router = useRouter();
  const { items, hydrated, setQuantity, removeItem, clearCart } = useCart();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [meta, setMeta] = useState<StoreMeta | null>(null);
  const [customer, setCustomer] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function loadCatalog() {
    fetch("/api/store/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { products: StoreProduct[] }) => setProducts(d.products ?? []))
      .catch(() => setProducts([]));
  }

  useEffect(() => {
    loadCatalog();
    fetch("/api/store/meta").then((r) => r.json()).then(setMeta).catch(() => {});
    try {
      setCustomer(JSON.parse(localStorage.getItem(BUYER_KEY) ?? "{}"));
    } catch {
      // ignore
    }
  }, []);

  // Live price/stock for each cart line, from the current catalog.
  const lines = useMemo(() => {
    const byVariant = new Map<number, { product: StoreProduct; variant: StoreVariant }>();
    products?.forEach((p) => p.variants.forEach((v) => byVariant.set(v.id, { product: p, variant: v })));
    return items.map((item) => {
      const live = byVariant.get(item.variantId);
      const unavailable = products !== null && (!live || live.variant.soldOut || live.product.saleState !== "open");
      const stockLeft = live?.variant.stock ?? null;
      return {
        item,
        live,
        unavailable,
        price: live?.variant.price ?? item.unitPrice,
        tooMany: stockLeft !== null && item.quantity > stockLeft,
        stockLeft,
      };
    });
  }, [items, products]);

  const fields = useMemo(() => {
    const extra = new Set<string>();
    lines.forEach((l) => l.live?.product.buyerFields.forEach((f) => extra.add(f)));
    const order = meta?.buyerFields.map((f) => f.key) ?? [...ALWAYS, "studentCode", "school", "lineId", "address", "note"];
    return order.filter((k) => ALWAYS.includes(k) || extra.has(k));
  }, [lines, meta]);

  const total = lines.reduce((sum, l) => sum + l.price * l.item.quantity, 0);
  const blocked = lines.some((l) => l.unavailable || l.tooMany) || products === null;

  const label = (key: string) =>
    lang === "en" ? BUYER_FIELD_LABEL_EN[key] ?? key : meta?.buyerFields.find((f) => f.key === key)?.label ?? key;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (blocked) {
      setError(t.cartChanged);
      return;
    }
    setSubmitting(true);
    const payload = {
      items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      customer: Object.fromEntries(fields.map((k) => [k, (customer[k] ?? "").trim()])),
    };
    try {
      const res = await fetch("/api/store/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as StoreOrder & { message?: string };
      if (!res.ok || !data.accessToken) {
        setError(data.message ?? t.errorGeneric);
        if (res.status === 409) loadCatalog();
        return;
      }
      try {
        const remembered = Object.fromEntries(Object.entries(payload.customer).filter(([k]) => k !== "note"));
        localStorage.setItem(BUYER_KEY, JSON.stringify(remembered));
      } catch {
        // ignore
      }
      saveOrderToken(data.orderCode, data.accessToken);
      clearCart();
      router.push(orderPageHref(data.orderCode, data.accessToken));
    } catch {
      setError(t.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  if (!hydrated) return null;

  if (items.length === 0) {
    return (
      <div className="rounded-3xl bg-mist px-6 py-16 text-center">
        <p className="text-lg font-semibold text-ink">{t.cartEmpty}</p>
        <Link href="/products" className="mt-4 inline-block font-semibold text-apple-blue hover:underline">
          {t.continueShopping} →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <section>
          <h2 className="mb-4 text-xl font-semibold text-ink">{t.cart}</h2>
          <ul className="divide-y divide-zinc-200 rounded-3xl bg-mist px-5">
            {lines.map(({ item, price, unavailable, tooMany, stockLeft }) => (
              <li key={item.variantId} className="flex gap-4 py-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-zinc-200">
                  {item.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${item.productSlug}`} className="font-semibold text-ink hover:underline">
                    {item.productName}
                  </Link>
                  {item.variantLabel && <p className="text-sm text-ink-soft">{item.variantLabel}</p>}
                  {unavailable && <p className="text-sm font-semibold text-red-600">{t.unavailableItem}</p>}
                  {!unavailable && tooMany && stockLeft !== null && (
                    <p className="text-sm font-semibold text-red-600">{t.left(stockLeft)}</p>
                  )}
                  {!unavailable && price !== item.unitPrice && (
                    <p className="text-sm text-amber-700">{t.priceChanged(formatPrice(price))}</p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="inline-flex items-center rounded-full border border-zinc-300 bg-white">
                      <button type="button" className="px-3 py-1" onClick={() => setQuantity(item.variantId, item.quantity - 1)} aria-label="-">−</button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        className="px-3 py-1"
                        onClick={() => setQuantity(item.variantId, Math.min(item.quantity + 1, stockLeft ?? MAX_ITEM_QUANTITY))}
                        aria-label="+"
                      >
                        +
                      </button>
                    </div>
                    <button type="button" className="text-sm text-ink-soft hover:text-red-600" onClick={() => removeItem(item.variantId)}>
                      {t.remove}
                    </button>
                  </div>
                </div>
                <p className="font-semibold text-ink">{formatPrice(price * item.quantity)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold text-ink">{t.yourDetails}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((key) => {
              const required = key !== "note";
              const common = {
                id: `buyer-${key}`,
                required,
                value: customer[key] ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
                  setCustomer((c) => ({ ...c, [key]: e.target.value })),
                className: inputClass,
              };
              const wide = key === "address" || key === "note";
              return (
                <label key={key} htmlFor={common.id} className={wide ? "sm:col-span-2" : undefined}>
                  <span className="mb-1.5 block text-sm font-semibold text-ink">
                    {label(key)} {!required && <span className="font-normal text-ink-tertiary">({t.optional})</span>}
                  </span>
                  {key === "school" ? (
                    <select {...common}>
                      <option value="" />
                      {SCHOOL_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : wide ? (
                    <textarea {...common} rows={3} />
                  ) : (
                    <input
                      {...common}
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      inputMode={key === "phone" || key === "studentCode" ? "numeric" : undefined}
                      autoComplete={{ name: "name", phone: "tel", email: "email" }[key]}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-3xl bg-mist p-6 lg:sticky lg:top-24">
        <div className="flex items-baseline justify-between">
          <span className="text-ink-soft">{t.subtotal}</span>
          <span className="text-2xl font-semibold text-ink">{formatPrice(total)}</span>
        </div>
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={submitting || blocked}
          className="w-full rounded-full bg-apple-blue py-3.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgb(var(--accent)/0.35)] transition hover:bg-apple-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? t.placing : t.placeOrder}
        </button>
        <Link href="/products" className="block text-center text-sm font-semibold text-apple-blue hover:underline">
          {t.continueShopping}
        </Link>
      </aside>
    </form>
  );
}
