"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MAX_ITEM_QUANTITY, useCart } from "@/components/CartProvider";
import { formatPrice } from "@/lib/formatPrice";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { StoreProduct, StoreVariant } from "@/types/store";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function OptionButtons({ label, options, selected, isAvailable, onSelect }: {
  label: string;
  options: string[];
  selected: string;
  isAvailable: (option: string) => boolean;
  onSelect: (option: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const available = isAvailable(option);
          return (
            <button
              key={option}
              type="button"
              disabled={!available}
              onClick={() => onSelect(option)}
              aria-pressed={selected === option}
              className={cn(
                "min-w-12 rounded-full border px-4 py-2 text-sm font-medium transition",
                selected === option
                  ? "border-apple-blue bg-apple-blue-soft text-apple-blue"
                  : "border-zinc-300 text-ink hover:border-ink",
                !available && "cursor-not-allowed border-zinc-200 text-zinc-300 line-through hover:border-zinc-200"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ProductDetail({ product }: { product: StoreProduct }) {
  const t = useStoreText();
  const router = useRouter();
  const { addItem } = useCart();
  const variants = product.variants;
  const sizes = unique(variants.map((v) => v.size));
  const colors = unique(variants.map((v) => v.color));

  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [notice, setNotice] = useState("");

  const variant: StoreVariant | undefined = useMemo(
    () =>
      variants.find(
        (v) => (sizes.length === 0 || v.size === size) && (colors.length === 0 || v.color === color)
      ),
    [variants, sizes.length, colors.length, size, color]
  );
  const inStock = (v: StoreVariant) => !v.soldOut;
  const maxQty = Math.min(MAX_ITEM_QUANTITY, variant?.stock ?? MAX_ITEM_QUANTITY);

  function add(goToCheckout: boolean) {
    if (!variant || variant.soldOut) {
      setNotice(t.chooseOption);
      return;
    }
    addItem({
      variantId: variant.id,
      productSlug: product.slug,
      productName: product.name,
      variantLabel: variant.label === "-" ? "" : variant.label,
      unitPrice: variant.price,
      image: product.images[0] ?? "",
      quantity: Math.min(quantity, maxQty),
    });
    if (goToCheckout) router.push("/checkout");
    else setNotice(t.added);
  }

  const price = variant?.price ?? product.minPrice;

  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div>
        <div className="aspect-square overflow-hidden rounded-3xl bg-mist">
          {product.images[imageIndex] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.images[imageIndex]} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-6xl font-bold text-zinc-300">SU</div>
          )}
        </div>
        {product.images.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {product.images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setImageIndex(i)}
                className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2", i === imageIndex ? "border-apple-blue" : "border-transparent")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">{product.name}</h1>
          {price !== null && price !== undefined && (
            <p className="mt-2 text-2xl font-semibold text-apple-blue">
              {!variant && product.minPrice !== product.maxPrice && <span className="mr-1 text-base font-normal text-ink-soft">{t.from}</span>}
              {formatPrice(price)}
            </p>
          )}
        </div>

        <OptionButtons
          label={t.size}
          options={sizes}
          selected={size}
          onSelect={(s) => { setSize(s); setNotice(""); }}
          isAvailable={(s) => variants.some((v) => v.size === s && (!color || v.color === color) && inStock(v))}
        />
        <OptionButtons
          label={t.color}
          options={colors}
          selected={color}
          onSelect={(c) => { setColor(c); setNotice(""); }}
          isAvailable={(c) => variants.some((v) => v.color === c && (!size || v.size === size) && inStock(v))}
        />

        {variant && (
          <p className={cn("text-sm", variant.soldOut ? "font-semibold text-red-600" : "text-ink-soft")}>
            {variant.soldOut ? t.soldOut : variant.stock !== null ? t.left(variant.stock) : null}
          </p>
        )}

        <div>
          <p className="text-sm font-semibold text-ink">{t.quantity}</p>
          <div className="mt-2 inline-flex items-center rounded-full border border-zinc-300">
            <button type="button" className="px-4 py-2 text-lg" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="-">−</button>
            <span className="w-10 text-center font-semibold">{quantity}</span>
            <button type="button" className="px-4 py-2 text-lg" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} aria-label="+">+</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => add(true)}
            disabled={variant?.soldOut || product.soldOut}
            className="rounded-full bg-apple-blue px-7 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(0,113,227,0.35)] transition hover:bg-apple-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.buyNow}
          </button>
          <button
            type="button"
            onClick={() => add(false)}
            disabled={variant?.soldOut || product.soldOut}
            className="rounded-full bg-apple-blue-soft px-7 py-3 text-sm font-semibold text-apple-blue transition hover:bg-[#dcecff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.addToCart}
          </button>
        </div>
        {notice && <p className="text-sm font-medium text-apple-blue" role="status">{notice}</p>}

        {product.description && (
          <div className="whitespace-pre-line border-t border-zinc-200 pt-6 text-sm leading-relaxed text-ink-soft">
            {product.description}
          </div>
        )}
      </div>
    </div>
  );
}
