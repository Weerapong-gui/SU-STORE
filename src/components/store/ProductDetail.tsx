"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { MAX_ITEM_QUANTITY, useCart } from "@/components/CartProvider";
import { BuyBar } from "@/components/store/BuyBar";
import { DesignPicker } from "@/components/store/DesignPicker";
import { OptionButtons } from "@/components/store/OptionButtons";
import { ProductGallery } from "@/components/store/ProductGallery";
import { useStorePreview } from "@/components/store/StorePreview";
import { formatPrice } from "@/lib/formatPrice";
import { useLocalized, variantDisplayLabel } from "@/lib/localized";
import { useSaleDate, useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { StoreProduct, StoreVariant } from "@/types/store";
import { useLocalePath } from "@/lib/i18n";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function firstDesign(designs: StoreVariant[], code: string | undefined): StoreVariant | undefined {
  const wanted = code?.toLowerCase();
  return designs.find((d) => d.designCode.toLowerCase() === wanted) ?? designs.find((d) => !d.soldOut) ?? designs[0];
}

export function ProductDetail({ product, initialDesign }: { product: StoreProduct; initialDesign?: string }) {
  const t = useStoreText();
  const localePath = useLocalePath();
  const localized = useLocalized();
  const saleDate = useSaleDate();
  const router = useRouter();
  const { addItem } = useCart();
  const preview = useStorePreview();
  const variants = product.variants;
  const isDesigns = product.optionKind === "designs";
  const sizes = unique(variants.map((v) => v.size));
  const colors = unique(variants.map((v) => v.color));

  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const [designId, setDesignId] = useState(() => (isDesigns ? firstDesign(variants, initialDesign)?.id : undefined));
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");

  const variant: StoreVariant | undefined = useMemo(
    () =>
      isDesigns
        ? variants.find((v) => v.id === designId)
        : variants.find((v) => (sizes.length === 0 || v.size === size) && (colors.length === 0 || v.color === color)),
    [isDesigns, variants, designId, sizes.length, colors.length, size, color]
  );
  const maxQty = Math.min(MAX_ITEM_QUANTITY, variant?.stock ?? MAX_ITEM_QUANTITY);
  const canOrder = product.saleState === "open" && !preview;
  const productName = localized(product.name, product.nameEn);
  const designName = variant && isDesigns ? localized(variant.designName, variant.designNameEn) : "";
  const otherDesignName = designName === variant?.designNameEn ? variant.designName : variant?.designNameEn;
  const otherName = isDesigns && otherDesignName && otherDesignName !== designName ? otherDesignName : "";
  const price = variant?.price ?? product.minPrice;
  // A design shows its own photos; size/colour products share the product photos.
  const galleryImages = isDesigns && variant ? variant.images : product.images;

  function selectDesign(design: StoreVariant) {
    setDesignId(design.id);
    setNotice("");
    router.replace(localePath(`/products/${product.slug}?design=${design.designCode.toLowerCase()}`), { scroll: false });
  }

  function add(goToCheckout: boolean) {
    if (!canOrder) return;
    if (!variant || variant.soldOut) {
      setNotice(t.chooseOption);
      return;
    }
    addItem({
      variantId: variant.id,
      productSlug: product.slug,
      productName: product.name,
      variantLabel: variantDisplayLabel(variant, "th"),
      unitPrice: variant.price,
      image: variant.image || product.images[0] || "",
      quantity: Math.min(quantity, maxQty),
    });
    if (goToCheckout) router.push(localePath("/checkout"));
    else setNotice(t.added);
  }

  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
      <ProductGallery
        key={galleryImages.join("|")}
        images={galleryImages}
        alt={designName || productName}
        fallback={variant?.designCode}
      />

      <div className="flex min-w-0 flex-col gap-6">
        <div>
          {isDesigns && designName ? (
            <>
              <p className="text-[15px] text-ink-soft">{productName}</p>
              <h1 className="mt-0.5 text-3xl font-bold tracking-tight text-ink md:text-4xl">{designName}</h1>
              {otherName && <p className="mt-1 text-[15px] text-ink-soft">{otherName}</p>}
            </>
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">{productName}</h1>
          )}
          {price !== null && price !== undefined && (
            <p className="mt-3 text-2xl font-semibold text-apple-blue">
              {!variant && product.minPrice !== product.maxPrice && <span className="mr-1 text-base font-normal text-ink-soft">{t.from}</span>}
              {formatPrice(price)}
              {variant && (variant.soldOut || variant.stock !== null) && (
                <span className={cn("ml-2 text-[15px] font-normal", variant.soldOut ? "font-semibold text-red-600" : "text-ink-soft")}>
                  · {variant.soldOut ? t.soldOut : t.left(variant.stock ?? 0)}
                </span>
              )}
            </p>
          )}
        </div>

        {isDesigns ? (
          <DesignPicker designs={variants} selectedId={designId} onSelect={selectDesign} />
        ) : (
          <>
            <OptionButtons label={t.size} options={sizes} selected={size} onSelect={(s) => { setSize(s); setNotice(""); }}
              isAvailable={(s) => variants.some((v) => v.size === s && (!color || v.color === color) && !v.soldOut)} />
            <OptionButtons label={t.color} options={colors} selected={color} onSelect={(c) => { setColor(c); setNotice(""); }}
              isAvailable={(c) => variants.some((v) => v.color === c && (!size || v.size === size) && !v.soldOut)} />
          </>
        )}

        <div>
          <p className="text-sm font-semibold text-ink">{t.quantity}</p>
          <div className="mt-2 inline-flex items-center rounded-full bg-mist">
            <button type="button" className="h-11 w-11 text-xl" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="-">−</button>
            <span className="w-8 text-center font-semibold">{quantity}</span>
            <button type="button" className="h-11 w-11 text-xl" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} aria-label="+">+</button>
          </div>
        </div>

        {product.saleState === "upcoming" && product.saleStartsAt && (
          <p className="rounded-2xl bg-apple-blue-soft px-4 py-3 text-sm font-semibold text-apple-blue">{t.opensAt(saleDate(product.saleStartsAt))}</p>
        )}
        {product.saleState === "ended" && (
          <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-ink-soft">{t.salesEnded}</p>
        )}
        {product.saleState === "open" && product.saleEndsAt && (
          <p className="text-sm text-ink-soft">{t.closesAt(saleDate(product.saleEndsAt))}</p>
        )}

        <BuyBar
          canOrder={canOrder}
          disabled={!!variant?.soldOut || product.soldOut}
          notice={notice}
          previewMessage={preview ? t.previewNoOrders : undefined}
          onBuy={() => add(true)}
          onAdd={() => add(false)}
        />

        {product.description && (
          <div className="whitespace-pre-line border-t border-zinc-200 pt-6 text-sm leading-relaxed text-ink-soft">
            {product.description}
          </div>
        )}
      </div>
    </div>
  );
}
