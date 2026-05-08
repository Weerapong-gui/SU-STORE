"use client";

import Image from "next/image";
import Link from "next/link";
import { Lock, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { createBuyNowHref, createCartEditHref } from "@/lib/cart";
import { formatPrice } from "@/lib/formatPrice";
import { formatStoredProductSize } from "@/lib/productSizing";

const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
const SECONDARY_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-200";
const QUANTITY_BUTTON_CLASSES =
  "inline-flex h-12 w-12 items-center justify-center border border-zinc-300 bg-white text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-40";

export function CartCheckoutView() {
  const { items, subtotal, itemCount, removeItem, updateItemQuantity, clearCart } = useCart();
  const checkoutTarget = items[0]
    ? createBuyNowHref({
        itemId: items[0].id,
        productSlug: items[0].productSlug,
        size: items[0].size,
        quantity: items[0].quantity,
        school: items[0].school
      })
    : "/buy-now";

  if (items.length === 0) {
    return (
      <div className="font-sf-pro py-6 md:py-10">
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
    <div className="font-sf-pro grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_26rem] xl:gap-16">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">CHECKOUT</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900 md:text-6xl">
              SHOPPING BAG
            </h1>
            <p className="mt-3 text-sm text-zinc-600">
              {itemCount} item{itemCount > 1 ? "s" : ""} saved in your bag.
            </p>
          </div>

          <button
            type="button"
            onClick={clearCart}
            className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
          >
            Clear Bag
          </button>
        </div>

        <div className="mt-8 divide-y divide-zinc-200 border-t border-zinc-200">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid gap-5 py-8 md:grid-cols-[7rem_minmax(0,1fr)] xl:grid-cols-[9rem_minmax(0,1fr)_auto]"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-white">
                <Image
                  src={item.productImage}
                  alt={item.productName}
                  fill
                  sizes="(min-width: 1280px) 144px, 112px"
                  className="object-cover"
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">
                      {item.productShortName}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                      {item.productName}
                    </h2>
                  </div>

                  <div className="hidden items-center gap-3 xl:flex">
                    <Link
                      href={createCartEditHref({
                        itemId: item.id,
                        productSlug: item.productSlug,
                        size: item.size,
                        quantity: item.quantity,
                        school: item.school
                      })}
                      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-900"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Link>

                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-x-6 gap-y-1 text-sm text-zinc-700 md:grid-cols-[auto_1fr]">
                  <p className="text-zinc-500">Size</p>
                  <p>{formatStoredProductSize(item.productCategory, item.size)}</p>
                  <p className="text-zinc-500">School</p>
                  <p>{item.school}</p>
                  <p className="text-zinc-500">Unit Price</p>
                  <p>{formatPrice(item.unitPrice)}</p>
                  <p className="text-zinc-500">Total</p>
                  <p className="font-semibold text-zinc-900">
                    {formatPrice(item.unitPrice * item.quantity)}
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <div className="inline-flex overflow-hidden border border-zinc-300 bg-white">
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.id, item.quantity - 1)}
                      disabled={item.quantity <= 1}
                      className={QUANTITY_BUTTON_CLASSES}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <div className="flex h-12 min-w-[4.5rem] items-center justify-center border-x border-zinc-300 px-5 text-xl font-medium text-zinc-900">
                      {item.quantity}
                    </div>
                    <button
                      type="button"
                      onClick={() => updateItemQuantity(item.id, item.quantity + 1)}
                      disabled={item.quantity >= 99}
                      className={QUANTITY_BUTTON_CLASSES}
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 xl:hidden">
                    <Link
                      href={createCartEditHref({
                        itemId: item.id,
                        productSlug: item.productSlug,
                        size: item.size,
                        quantity: item.quantity,
                        school: item.school
                      })}
                      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-900"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Link>

                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              <div className="hidden items-start justify-end xl:flex">
                <p className="text-2xl font-semibold tracking-tight text-zinc-900">
                  {formatPrice(item.unitPrice * item.quantity)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="space-y-5 self-start xl:sticky xl:top-24">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_18px_45px_rgba(17,17,17,0.06)]">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-5">
            <p className="text-lg font-semibold tracking-tight text-zinc-900">
              Voucher and Discounts
            </p>
            <span className="text-sm font-semibold tracking-[0.08em] text-zinc-900">ADD</span>
          </div>

          <div className="mt-6 space-y-4 text-sm text-zinc-700">
            <div className="flex items-center justify-between gap-4">
              <span>Order Value</span>
              <span className="font-semibold text-zinc-900">{formatPrice(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Items</span>
              <span className="font-semibold text-zinc-900">{itemCount}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-zinc-200 pt-5">
            <span className="text-3xl font-semibold tracking-tight text-zinc-900">TOTAL</span>
            <span className="text-3xl font-semibold tracking-tight text-zinc-900">
              {formatPrice(subtotal)}
            </span>
          </div>

          <Link href={checkoutTarget} className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-black px-6 py-4 text-base font-semibold tracking-[0.02em] text-white transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300">
            CONTINUE TO CHECKOUT
          </Link>

          <div className="mt-5 rounded-[1.5rem] bg-[#f5f5f7] p-4 text-sm text-zinc-600">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" />
              <p>
                The next step will lock this item for payment. If you want to change the product,
                quantity, or size, please do it here in your cart first.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/products" className={SECONDARY_LINK_CLASSES}>
              View Products
            </Link>
            <Link href="/" className={SECONDARY_LINK_CLASSES}>
              Back to Home
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
