"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { products } from "@/data/products";
import { SCHOOL_OPTIONS } from "@/lib/checkoutOptions";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import { getOrderStatusLabel } from "@/lib/orderStatus";
import { formatStoredProductSize } from "@/lib/productSizing";
import { CartItem } from "@/types/cart";
import { Order, OrderItem } from "@/types/order";
import { ProductCategory } from "@/types/product";

type CheckoutPaymentFormProps = {
  existingOrder?: Order | null;
  defaultProduct?: string;
  defaultSize?: string;
  defaultQuantity?: string;
  defaultSchool?: string;
  cartItemId?: string;
  cartMode?: boolean;
};

type SubmitState = "idle" | "loading";

const TEXT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const SELECT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-semibold tracking-[0.02em] text-white transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-200";

type CheckoutDisplayItem = {
  key: string;
  productSlug: string;
  productName: string;
  productShortName: string;
  productCategory: ProductCategory;
  size: string;
  school?: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};

function getProductBySlug(productSlug?: string) {
  return products.find((product) => product.slug === productSlug) ?? products[0];
}

function clampQuantity(quantity: number) {
  return Math.min(99, Math.max(1, quantity));
}

function createDisplayItemFromOrderItem(item: OrderItem, index: number): CheckoutDisplayItem {
  return {
    key: item.id ?? `${item.product.slug}-${index}`,
    productSlug: item.product.slug,
    productName: item.product.name,
    productShortName: item.product.shortName,
    productCategory: item.product.category,
    size: item.size,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalAmount: item.totalAmount
  };
}

function createDisplayItemFromCartItem(item: CartItem): CheckoutDisplayItem {
  return {
    key: item.id,
    productSlug: item.productSlug,
    productName: item.productName,
    productShortName: item.productShortName,
    productCategory: item.productCategory,
    size: item.size,
    school: item.school || undefined,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalAmount: item.unitPrice * item.quantity
  };
}

