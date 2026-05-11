"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { MobileProductSlider } from "@/components/MobileProductSlider";
import { SIZE_OPTIONS } from "@/lib/checkoutOptions";
import {
  clampCartQuantity,
  ConfigureIntent,
  createBuyNowHref
} from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";
import {
  getStoredProductSize,
  isBundleProduct,
  normalizeStandardProductSize,
  parseBundleSizeSelection,
  ProductSizeOption
} from "@/lib/productSizing";
import { cn } from "@/lib/utils";
import { Product } from "@/types/product";

type ProductConfiguratorProps = {
  product: Product;
  intent: ConfigureIntent;
  editingItemId?: string;
  defaultSize?: string;
  defaultQuantity?: string;
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
  defaultQuantity
}: ProductConfiguratorProps) {
  const router = useRouter();
  const { addItem, replaceItem } = useCart();
  const [selectedQuantity, setSelectedQuantity] = useState(() => {
    const parsedQuantity = Number.parseInt(defaultQuantity ?? "1", 10);
    return Number.isNaN(parsedQuantity) ? 1 : clampCartQuantity(parsedQuantity);
  });
  const [selectedSize, setSelectedSize] = useState<ProductSizeOption>(
    normalizeStandardProductSize(product, defaultSize)
  );
  const [selectedBundleSize, setSelectedBundleSize] = useState(() =>
    parseBundleSizeSelection(defaultSize)
  );
  const bundleProduct = isBundleProduct(product);

  const totalPrice = useMemo(() => product.price * selectedQuantity, [product.price, selectedQuantity]);
  const primaryMode = intent === "cart" ? "cart" : "payment";
  const storedSize = bundleProduct
    ? getStoredProductSize(product, `POLO:${selectedBundleSize.polo}|JACKET:${selectedBundleSize.jacket}`)
    : getStoredProductSize(product, selectedSize);

  function updateQuantity(nextQuantity: number) {
    setSelectedQuantity(clampCartQuantity(nextQuantity));
  }

  function handleAddToCart() {
    if (editingItemId) {
      replaceItem(editingItemId, product, {
        quantity: selectedQuantity,
        size: storedSize,
        school: ""
      });
    } else {
      addItem(product, {
        quantity: selectedQuantity,
        size: storedSize,
        school: ""
      });
    }

    router.push("/checkout");
  }

  function handlePayment() {
    router.push(
      createBuyNowHref({
        productSlug: product.slug,
        size: storedSize,
        quantity: selectedQuantity
      })
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div>
        <MobileProductSlider
          images={product.images}
          productName={product.name}
          className="pb-2"
          slideClassName="h-[56vh] min-h-[320px] border border-zinc-300 bg-white shadow-soft"
        />

        <div className="hidden space-y-4 lg:block">
          {product.images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="relative min-h-[320px] overflow-hidden rounded-[2rem] border border-zinc-300 bg-white shadow-soft md:min-h-[520px]"
            >
              <Image
                src={image}
                alt={`${product.name} image ${index + 1}`}
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 55vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="font-sf-pro space-y-6 rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-zinc-500">{product.shortName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
            {product.name}
          </h1>
          <p className="mt-3 text-sm text-zinc-600">{product.description}</p>
          <p className="mt-4 text-2xl font-semibold text-apple-blue">{formatPrice(product.price)}</p>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">
            {product.requiresSize ? "SELECT SIZE" : "SIZE"}
          </p>

          {product.requiresSize && bundleProduct ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium tracking-[0.08em] text-zinc-500">POLO SIZE</p>
                <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                  {SIZE_OPTIONS.map((size) => (
                    <button
                      key={`polo-${size}`}
                      type="button"
                      onClick={() =>
                        setSelectedBundleSize((currentValue) => ({ ...currentValue, polo: size }))
                      }
                      className={cn(
                        SIZE_OPTION_BASE_CLASSES,
                        selectedBundleSize.polo === size ? SIZE_OPTION_SELECTED_CLASSES : ""
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium tracking-[0.08em] text-zinc-500">JACKET SIZE</p>
                <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                  {SIZE_OPTIONS.map((size) => (
                    <button
                      key={`jacket-${size}`}
                      type="button"
                      onClick={() =>
                        setSelectedBundleSize((currentValue) => ({
                          ...currentValue,
                          jacket: size
                        }))
                      }
                      className={cn(
                        SIZE_OPTION_BASE_CLASSES,
                        selectedBundleSize.jacket === size ? SIZE_OPTION_SELECTED_CLASSES : ""
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : product.requiresSize ? (
            <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
              {SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setSelectedSize(size)}
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
            {bundleProduct ? (
              <>
                <p>Polo Size: {selectedBundleSize.polo}</p>
                <p>Jacket Size: {selectedBundleSize.jacket}</p>
              </>
            ) : (
              <p>Size: {product.requiresSize ? selectedSize : "ONE SIZE"}</p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4">
            <span className="text-sm text-zinc-600">Total</span>
            <span className="text-xl font-semibold text-apple-blue">{formatPrice(totalPrice)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {primaryMode === "payment" ? (
            <>
              <button type="button" onClick={handlePayment} className={PRIMARY_BUTTON_CLASSES}>
                Payment
              </button>
              <button type="button" onClick={handleAddToCart} className={SECONDARY_BUTTON_CLASSES}>
                {editingItemId ? "Save Changes" : "Add to Cart"}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={handleAddToCart} className={PRIMARY_BUTTON_CLASSES}>
                {editingItemId ? "Save Changes" : "Add to Cart"}
              </button>
              <button type="button" onClick={handlePayment} className={SECONDARY_BUTTON_CLASSES}>
                Payment
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
