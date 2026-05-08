"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BankAccountCopyField } from "@/components/BankAccountCopyField";
import { useCart } from "@/components/CartProvider";
import { products } from "@/data/products";
import { EMAIL_DOMAIN } from "@/lib/checkoutOptions";
import { formatPrice } from "@/lib/formatPrice";
import {
  PAYMENT_ACCOUNT_COPY_VALUE,
  PAYMENT_ACCOUNT_NUMBER,
  PAYMENT_BANK_NAME
} from "@/lib/paymentDetails";
import { formatStoredProductSize } from "@/lib/productSizing";
import { Order } from "@/types/order";

type CheckoutPaymentFormProps = {
  existingOrder?: Order | null;
  defaultProduct?: string;
  defaultSize?: string;
  defaultQuantity?: string;
  defaultSchool?: string;
  cartItemId?: string;
  slipUploadEnabled: boolean;
  slipUploadMessage: string | null;
};

type SubmitState = "idle" | "loading";

const TEXT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const FILE_INPUT_CLASSES =
  "block w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-apple-blue file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-apple-blue-dark";
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
  defaultSchool,
  cartItemId,
  slipUploadEnabled,
  slipUploadMessage
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
  const lockedSchool = defaultSchool ?? existingOrder?.customer.school ?? "";
  const totalAmount = product.price * quantity;
  const hasUploadedSlip = Boolean(existingOrder?.slip);
  const canSubmit = slipUploadEnabled && Boolean(lockedSchool);

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

    if (!lockedSchool) {
      setSubmitError("This item is missing school information. Please go back to cart and edit the product.");
      setSubmitState("idle");
      return;
    }

    if (!slipUploadEnabled) {
      setSubmitError(slipUploadMessage ?? "Payment slip upload is not available right now.");
      setSubmitState("idle");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const slip = formData.get("slip");
    const hasNewSlip = slip instanceof File && slip.size > 0;

    if (!hasNewSlip && !hasUploadedSlip) {
      setSubmitError("Please attach your payment slip before continuing.");
      setSubmitState("idle");
      return;
    }

    const payload = {
      product: product.slug,
      size: storedSize,
      quantity,
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: String(formData.get("lastName") ?? "").trim(),
      nickname: String(formData.get("nickname") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      school: lockedSchool
    };

    const endpoint = activeOrderId ? `/api/order/${activeOrderId}` : "/api/order";
    const method = activeOrderId ? "PUT" : "POST";

    try {
      const orderResponse = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const orderResult = (await orderResponse.json().catch(() => null)) as
        | {
            message?: string;
            orderId?: string;
          }
        | null;

      if (!orderResponse.ok || !orderResult?.orderId) {
        setSubmitError(orderResult?.message ?? "Unable to save your payment details right now.");
        setSubmitState("idle");
        return;
      }

      const orderId = orderResult.orderId;
      setActiveOrderId(orderId);

      if (hasNewSlip) {
        const slipFormData = new FormData();
        slipFormData.append("slip", slip);

        const slipResponse = await fetch(`/api/order/${orderId}/payment`, {
          method: "POST",
          body: slipFormData
        });

        const slipResult = (await slipResponse.json().catch(() => null)) as
          | {
              message?: string;
              orderId?: string;
            }
          | null;

        if (!slipResponse.ok || !slipResult?.orderId) {
          setSubmitError(
            slipResult?.message ??
              "Your order was saved, but the slip upload failed. Please attach the slip again and retry."
          );
          setSubmitState("idle");
          return;
        }
      }

      if (cartItemId) {
        removeItem(cartItemId);
      }

      router.push(`/checkout/complete/${orderId}`);
    } catch {
      setSubmitError("Unable to connect to the payment service right now.");
      setSubmitState("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] xl:gap-10">
      <div className="space-y-5">
        <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-[0_18px_45px_rgba(17,17,17,0.06)]">
          <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">PAYMENT</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
            Checkout and Payment
          </h1>
          <p className="mt-3 text-sm text-zinc-600">
            Product details are now locked. If you need to change the item, quantity, or size, please go back to cart.
          </p>
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
              <p className="text-zinc-500">School</p>
              <p>{lockedSchool || "-"}</p>
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
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">FIRST NAME</span>
              <input
                name="firstName"
                required
                defaultValue={existingOrder?.customer.firstName ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="First name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">LAST NAME</span>
              <input
                name="lastName"
                required
                defaultValue={existingOrder?.customer.lastName ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="Last name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">NICKNAME</span>
              <input
                name="nickname"
                required
                defaultValue={existingOrder?.customer.nickname ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="Nickname"
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
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">TELEPHONE NUMBER</span>
              <input
                name="phone"
                required
                defaultValue={existingOrder?.customer.phone ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="08x-xxx-xxxx"
              />
            </label>
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">BANK ACCOUNT</p>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900">
            {PAYMENT_BANK_NAME}
          </h3>
          <BankAccountCopyField
            formattedAccountNumber={PAYMENT_ACCOUNT_NUMBER}
            copyValue={PAYMENT_ACCOUNT_COPY_VALUE}
          />

          <div className="mt-5 rounded-2xl border border-zinc-200 bg-[#f7f7f9] p-4">
            <p className="text-xs font-semibold tracking-[0.08em] text-zinc-500">TOTAL AMOUNT</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-apple-blue">
              {formatPrice(totalAmount)}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Transfer the exact amount above, then attach your payment slip below to complete the order.
            </p>
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-zinc-500">UPLOAD SLIP</p>
          <div className="mt-3">
            {slipUploadEnabled ? (
              <>
                <input
                  name="slip"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  required={!hasUploadedSlip}
                  className={FILE_INPUT_CLASSES}
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Supports JPG, PNG, WEBP, or PDF up to 5 MB.
                </p>
              </>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {slipUploadMessage ?? "Payment slip upload is not available right now."}
              </div>
            )}
          </div>
        </div>

        {submitError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitState === "loading" || !canSubmit}
          className={`${PRIMARY_BUTTON_CLASSES} w-full`}
        >
          {submitState === "loading" ? "SUBMITTING PAYMENT..." : "SUBMIT PAYMENT"}
        </button>
      </div>
    </form>
  );
}