export function CheckoutPaymentForm({
  existingOrder,
  defaultProduct,
  defaultSize,
  defaultQuantity,
  defaultSchool,
  cartItemId,
  cartMode = false
}: CheckoutPaymentFormProps) {
  const router = useRouter();
  const { clearCart, hydrated, items: cartItems, removeItem } = useCart();
  const product = useMemo(
    () => getProductBySlug(defaultProduct ?? existingOrder?.product.slug),
    [defaultProduct, existingOrder?.product.slug]
  );
  const [customerEmail, setCustomerEmail] = useState(existingOrder?.customer.email ?? "");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState("");
  const [activeOrderId, setActiveOrderId] = useState(existingOrder?.id ?? "");

  const storedSize = defaultSize ?? existingOrder?.size ?? "";
  const defaultSingleQuantity = useMemo(() => {
    const parsedValue = Number.parseInt(defaultQuantity ?? "", 10);
    if (Number.isInteger(parsedValue)) {
      return clampQuantity(parsedValue);
    }

    return existingOrder?.quantity ?? 1;
  }, [defaultQuantity, existingOrder?.quantity]);
  const selectedItems = useMemo<CheckoutDisplayItem[]>(() => {
    if (existingOrder) {
      return existingOrder.items.map(createDisplayItemFromOrderItem);
    }

    if (cartMode) {
      return cartItems.map(createDisplayItemFromCartItem);
    }

    return [
      {
        key: product.slug,
        productSlug: product.slug,
        productName: product.name,
        productShortName: product.shortName,
        productCategory: product.category,
        size: storedSize,
        school: defaultSchool || undefined,
        quantity: defaultSingleQuantity,
        unitPrice: product.price,
        totalAmount: product.price * defaultSingleQuantity
      }
    ];
  }, [cartItems, cartMode, defaultSingleQuantity, existingOrder, product, storedSize]);
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.totalAmount, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState("loading");
    setSubmitError("");

    if (selectedItems.length === 0) {
      setSubmitError("Please add at least one product before confirming your order.");
      setSubmitState("idle");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const firstItem = selectedItems[0];
    const payload = {
      product: firstItem.productSlug,
      size: firstItem.size,
      quantity: firstItem.quantity,
      items: selectedItems.map((item) => ({
        product: item.productSlug,
        size: item.size,
        quantity: item.quantity
      })),
      studentCode: String(formData.get("studentCode") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      fullName: String(formData.get("fullName") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      school: String(formData.get("school") ?? "").trim(),
      parentPhone: String(formData.get("parentPhone") ?? "").trim()
    };

    const endpoint = activeOrderId ? `/api/order/${activeOrderId}` : "/api/order";
    const method = activeOrderId ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json().catch(() => null)) as
        | {
            message?: string;
            orderId?: string;
          }
        | null;

      if (!response.ok || !result?.orderId) {
        setSubmitError(result?.message ?? "Unable to save your order right now.");
        setSubmitState("idle");
        return;
      }

      setActiveOrderId(result.orderId);

      if (cartMode) {
        clearCart();
      } else if (cartItemId) {
        removeItem(cartItemId);
      }

      router.push(`/checkout/payment/${result.orderId}`);
    } catch {
      setSubmitError("Unable to connect to the ordering service right now.");
      setSubmitState("idle");
    }
  }

  if (cartMode && !hydrated) {
    return (
      <div className="font-sf-pro rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_18px_45px_rgba(17,17,17,0.06)] md:p-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">ORDER DETAILS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
          Confirm your order
        </h1>
        <p className="mt-3 text-sm text-zinc-600">Loading your cart items...</p>
      </div>
    );
  }

  if (cartMode && selectedItems.length === 0) {
    return (
      <div className="font-sf-pro rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_18px_45px_rgba(17,17,17,0.06)] md:p-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">ORDER DETAILS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
          Confirm your order
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          Your cart is empty. Add products first, then come back to confirm your order.
        </p>
        <Link href="/products" className={`${PRIMARY_BUTTON_CLASSES} mt-6`}>
          add more products
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="font-sf-pro rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_18px_45px_rgba(17,17,17,0.06)] md:p-8"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.84fr)]">
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">ORDER DETAILS</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
              Confirm your order
            </h1>
            <p className="mt-3 text-sm text-zinc-600">
              Review the selected product, complete your personal details, and create the order number before payment.
            </p>
            {existingOrder ? (
              <div className="mt-4 space-y-2 text-sm text-zinc-600">
                <p>
                  Order {formatOrderNumber(existingOrder)} is currently{" "}
                  <span className="font-medium text-zinc-900">
                    {getOrderStatusLabel(existingOrder.status)}
                  </span>
                  .
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-[#f5f5f7] p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">ORDER SUMMARY</p>
            <div className="mt-4 divide-y divide-zinc-200">
              {selectedItems.map((item) => (
                <div key={item.key} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">
                        {item.productShortName}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">
                        {item.productName}
                      </h2>
                    </div>
                    <p className="shrink-0 font-semibold text-zinc-900">
                      {formatPrice(item.totalAmount)}
                    </p>
                  </div>

                  <div className="mt-3 grid gap-x-6 gap-y-1 text-sm text-zinc-700 sm:grid-cols-[auto_1fr]">
                    <p className="text-zinc-500">Size</p>
                    <p>{formatStoredProductSize(item.productCategory, item.size)}</p>
                    {item.school && (
                      <>
                        <p className="text-zinc-500">School</p>
                        <p>{item.school}</p>
                      </>
                    )}
                    <p className="text-zinc-500">Quantity</p>
                    <p>{item.quantity}</p>
                    <p className="text-zinc-500">Unit Price</p>
                    <p>{formatPrice(item.unitPrice)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-zinc-200 pt-5">
              <span className="text-base font-semibold text-zinc-900">TOTAL</span>
              <span className="text-3xl font-semibold tracking-tight text-zinc-900">
                {formatPrice(totalAmount)}
              </span>
            </div>
          </div>

          <Link href="/products" className={SECONDARY_LINK_CLASSES}>
            add more products
          </Link>
        </div>

        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">PERSONAL DETAILS</p>
            <p className="mt-3 text-sm text-zinc-600">
              Once you confirm this order, the system will generate an order number and move you to the payment step.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">STUDENT CODE</span>
                <input
                  name="studentCode"
                  required
                  defaultValue={existingOrder?.customer.studentCode ?? ""}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="6831501178"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">EMAIL</span>
                <input
                  name="email"
                  type="email"
                  required
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value.replace(/\s/g, ""))}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="name@example.com"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">FULL NAME</span>
                <input
                  name="fullName"
                  required
                  defaultValue={existingOrder?.customer.fullName ?? ""}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="Name Surname"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">PHONE NUMBER</span>
                <input
                  name="phone"
                  required
                  defaultValue={existingOrder?.customer.phone ?? ""}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="08x-xxx-xxxx"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">PARENT PHONE</span>
                <input
                  name="parentPhone"
                  required
                  defaultValue={existingOrder?.customer.parentPhone ?? ""}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="08x-xxx-xxxx"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">SCHOOL</span>
                <select
                  name="school"
                  required
                  defaultValue={existingOrder?.customer.school ?? ""}
                  className={SELECT_FIELD_CLASSES}
                >
                  <option value="" disabled>
                    Select school
                  </option>
                  {SCHOOL_OPTIONS.map((school) => (
                    <option key={school} value={school}>
                      {school}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {submitError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {submitError}
            </div>
          ) : null}

          <div className="border-t border-zinc-200 pt-5">
            <button
              type="submit"
              disabled={submitState === "loading"}
              className={`${PRIMARY_BUTTON_CLASSES} w-full`}
            >
              {submitState === "loading" ? "CONFIRMING..." : "CONFIRM ORDER"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
