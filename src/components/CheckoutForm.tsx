"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileProductSlider } from "@/components/MobileProductSlider";
import { products } from "@/data/products";
import { ONE_SIZE_OPTION, SCHOOL_OPTIONS, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { formatPrice } from "@/lib/formatPrice";
import {
  getStoredProductSize,
  isBundleProduct,
  normalizeStandardProductSize,
  parseBundleSizeSelection,
  ProductSizeOption
} from "@/lib/productSizing";
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

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

const TEXT_FIELD_CLASSES =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm text-ink outline-none transition placeholder:text-zinc-400 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";
const PRODUCT_OPTION_BASE_CLASSES =
  "w-full rounded-[1.8rem] border p-5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";
const PRODUCT_OPTION_SELECTED_CLASSES =
  "border-apple-blue bg-white shadow-[0_8px_24px_rgba(0,113,227,0.10)]";
const PRODUCT_OPTION_IDLE_CLASSES =
  "border-zinc-200 bg-mist hover:border-apple-blue/30 hover:bg-white";
const SIZE_OPTION_BASE_CLASSES =
  "h-10 rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-ink transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft";
const SIZE_OPTION_SELECTED_CLASSES =
  "z-10 border-apple-blue bg-apple-blue text-white shadow-[0_4px_12px_rgba(0,113,227,0.28)]";
const PRIMARY_SUBMIT_BUTTON_CLASSES =
  "h-11 rounded-full bg-apple-blue px-8 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_4px_14px_rgba(0,113,227,0.35)] transition hover:bg-apple-blue-dark active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-60";
const QUANTITY_CONTROL_BUTTON_CLASSES =
  "flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-base font-semibold text-ink transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft disabled:cursor-not-allowed disabled:opacity-40";

function clampQuantity(quantity: number) {
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, quantity));
}

