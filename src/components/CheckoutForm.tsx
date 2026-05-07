"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { products } from "@/data/products";
import { EMAIL_DOMAIN, SCHOOL_OPTIONS, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { formatPrice } from "@/lib/formatPrice";
import { cn } from "@/lib/utils";

type CheckoutFormProps = {
  existingOrderId?: string;
  defaultProduct?: string;
  defaultSize?: string;
  defaultQuantity?: string;
  defaultFirstName?: string;
  defaultLastName?: string;
  defaultNickname?: string;
  defaultEmail?: string;
  defaultPhone?: string;
  defaultSchool?: string;
};

type SubmitStatus = "idle" | "loading";

const PRODUCT_DISPLAY_NAMES = {
  single: "FRESHER POLO SHIRT",
  bundle: "FRESHER BUNDLE"
} as const;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

const TEXT_FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-xs text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const PACKAGE_OPTION_BASE_CLASSES =
  "w-full rounded-[1.8rem] border p-5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const PACKAGE_OPTION_SELECTED_CLASSES =
  "border-apple-blue bg-white shadow-[0_12px_32px_rgba(0,113,227,0.12)]";
const PACKAGE_OPTION_IDLE_CLASSES =
  "border-zinc-300 bg-[#f5f5f7] hover:border-apple-blue/35 hover:bg-white";
const SIZE_OPTION_BASE_CLASSES =
  "h-11 rounded-2xl border border-zinc-300 bg-white text-xs font-semibold text-zinc-800 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft";
const SIZE_OPTION_SELECTED_CLASSES =
  "z-10 border-apple-blue bg-apple-blue text-white shadow-[0_8px_20px_rgba(0,113,227,0.22)]";
const PRIMARY_SUBMIT_BUTTON_CLASSES =
  "h-12 rounded-full bg-apple-blue px-6 text-xs font-semibold tracking-[0.04em] text-white shadow-[0_12px_28px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-70";
const QUANTITY_CONTROL_BUTTON_CLASSES =
  "flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-300 bg-white text-lg font-semibold text-zinc-800 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft disabled:cursor-not-allowed disabled:opacity-50";

function clampQuantity(quantity: number) {
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, quantity));
}

