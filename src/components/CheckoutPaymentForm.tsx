"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { products } from "@/data/products";
import { EMAIL_DOMAIN, SCHOOL_OPTIONS } from "@/lib/checkoutOptions";
import { formatOrderNumber } from "@/lib/formatOrderNumber";
import { formatPrice } from "@/lib/formatPrice";
import { getKhantokeTicketLabel, getOrderStatusLabel } from "@/lib/orderStatus";
import { formatStoredProductSize } from "@/lib/productSizing";
import { Order } from "@/types/order";

type CheckoutPaymentFormProps = {
  existingOrder?: Order | null;
  defaultProduct?: string;
  defaultSize?: string;
  defaultQuantity?: string;
  cartItemId?: string;
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

function getProductBySlug(productSlug?: string) {
  return products.find((product) => product.slug === productSlug) ?? products[0];
}

function clampQuantity(quantity: number) {
  return Math.min(99, Math.max(1, quantity));
}

export function CheckoutPaymentForm({
  existingOrder,
  defaultProduct,
  defaultSize,
  defaultQuantity,
  cartItemId
}: CheckoutPaymentFormProps) {
  const router = useRouter();
  const { removeItem } = useCart();
  const product = useMemo(
    () => getProductBySlug(defaultProduct ?? existingOrder?.product.slug),
    [defaultProduct, existingOrder?.product.slug]
  );
  const [customerEmail, setCustomerEmail] = useState(existingOrder?.customer.email ?? "");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState("");
  const [activeOrderId, setActiveOrderId] = useState(existingOrder?.id ?? "");

  const storedSize = defaultSize ?? existingOrder?.size ?? "";
  const quantity = useMemo(() => {
    const parsedValue = Number.parseInt(defaultQuantity ?? "", 10);
    if (Number.isInteger(parsedValue)) {
      return clampQuantity(parsedValue);
    }

    return existingOrder?.quantity ?? 1;
  }, [defaultQuantity, existingOrder?.quantity]);
  const totalAmount = product.price * quantity;

  function handleEmailChange(value: string) {
    const nextValue = value.replace(/\s/g, "");
    if (nextValue.endsWith("@")) {
      const localPart = nextValue.slice(0, -1);
      setCustomerEmail(localPart ? `${localPart}@${EMAIL_DOMAIN}` : `@${EMAIL_DOMAIN}`);
      return;
    }

    setCustomerEmail(nextValue);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState("loading");
    setSubmitError("");

    const formData = new FormData(event.currentTarget);
    const payload = {
      product: product.slug,
      size: storedSize,
      quantity,
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

      if (cartItemId) {
        removeItem(cartItemId);
      }

      router.push(`/checkout/payment/${result.orderId}`);
    } catch {
      setSubmitError("Unable to connect to the ordering service right now.");
      setSubmitState("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] xl:gap-10">
      <div className="space-y-5">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-[0_18px_45px_rgba(17,17,17,0.06)]">
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
                <span className="font-medium text-zinc-900">{getOrderStatusLabel(existingOrder.status)}</span>.
              </p>
              <p className={existingOrder.khantokeTicket ? "text-emerald-700" : "text-amber-700"}>
                {getKhantokeTicketLabel(existingOrder.khantokeTicket)}
              </p>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-[0_18px_45px_rgba(17,17,17,0.06)]">
          <div className="relative aspect-[4/5] bg-[#f5f5f7]">
            <Image
              src={product.images[0]}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-cover"
            />
          </div>

          <div className="p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">
              {product.shortName}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {product.name}
            </h2>

            <div className="mt-5 grid gap-x-6 gap-y-2 text-sm text-zinc-700 md:grid-cols-[auto_1fr]">
              <p className="text-zinc-500">Size</p>
              <p>{formatStoredProductSize(product.category, storedSize)}</p>
              <p className="text-zinc-500">Quantity</p>
              <p>{quantity}</p>
              <p className="text-zinc-500">Unit Price</p>
              <p>{formatPrice(product.price)}</p>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-zinc-200 pt-5">
              <span className="text-base font-semibold text-zinc-900">TOTAL</span>
              <span className="text-3xl font-semibold tracking-tight text-zinc-900">
                {formatPrice(totalAmount)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/checkout" className={SECONDARY_LINK_CLASSES}>
            Back to Cart
          </Link>
          <Link href="/products" className={SECONDARY_LINK_CLASSES}>
            View Products
          </Link>
        </div>
      </div>

      <div className="space-y-5 rounded-[2rem] border border-zinc-200 bg-white p-6 shadow-[0_18px_45px_rgba(17,17,17,0.06)] md:p-8">
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
                onChange={(event) => handleEmailChange(event.target.value)}
                className={TEXT_FIELD_CLASSES}
                placeholder={`@${EMAIL_DOMAIN}`}
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
    </form>
  );
}
