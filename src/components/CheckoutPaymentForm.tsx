"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useRef, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { BankAccountCopyField } from "@/components/BankAccountCopyField";
import { BankName } from "@/components/BankName";
import { products } from "@/data/products";
import { SCHOOL_OPTIONS } from "@/lib/checkoutOptions";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import { getOrderStatusLabel } from "@/lib/orderStatus";
import { PAYMENT_ACCOUNT_COPY_VALUE, PAYMENT_ACCOUNT_NUMBER } from "@/lib/paymentDetails";
import { formatStoredProductSize, getSizeSurcharge } from "@/lib/productSizing";
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

type SubmitState = "idle" | "creating" | "uploading";

const TEXT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const SELECT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const PRIMARY_BUTTON_CLASSES =
  "inline-flex min-h-12 items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-semibold tracking-[0.02em] text-white transition hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-60";

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
  const slipFileRef = useRef<HTMLInputElement>(null);
  const [slipFileName, setSlipFileName] = useState<string>("");

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

    const surcharge = getSizeSurcharge(product, storedSize);
    const unitPrice = product.price + surcharge;
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
        unitPrice,
        totalAmount: unitPrice * defaultSingleQuantity
      }
    ];
  }, [cartItems, cartMode, defaultSchool, defaultSingleQuantity, existingOrder, product, storedSize]);
  const totalAmount = selectedItems.reduce((sum, item) => sum + item.totalAmount, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");

    if (selectedItems.length === 0) {
      setSubmitError("Please add at least one product before confirming your order.");
      return;
    }

    const slipFile = slipFileRef.current?.files?.[0];
    if (!slipFile) {
      setSubmitError("Please attach your payment slip before confirming.");
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
        school: item.school,
        quantity: item.quantity
      })),
      studentCode: String(formData.get("studentCode") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      fullName: String(formData.get("fullName") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      school: String(formData.get("school") ?? "").trim(),
      parentPhone: String(formData.get("parentPhone") ?? "").trim()
    };

    try {
      // Step 1 — create order
      setSubmitState("creating");
      const orderRes = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
      const orderResult = (await orderRes.json().catch(() => null)) as { message?: string; orderId?: string } | null;
      if (!orderRes.ok || !orderResult?.orderId) {
        setSubmitError(orderResult?.message ?? "Unable to save your order right now.");
        setSubmitState("idle");
        return;
      }

      const orderId = orderResult.orderId;

      // Step 2 — upload slip
      setSubmitState("uploading");
      const slipData = new FormData();
      slipData.append("slip", slipFile);
      const slipRes = await fetch(`/api/order/${orderId}/payment`, {
        method: "POST",
        body: slipData,
        signal: AbortSignal.timeout(30000)
      });
      if (!slipRes.ok) {
        const slipResult = (await slipRes.json().catch(() => null)) as { message?: string } | null;
        setSubmitError(
          (slipResult?.message ?? "Slip upload failed.") +
          ` Your order ${orderId} was created — go to Check Order to upload your slip.`
        );
        setSubmitState("idle");
        return;
      }

      if (cartMode) {
        clearCart();
      } else if (cartItemId) {
        removeItem(cartItemId);
      }

      router.push(`/checkout/complete/${orderId}`);
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
          Browse products
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
            <p className="mt-3 text-sm text-zinc-500">
              Transfer the exact amount, fill in your details, and attach your slip to confirm.
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
                    <p className="text-zinc-400">Size</p>
                    <p>{formatStoredProductSize(item.productCategory, item.size).split(" / ")[0]}</p>
                    {item.size.includes(" / ") && (
                      <>
                        <p className="text-zinc-400">Color</p>
                        <p>{item.size.split(" / ")[1]}</p>
                      </>
                    )}
                    {item.school && (
                      <>
                        <p className="text-zinc-400">{item.productCategory === "headband" ? "Print" : "School"}</p>
                        <p>{item.school}</p>
                      </>
                    )}
                    {item.quantity > 1 && (
                      <>
                        <p className="text-zinc-400">Qty</p>
                        <p>{item.quantity} × {formatPrice(item.unitPrice)}</p>
                      </>
                    )}
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

          <Link href="/products" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-zinc-900">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Browse products
          </Link>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-zinc-200 bg-[#f5f5f7] p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">BANK ACCOUNT</p>
            <h2 className="mt-2 text-lg font-semibold text-zinc-900"><BankName /></h2>
            <div className="mt-3 flex items-center justify-center rounded-[1.5rem] border border-zinc-200 bg-white px-4 py-3">
              <Image
                src="/images/logoBank.png"
                alt="Bangkok Bank"
                width={600}
                height={300}
                className="w-full max-w-xs object-contain"
              />
            </div>
            <BankAccountCopyField
              formattedAccountNumber={PAYMENT_ACCOUNT_NUMBER}
              copyValue={PAYMENT_ACCOUNT_COPY_VALUE}
            />
            <div className="mt-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-apple-blue">{formatPrice(totalAmount)}</p>
              <p className="mt-1 text-xs text-zinc-500">Transfer this exact amount, then attach your slip below.</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">PERSONAL DETAILS</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2" translate="no">
              <label className="space-y-1">
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">STUDENT CODE</span>
                <span className="block text-[11px] leading-relaxed text-zinc-400">
                  บุคคลทั่วไปใช้เบอร์โทรแทนได้ · Non-students may use a phone number
                </span>
                <input
                  name="studentCode"
                  required
                  defaultValue={existingOrder?.customer.studentCode ?? ""}
                  className={TEXT_FIELD_CLASSES}
                  placeholder="Student ID"
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
                  placeholder="student ID @lamduan.mfu.ac.th"
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
                <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">ENROLLED AT</span>
                <select
                  name="school"
                  required
                  defaultValue={existingOrder?.customer.school ?? ""}
                  className={SELECT_FIELD_CLASSES}
                  translate="no"
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

          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">PAYMENT SLIP</p>
            <label className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-8 text-center transition hover:border-zinc-300 hover:bg-zinc-50">
              <input
                ref={slipFileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                required
                className="sr-only"
                onChange={(e) => setSlipFileName(e.target.files?.[0]?.name ?? "")}
              />
              {slipFileName ? (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                      <path d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <p className="max-w-[20ch] truncate text-sm font-medium text-zinc-700">{slipFileName}</p>
                  <p className="text-xs text-zinc-400">Tap to change</p>
                </>
              ) : (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                      <polyline points="16 12 12 8 8 12" />
                      <line x1="12" y1="8" x2="12" y2="21" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-zinc-700">Attach payment slip</p>
                  <p className="text-xs text-zinc-400">JPG, PNG, WebP or PDF · max 10 MB</p>
                </>
              )}
            </label>
          </div>

          {submitError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <p>{submitError}</p>
              <p className="mt-1 text-xs text-rose-600">หากพบปัญหาขัดข้องเกี่ยวกับระบบให้ติดต่อผู้ดูแลระบบ โทร : 0838627000 ปาร์ค</p>
            </div>
          ) : null}

          <div className="border-t border-zinc-200 pt-5">
            <button
              type="submit"
              disabled={submitState !== "idle"}
              className={`${PRIMARY_BUTTON_CLASSES} w-full`}
            >
              {submitState === "creating"
                ? "Creating order..."
                : submitState === "uploading"
                  ? "Uploading slip..."
                  : "Confirm Order"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
