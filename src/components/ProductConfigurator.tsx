"use client";

import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { MobileProductSlider } from "@/components/MobileProductSlider";
import { SizeGuideModal } from "@/components/SizeGuideModal";
import { SurchargeToast } from "@/components/SurchargeToast";
import { SCHOOL_OPTIONS, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import {
  clampCartQuantity,
  ConfigureIntent,
  createBuyNowHref
} from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";
import {
  getStoredProductSize,
  getSizeSurcharge,
  normalizeStandardProductSize,
  ProductSizeOption
} from "@/lib/productSizing";
import { cn } from "@/lib/utils";
import { ColorVariant, Product } from "@/types/product";

type ProductConfiguratorProps = {
  product: Product;
  intent: ConfigureIntent;
  editingItemId?: string;
  defaultSize?: string;
  defaultQuantity?: string;
  defaultSchool?: string;
};

const SIZE_OPTION_BASE_CLASSES =
  "h-11 rounded-2xl border border-zinc-300 bg-white px-4 text-xs font-semibold text-zinc-800 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft";
const SIZE_OPTION_SELECTED_CLASSES =
  "border-apple-blue bg-apple-blue text-white shadow-[0_8px_20px_rgba(0,113,227,0.22)]";
const QUANTITY_CONTROL_BUTTON_CLASSES =
  "flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-lg font-semibold text-zinc-800 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex h-12 items-center justify-center rounded-full bg-apple-blue px-6 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_BUTTON_CLASSES =
  "inline-flex h-12 items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 text-sm font-semibold text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";

export function ProductConfigurator({
  product,
  intent,
  editingItemId,
  defaultSize,
  defaultQuantity,
  defaultSchool
}: ProductConfiguratorProps) {
  const router = useRouter();
  const { addItem, replaceItem } = useCart();
  const [selectedQuantity, setSelectedQuantity] = useState(() => {
    const parsedQuantity = Number.parseInt(defaultQuantity ?? "1", 10);
    return Number.isNaN(parsedQuantity) ? 1 : clampCartQuantity(parsedQuantity);
  });
  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(() => {
    if (!product.colors?.length) return null;
    if (defaultSize?.includes(" / ")) {
      const colorName = defaultSize.split(" / ")[1]?.trim();
      return product.colors.find((c) => c.name === colorName) ?? product.colors[0];
    }
    return product.colors[0];
  });
  const sizeOnly = defaultSize?.includes(" / ") ? defaultSize.split(" / ")[0]?.trim() : defaultSize;
  const [selectedSize, setSelectedSize] = useState<ProductSizeOption>(
    normalizeStandardProductSize(product, sizeOnly)
  );
  const [selectedSchool, setSelectedSchool] = useState(
    product.category === "headband" ? (defaultSchool ?? "") : ""
  );
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const surcharge = getSizeSurcharge(product, selectedSize);
  const adjustedUnitPrice = product.price + surcharge;
  const totalPrice = useMemo(() => adjustedUnitPrice * selectedQuantity, [adjustedUnitPrice, selectedQuantity]);
  const primaryMode = intent === "cart" ? "cart" : "payment";
  const baseStoredSize = getStoredProductSize(product, selectedSize);
  const storedSize = selectedColor
    ? `${baseStoredSize} / ${selectedColor.name}`
    : baseStoredSize;
  const displayImages = selectedColor ? [selectedColor.image] : product.images;

  const showSurchargeToast = useCallback(() => {
    setToastVisible(true);
    setToastKey((k) => k + 1);
  }, []);

  function updateQuantity(nextQuantity: number) {
    setSelectedQuantity(clampCartQuantity(nextQuantity));
  }

  function handleAddToCart() {
    if (editingItemId) {
      replaceItem(editingItemId, product, {
        quantity: selectedQuantity,
        size: storedSize,
        school: selectedSchool,
        unitPriceOverride: surcharge > 0 ? adjustedUnitPrice : undefined
      });
    } else {
      addItem(product, {
        quantity: selectedQuantity,
        size: storedSize,
        school: selectedSchool,
        unitPriceOverride: surcharge > 0 ? adjustedUnitPrice : undefined
      });
    }

    router.push("/checkout");
  }

  function handlePayment() {
    router.push(
      createBuyNowHref({
        productSlug: product.slug,
        size: storedSize,
        quantity: selectedQuantity,
        school: selectedSchool
      })
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div>
        <MobileProductSlider
          images={displayImages}
          productName={product.name}
          className="pb-2"
          slideClassName="h-[56vh] min-h-[320px] border border-zinc-300 bg-white shadow-soft"
        />

        <div className="hidden space-y-4 lg:block">
          {displayImages.map((image, index) => (
            <Image
              key={`${image}-${index}`}
              src={image}
              alt={`${product.name} image ${index + 1}`}
              width={product.imageSize?.width ?? 1000}
              height={product.imageSize?.height ?? 1000}
              priority={index === 0}
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="h-auto w-full"
            />
          ))}
        </div>
      </div>

      <div className="font-sf-pro sticky top-6 self-start space-y-6 rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-zinc-500">{product.shortName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
            {product.name}
          </h1>
          <p className="mt-3 text-sm text-zinc-600">{product.description}</p>
          <p className="mt-4 text-2xl font-semibold text-apple-blue">{formatPrice(product.price)}</p>
        </div>

        {product.colors && product.colors.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">COLOR</p>
              <p className="text-xs font-medium text-zinc-500">{selectedColor?.name}</p>
            </div>
            <div className="flex gap-3">
              {product.colors.map((color) => {
                const isSelected = selectedColor?.name === color.name;
                const isLight = color.name === "White";
                return (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    aria-label={color.name}
                    title={color.name}
                    className={cn(
                      "h-8 w-8 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue focus-visible:ring-offset-2",
                      isSelected ? "ring-2 ring-apple-blue ring-offset-2" : "hover:scale-110",
                      isLight ? "border border-zinc-300" : ""
                    )}
                    style={{ backgroundColor: color.hex }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {product.category === "headband" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">SCHOOL</p>
            <select
              value={selectedSchool}
              onChange={(e) => setSelectedSchool(e.target.value)}
              className="h-11 w-full appearance-none rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-800 shadow-sm outline-none ring-apple-blue focus:border-apple-blue focus:ring-1"
            >
              <option value="" disabled>เลือกสำนักวิชา...</option>
              {SCHOOL_OPTIONS.map((school) => (
                <option key={school} value={school}>{school}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">
              {product.requiresSize ? "SELECT SIZE" : "SIZE"}
            </p>
            {product.requiresSize ? (
              <button
                type="button"
                onClick={() => setSizeGuideOpen(true)}
                className="text-xs font-medium text-apple-blue transition hover:text-apple-blue-dark"
              >
                size guide
              </button>
            ) : null}
          </div>

          {product.requiresSize ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-12">
              {SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setSelectedSize(size);
                    if (product.sizeSurcharge?.sizes.includes(size)) showSurchargeToast();
                  }}
                  className={cn(
                    SIZE_OPTION_BASE_CLASSES,
                    selectedSize === size ? SIZE_OPTION_SELECTED_CLASSES : ""
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-flex rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
              ONE SIZE
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">QUANTITY</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateQuantity(selectedQuantity - 1)}
              disabled={selectedQuantity <= 1}
              className={QUANTITY_CONTROL_BUTTON_CLASSES}
              aria-label="Decrease quantity"
            >
              -
            </button>
            <div className="flex h-11 min-w-[4.5rem] items-center justify-center rounded-2xl border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900">
              {selectedQuantity}
            </div>
            <button
              type="button"
              onClick={() => updateQuantity(selectedQuantity + 1)}
              disabled={selectedQuantity >= 99}
              className={QUANTITY_CONTROL_BUTTON_CLASSES}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-300 bg-white p-5">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER PREVIEW</p>
          <div className="mt-3 space-y-2 text-sm text-zinc-700">
            <p>Product: {product.name}</p>
            <p>Quantity: {selectedQuantity}</p>
            <p>Size: {product.requiresSize ? selectedSize : "ONE SIZE"}</p>
            {selectedColor && <p>Color: {selectedColor.name}</p>}
            {selectedSchool && <p>School: {selectedSchool}</p>}
          </div>
          {surcharge > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              +{surcharge} บาท สำหรับไซซ์ {selectedSize}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4">
            <span className="text-sm text-zinc-600">Total</span>
            <span className="text-xl font-semibold text-apple-blue">{formatPrice(totalPrice)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {primaryMode === "payment" ? (
            <>
              <button type="button" onClick={handlePayment} disabled={product.category === "headband" && !selectedSchool} className={PRIMARY_BUTTON_CLASSES}>
                Payment
              </button>
              <button type="button" onClick={handleAddToCart} disabled={product.category === "headband" && !selectedSchool} className={SECONDARY_BUTTON_CLASSES}>
                {editingItemId ? "Save Changes" : "Add to Cart"}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={handleAddToCart} disabled={product.category === "headband" && !selectedSchool} className={PRIMARY_BUTTON_CLASSES}>
                {editingItemId ? "Save Changes" : "Add to Cart"}
              </button>
              <button type="button" onClick={handlePayment} disabled={product.category === "headband" && !selectedSchool} className={SECONDARY_BUTTON_CLASSES}>
                Payment
              </button>
            </>
          )}
        </div>
      </div>

      <SizeGuideModal open={sizeGuideOpen} onClose={() => setSizeGuideOpen(false)} />
      {product.sizeSurcharge && (
        <SurchargeToast
          visible={toastVisible}
          amount={product.sizeSurcharge.amount}
          toastKey={toastKey}
          onDismiss={() => setToastVisible(false)}
        />
      )}
    </div>
  );
}
