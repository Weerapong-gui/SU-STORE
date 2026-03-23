"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { products } from "@/data/products";
import { formatPrice } from "@/lib/formatPrice";
import { cn } from "@/lib/utils";

type CheckoutFormProps = {
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

const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"] as const;
const EMAIL_DOMAIN = "lamduan.mfu.ac.th";
const SCHOOL_OPTIONS = [
  "School of Agro-Industry",
  "School of Cosmetic Science",
  "School of Dentistry",
  "School of Health Science",
  "School of Applied Digital Technology",
  "School of Integrative Medicine",
  "School of Law",
  "School of Liberal Arts",
  "School of Management",
  "School of Medicine",
  "School of Nursing",
  "School of Science",
  "School of Sinology",
  "School of Social Innovation"
] as const;

const FIELD_CLASSES =
  "h-11 w-full rounded-2xl border border-zinc-300 bg-white px-4 text-xs text-zinc-900 outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10";

export function CheckoutForm({
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
  const safeDefault = useMemo(() => {
    const matched = products.find((product) => product.slug === defaultProduct);
    return matched?.slug ?? products[0].slug;
  }, [defaultProduct]);
  const safeDefaultSize = useMemo(() => {
    return SIZE_OPTIONS.includes(defaultSize as (typeof SIZE_OPTIONS)[number])
      ? (defaultSize as (typeof SIZE_OPTIONS)[number])
      : "M";
  }, [defaultSize]);
  const safeDefaultQuantity = useMemo(() => {
    const parsed = Number.parseInt(defaultQuantity ?? "1", 10);
    return Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
  }, [defaultQuantity]);
  const safeDefaultEmail = useMemo(() => defaultEmail?.trim() ?? "", [defaultEmail]);
  const safeDefaultSchool = useMemo(() => {
    return SCHOOL_OPTIONS.includes(defaultSchool as (typeof SCHOOL_OPTIONS)[number])
      ? defaultSchool
      : "";
  }, [defaultSchool]);

  const [selectedProductSlug, setSelectedProductSlug] = useState(safeDefault);
  const [selectedSize, setSelectedSize] = useState<(typeof SIZE_OPTIONS)[number]>(safeDefaultSize);
  const [quantity, setQuantity] = useState(safeDefaultQuantity);
  const [email, setEmail] = useState(safeDefaultEmail);
  const [status, setStatus] = useState<SubmitStatus>("idle");

  const selectedProduct = useMemo(() => {
    return products.find((product) => product.slug === selectedProductSlug) ?? products[0];
  }, [selectedProductSlug]);

  useEffect(() => {
    setSelectedProductSlug(safeDefault);
  }, [safeDefault]);
  useEffect(() => {
    setSelectedSize(safeDefaultSize);
  }, [safeDefaultSize]);
  useEffect(() => {
    setQuantity(safeDefaultQuantity);
  }, [safeDefaultQuantity]);
  useEffect(() => {
    setEmail(safeDefaultEmail);
  }, [safeDefaultEmail]);

  function handleEmailChange(value: string) {
    const nextValue = value.replace(/\s/g, "");
    if (nextValue.endsWith("@")) {
      const localPart = nextValue.slice(0, -1);
      setEmail(localPart ? `${localPart}@${EMAIL_DOMAIN}` : `@${EMAIL_DOMAIN}`);
      return;
    }
    setEmail(nextValue);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");

    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const nickname = String(formData.get("nickname") ?? "").trim();
    const emailValue = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const school = String(formData.get("school") ?? "").trim();

    formData.set("product", selectedProduct.slug);
    formData.set("size", selectedSize);
    formData.set("quantity", String(quantity));
    formData.set("color", "all");

    const params = new URLSearchParams({
      product: selectedProduct.slug,
      size: selectedSize,
      quantity: String(quantity),
      firstName,
      lastName,
      nickname,
      email: emailValue,
      phone,
      school
    });

    router.push(`/checkout/summary?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
      <div className="lg:h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:hidden">
          {selectedProduct.images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="relative h-[58vh] min-h-[360px] w-full shrink-0 snap-center overflow-hidden rounded-3xl"
            >
              <Image
                src={image}
                alt={`${selectedProduct.name} image ${index + 1}`}
                fill
                priority={index === 0}
                sizes="100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>

        <div className="hidden space-y-3 lg:block">
          {selectedProduct.images.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className="relative min-h-[380px] overflow-hidden rounded-3xl md:min-h-[640px] lg:min-h-[820px]"
            >
              <Image
                src={image}
                alt={`${selectedProduct.name} image ${index + 1}`}
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
          <p className="text-xs tracking-[0.08em] text-zinc-500">{selectedProduct.shortName}</p>
          <h1 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 md:text-xl">
            {selectedProduct.name}
          </h1>
          <p className="mt-2 text-sm font-semibold text-apple-blue">
            เริ่มต้นที่ {formatPrice(selectedProduct.price)}
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-700">PACKAGE OPTIONS</p>
          <div className="space-y-3">
            {products.map((product) => (
              <button
                key={product.slug}
                type="button"
                onClick={() => setSelectedProductSlug(product.slug)}
                aria-pressed={selectedProductSlug === product.slug}
                aria-label={`Select ${product.name}`}
                className={cn(
                  "w-full rounded-[1.8rem] border p-5 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15",
                  selectedProductSlug === product.slug
                    ? "border-apple-blue bg-white shadow-[0_12px_32px_rgba(0,113,227,0.12)]"
                    : "border-zinc-300 bg-[#f5f5f7] hover:border-apple-blue/35 hover:bg-white"
                )}
              >
                <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                      {product.category === "single" ? "FRESHER POLO SHIRT" : "FRESHER BUNDLE"}
                    </p>
                    <p className="mt-2 max-w-[24ch] text-base leading-snug text-zinc-800 md:text-lg">
                      {product.tagline}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "pt-1 text-lg font-semibold md:text-xl",
                      selectedProductSlug === product.slug ? "text-apple-blue" : "text-zinc-900"
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
                onClick={() => setSelectedSize(size)}
                aria-pressed={selectedSize === size}
                className={cn(
                  "h-11 rounded-2xl border border-zinc-300 bg-white text-xs font-semibold text-zinc-800 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15 hover:border-apple-blue/30 hover:bg-apple-blue-soft",
                  selectedSize === size
                    ? "z-10 border-apple-blue bg-apple-blue text-white shadow-[0_8px_20px_rgba(0,113,227,0.22)]"
                    : ""
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
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
            className="mt-2 h-11 w-24 rounded-2xl border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10"
          />
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
                className={FIELD_CLASSES}
                placeholder="First name"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">LAST NAME</span>
              <input
                name="lastName"
                required
                defaultValue={defaultLastName ?? ""}
                className={FIELD_CLASSES}
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
                className={FIELD_CLASSES}
                placeholder="Nickname"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">EMAIL</span>
              <input
                name="email"
                type="email"
                required
                value={email}
                onChange={(event) => handleEmailChange(event.target.value)}
                className={FIELD_CLASSES}
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
                className={FIELD_CLASSES}
                placeholder="08x-xxx-xxxx"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs font-semibold tracking-[0.08em] text-zinc-600">SCHOOL</span>
            <select
              name="school"
              required
              defaultValue={safeDefaultSchool}
              className={FIELD_CLASSES}
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

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="submit"
            disabled={status === "loading"}
            className="h-12 rounded-full bg-apple-blue px-6 text-xs font-semibold tracking-[0.04em] text-white shadow-[0_12px_28px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === "loading" ? "LOADING..." : "CONTINUE TO CHECKOUT"}
          </button>
        </div>

        <input type="hidden" name="product" value={selectedProduct.slug} />
        <input type="hidden" name="size" value={selectedSize} />
        <input type="hidden" name="quantity" value={quantity} />
        <input type="hidden" name="color" value="all" />
      </div>
    </form>
  );
}