function getProductBySlug(productSlug?: string) {
  return products.find((product) => product.slug === productSlug) ?? products[0];
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
  const defaultProductData = useMemo(() => getProductBySlug(defaultProduct), [defaultProduct]);
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

  const [activeProductSlug, setActiveProductSlug] = useState(defaultProductData.slug);
  const [selectedSizeOption, setSelectedSizeOption] = useState<ProductSizeOption>(
    normalizeStandardProductSize(defaultProductData, defaultSize)
  );
  const [selectedBundleSize, setSelectedBundleSize] = useState(() =>
    parseBundleSizeSelection(defaultSize)
  );
  const [selectedQuantity, setSelectedQuantity] = useState(defaultQuantityValue);
  const [customerEmail, setCustomerEmail] = useState(defaultEmailValue);
  const [submitState, setSubmitState] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState("");

  const activeProduct = useMemo(() => getProductBySlug(activeProductSlug), [activeProductSlug]);
  const bundleProduct = isBundleProduct(activeProduct);
  const storedSize = bundleProduct
    ? getStoredProductSize(
        activeProduct,
        `POLO:${selectedBundleSize.polo}|JACKET:${selectedBundleSize.jacket}`
      )
    : getStoredProductSize(activeProduct, selectedSizeOption);

  useEffect(() => {
    setActiveProductSlug(defaultProductData.slug);
    setSelectedSizeOption(normalizeStandardProductSize(defaultProductData, defaultSize));
    setSelectedBundleSize(parseBundleSizeSelection(defaultSize));
  }, [defaultProductData, defaultSize]);

  useEffect(() => {
    setSelectedQuantity(defaultQuantityValue);
  }, [defaultQuantityValue]);

  useEffect(() => {
    setCustomerEmail(defaultEmailValue);
  }, [defaultEmailValue]);

  useEffect(() => {
    const defaultSizeValue =
      activeProduct.slug === defaultProductData.slug ? defaultSize : undefined;

    setSelectedSizeOption(normalizeStandardProductSize(activeProduct, defaultSizeValue));
    setSelectedBundleSize(parseBundleSizeSelection(defaultSizeValue));
  }, [activeProduct, defaultProductData.slug, defaultSize]);

  function handleEmailChange(value: string) {
    setCustomerEmail(value.replace(/\s/g, ""));
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
      size: storedSize,
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
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
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

      router.push(`/checkout/summary/${result.orderId}`);
    } catch {
      setSubmitError("Unable to connect to the ordering service right now.");
      setSubmitState("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
      <div className="lg:h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <MobileProductSlider
          images={activeProduct.images}
          productName={activeProduct.name}
          className="pb-2"
          slideClassName="h-[58vh] min-h-[360px]"
        />

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

      <div className="font-sf-pro space-y-5 rounded-[2rem] bg-mist p-6 lg:h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-8 lg:pr-6">
        <div>
          <p className="text-xs tracking-[0.08em] text-zinc-500">{activeProduct.shortName}</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 md:text-xl">
            {activeProduct.name}
          </h1>
          <p className="mt-2 text-sm font-semibold text-apple-blue">
            Starting at {formatPrice(activeProduct.price)}
          </p>
          {existingOrderId ? (
            <p className="mt-3 text-xs font-medium tracking-[0.08em] text-zinc-500">
              ORDER ID {existingOrderId}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-[0.1em] text-ink-tertiary">PRODUCT OPTIONS</p>
          <div className="space-y-3">
            {products.map((product) => (
              <button
                key={product.slug}
                type="button"
                onClick={() => setActiveProductSlug(product.slug)}
                aria-pressed={activeProductSlug === product.slug}
                aria-label={`Select ${product.name}`}
                className={cn(
                  PRODUCT_OPTION_BASE_CLASSES,
                  activeProductSlug === product.slug
                    ? PRODUCT_OPTION_SELECTED_CLASSES
                    : PRODUCT_OPTION_IDLE_CLASSES
                )}
              >
                <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                      {product.name}
                    </p>
                    <p className="mt-2 max-w-[24ch] text-sm leading-snug text-zinc-600 md:text-base">
                      {product.shortName}
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
          <p className="text-xs font-semibold tracking-[0.1em] text-ink-tertiary">
            {activeProduct.requiresSize ? "SELECT SIZE" : "SIZE"}
          </p>

          {activeProduct.requiresSize && bundleProduct ? (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-[0.08em] text-zinc-500">POLO SIZE</p>
                  <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                    {SIZE_OPTIONS.map((size) => (
                      <button
                        key={`checkout-polo-${size}`}
                        type="button"
                        onClick={() =>
                          setSelectedBundleSize((currentValue) => ({
                            ...currentValue,
                            polo: size
                          }))
                        }
                        aria-pressed={selectedBundleSize.polo === size}
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
                        key={`checkout-jacket-${size}`}
                        type="button"
                        onClick={() =>
                          setSelectedBundleSize((currentValue) => ({
                            ...currentValue,
                            jacket: size
                          }))
                        }
                        aria-pressed={selectedBundleSize.jacket === size}
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

              <p className="text-right text-xs font-medium text-apple-blue">SIZE GUIDE</p>
            </>
          ) : activeProduct.requiresSize ? (
            <>
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
            </>
          ) : (
            <div className="inline-flex rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
              {ONE_SIZE_OPTION}
            </div>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-semibold tracking-[0.1em] text-ink-tertiary">QUANTITY</span>
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
            <div className="flex h-10 min-w-[4.5rem] items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-ink">
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

        <div className="space-y-3 border-t border-zinc-200 pt-6">
          <p className="text-xs font-semibold tracking-[0.1em] text-ink-tertiary">PERSONAL DETAILS</p>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">FIRST NAME</span>
              <input
                name="firstName"
                required
                defaultValue={defaultFirstName ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="First name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">LAST NAME</span>
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
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">NICKNAME</span>
              <input
                name="nickname"
                required
                defaultValue={defaultNickname ?? ""}
                className={TEXT_FIELD_CLASSES}
                placeholder="Nickname"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">EMAIL</span>
              <input
                name="email"
                type="email"
                required
                value={customerEmail}
                onChange={(event) => handleEmailChange(event.target.value)}
                className={TEXT_FIELD_CLASSES}
                placeholder="name@example.com"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">TELEPHONE NUMBER</span>
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
            <span className="text-xs font-semibold tracking-[0.08em] text-ink-soft">SCHOOL</span>
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