export function CheckoutForm({
  existingOrderId,
  defaultProduct,
  defaultSize,
  defaultQuantity,
  defaultFirstName,
  defaultLastName,
  defaultNickname,
  defaultEmail,
  defaultPhone,
  defaultSchool
}: CheckoutFormProps) {
  const router = useRouter();
  const defaultProductSlug = useMemo(() => {
    const matchingProduct = products.find((product) => product.slug === defaultProduct);
    return matchingProduct?.slug ?? products[0].slug;
  }, [defaultProduct]);
  const defaultSizeOption = useMemo(() => {
    return SIZE_OPTIONS.includes(defaultSize as (typeof SIZE_OPTIONS)[number])
      ? (defaultSize as (typeof SIZE_OPTIONS)[number])
      : "M";
  }, [defaultSize]);
  const defaultQuantityValue = useMemo(() => {
    const parsed = Number.parseInt(defaultQuantity ?? "1", 10);
    return Number.isNaN(parsed) ? MIN_QUANTITY : clampQuantity(parsed);
  }, [defaultQuantity]);
  const defaultEmailValue = useMemo(() => defaultEmail?.trim() ?? "", [defaultEmail]);
  const defaultSchoolOption = useMemo(() => {
    return SCHOOL_OPTIONS.includes(defaultSchool as (typeof SCHOOL_OPTIONS)[number])
      ? defaultSchool
      : "";
  }, [defaultSchool]);

  const [activeProductSlug, setActiveProductSlug] = useState(defaultProductSlug);
  const [selectedSizeOption, setSelectedSizeOption] = useState<(typeof SIZE_OPTIONS)[number]>(
    defaultSizeOption
  );
  const [selectedQuantity, setSelectedQuantity] = useState(defaultQuantityValue);
  const [customerEmail, setCustomerEmail] = useState(defaultEmailValue);
  const [submitState, setSubmitState] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState("");

  const activeProduct = useMemo(() => {
    return products.find((product) => product.slug === activeProductSlug) ?? products[0];
  }, [activeProductSlug]);

  useEffect(() => {
    setActiveProductSlug(defaultProductSlug);
  }, [defaultProductSlug]);

  useEffect(() => {
    setSelectedSizeOption(defaultSizeOption);
  }, [defaultSizeOption]);

  useEffect(() => {
    setSelectedQuantity(defaultQuantityValue);
  }, [defaultQuantityValue]);

  useEffect(() => {
    setCustomerEmail(defaultEmailValue);
  }, [defaultEmailValue]);

  function handleEmailChange(value: string) {
    const nextValue = value.replace(/\s/g, "");
    if (nextValue.endsWith("@")) {
      const localPart = nextValue.slice(0, -1);
      setCustomerEmail(localPart ? `${localPart}@${EMAIL_DOMAIN}` : `@${EMAIL_DOMAIN}`);
      return;
    }
    setCustomerEmail(nextValue);
  }

  function updateQuantity(nextQuantity: number) {
    setSelectedQuantity(clampQuantity(nextQuantity));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState("loading");
    setSubmitError("");

    const formData = new FormData(event.currentTarget);
    const payload = {
      product: activeProduct.slug,
      size: selectedSizeOption,
      quantity: selectedQuantity,
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: String(formData.get("lastName") ?? "").trim(),
      nickname: String(formData.get("nickname") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
      school: String(formData.get("school") ?? "").trim()
    };

    const endpoint = existingOrderId ? `/api/order/${existingOrderId}` : "/api/order";
    const method = existingOrderId ? "PUT" : "POST";

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
        setSubmitError(result?.message ?? "ไม่สามารถบันทึกคำสั่งซื้อได้ในขณะนี้");
        setSubmitState("idle");
        return;
      }

      router.push(`/checkout/summary/${result.orderId}`);
    } catch {
      setSubmitError("ไม่สามารถเชื่อมต่อกับระบบสั่งซื้อได้ในขณะนี้");
      setSubmitState("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
      <div className="lg:h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:hidden">
          {activeProduct.images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="relative h-[58vh] min-h-[360px] w-full shrink-0 snap-center overflow-hidden rounded-3xl"
            >
              <Image
                src={image}
                alt={`${activeProduct.name} image ${index + 1}`}
                fill
                priority={index === 0}
                sizes="100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        <div className="hidden space-y-3 lg:block">
          {activeProduct.images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="relative min-h-[380px] overflow-hidden rounded-3xl md:min-h-[640px] lg:min-h-[820px]"
            >
              <Image
                src={image}
                alt={`${activeProduct.name} image ${index + 1}`}
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 65vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="font-sf-pro space-y-5 rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-8 lg:pr-6">
        <div>
          <p className="text-xs tracking-[0.08em] text-zinc-500">{activeProduct.shortName}</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 md:text-xl">
            {activeProduct.name}
          </h1>
          <p className="mt-2 text-sm font-semibold text-apple-blue">
            เริ่มต้นที่ {formatPrice(activeProduct.price)}
          </p>
          {existingOrderId ? (
            <p className="mt-3 text-xs font-medium tracking-[0.08em] text-zinc-500">
              ORDER ID {existingOrderId}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">PACKAGE OPTIONS</p>
          <div className="space-y-3">
            {products.map((product) => (
              <button
                key={product.slug}
                type="button"
                onClick={() => setActiveProductSlug(product.slug)}
                aria-pressed={activeProductSlug === product.slug}
                aria-label={`Select ${product.name}`}
                className={cn(
                  PACKAGE_OPTION_BASE_CLASSES,
                  activeProductSlug === product.slug
                    ? PACKAGE_OPTION_SELECTED_CLASSES
                    : PACKAGE_OPTION_IDLE_CLASSES
                )}
              >
                <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                      {PRODUCT_DISPLAY_NAMES[product.category]}
                    </p>
                    <p className="mt-2 max-w-[24ch] text-base leading-snug text-zinc-800 md:text-lg">
                      {product.tagline}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "pt-1 text-lg font-semibold md:text-xl",
                      activeProductSlug === product.slug ? "text-apple-blue" : "text-zinc-900"
                    )}
                  >
                    {formatPrice(product.price)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">SELECT SIZE</p>

          <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
            {SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSelectedSizeOption(size)}
                aria-pressed={selectedSizeOption === size}
                className={cn(
                  SIZE_OPTION_BASE_CLASSES,
                  selectedSizeOption === size ? SIZE_OPTION_SELECTED_CLASSES : ""
                )}
              >
                {size}
              </button>
            ))}
          </div>

          <p className="text-right text-xs font-medium text-apple-blue">SIZE GUIDE</p>
        </div>

        <label className="block">
          <span className="text-xs font-semibold tracking-[0.1em] text-zinc-700">QUANTITY</span>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateQuantity(selectedQuantity - 1)}
              disabled={selectedQuantity <= MIN_QUANTITY}
              aria-label="Decrease quantity"
              className={QUANTITY_CONTROL_BUTTON_CLASSES}
            >
              -
            </button>
            <div className="flex h-11 min-w-[4.5rem] items-center justify-center rounded-2xl border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900">
              {selectedQuantity}
            </div>
            <button
              type="button"
              onClick={() => updateQuantity(selectedQuantity + 1)}
              disabled={selectedQuantity >= MAX_QUANTITY}
              aria-label="Increase quantity"
              className={QUANTITY_CONTROL_BUTTON_CLASSES}
            >
              +
            </button>
          </div>
        </label>

        <div className="space-y-3 border-t border-zinc-300/80 pt-6">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">PERSONAL DETAILS</p>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">FIRST NAME</span>
              <input
                name="firstName"
                required
                defaultValue={defaultFirstName ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="First name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">LAST NAME</span>
              <input
                name="lastName"
                required
                defaultValue={defaultLastName ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="Last name"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">NICKNAME</span>
              <input
                name="nickname"
                required
                defaultValue={defaultNickname ?? ""}
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
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">TELEPHONE NUMBER</span>
              <input
                name="phone"
                required
                defaultValue={defaultPhone ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="08x-xxx-xxxx"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">SCHOOL</span>
            <select
              name="school"
              required
              defaultValue={defaultSchoolOption}
              className={TEXT_FIELD_CLASSES}
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

        {submitError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {submitError}
          </div>
        ) : null}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="submit"
            disabled={submitState === "loading"}
            className={PRIMARY_SUBMIT_BUTTON_CLASSES}
          >
            {submitState === "loading"
              ? "SAVING ORDER..."
              : existingOrderId
                ? "UPDATE ORDER"
                : "CONTINUE TO SUMMARY"}
          </button>
        </div>
      </div>
    </form>
  );
}
