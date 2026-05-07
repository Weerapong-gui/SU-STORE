"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { createBuyNowHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";

const CARD_CLASSES = "rounded-[2rem] border border-zinc-300 bg-white p-5";
const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
const SECONDARY_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 py-3 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";

export function CartCheckoutView() {
  const { items, subtotal, itemCount, removeItem, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
        <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CHECKOUT</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
          Your cart is empty
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-600">
          Add products from the home page or the products catalog first, then come back here to review your selected items.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/products" className={PRIMARY_LINK_CLASSES}>
            Browse Products
          </Link>
          <Link href="/" className={SECONDARY_LINK_CLASSES}>
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="font-sf-pro grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-4 rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">CHECKOUT</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
              Review your cart
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              {itemCount} item{itemCount > 1 ? "s" : ""} saved in your cart.
            </p>
          </div>

          <button
            type="button"
            onClick={clearCart}
            className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
          >
            Clear Cart
          </button>
        </div>

        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className={CARD_CLASSES}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">
                    {item.productShortName}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-zinc-900">{item.productName}</h2>
                  <div className="mt-3 space-y-1 text-sm text-zinc-700">
                    <p>Size: {item.size}</p>
                    <p>Quantity: {item.quantity}</p>
                    <p>School: {item.school}</p>
                    <p>Unit Price: {formatPrice(item.unitPrice)}</p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                  <p className="text-lg font-semibold text-apple-blue">
                    {formatPrice(item.unitPrice * item.quantity)}
                  </p>
                  <Link
                    href={createBuyNowHref({
                      productSlug: item.productSlug,
                      size: item.size,
                      quantity: item.quantity,
                      school: item.school
                    })}
                    className={SECONDARY_LINK_CLASSES}
                  >
                    Buy This Item
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className={`${CARD_CLASSES} bg-[#f5f5f7]`}>
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">SUMMARY</p>
          <div className="mt-4 space-y-3 text-sm text-zinc-700">
            <div className="flex items-center justify-between">
              <span>Items</span>
              <span>{itemCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span className="font-semibold text-apple-blue">{formatPrice(subtotal)}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-4">
            <span className="text-base font-semibold text-zinc-900">Total</span>
            <span className="text-2xl font-semibold text-apple-blue">{formatPrice(subtotal)}</span>
          </div>
        </div>

        <div className={CARD_CLASSES}>
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">NEXT STEP</p>
          <p className="mt-3 text-sm text-zinc-700">
            Direct one-item checkout still works right now. Combined payment for multiple cart items will be connected in the next backend phase.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/products" className={PRIMARY_LINK_CLASSES}>
              Add More Products
            </Link>
            <Link href="/" className={SECONDARY_LINK_CLASSES}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
