"use client";

import Link from "next/link";
import { useLocalePath } from "@/lib/i18n";
import { stripLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

// Staff-entered button links may point outside the storefront routes.
const NON_LOCALIZED_PATH = /^\/(?:api|images|product-images|admin)(?:[/?#]|$)/;

function isStorefrontPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !NON_LOCALIZED_PATH.test(href);
}

// Staff may paste a link that already carries /th, so drop it before localizing.
function localizeHref(href: string, localePath: (path: string) => string): string {
  const { path } = stripLocale(href);
  return isStorefrontPath(path) ? localePath(path) : href;
}

type BuyButtonProps = {
  href: string;
  children: string;
  variant?: "primary" | "secondary" | "dark";
  className?: string;
};

export function BuyButton({
  href,
  children,
  variant = "primary",
  className
}: BuyButtonProps) {
  const localePath = useLocalePath();
  const buttonBaseClasses =
    "inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold tracking-[0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
  const buttonVariantClasses = {
    primary:
      "bg-apple-blue text-white shadow-[0_4px_14px_rgb(var(--accent)/0.35)] hover:bg-apple-blue-dark active:scale-[0.98]",
    secondary:
      "bg-apple-blue-soft text-apple-blue hover:bg-apple-blue/15 active:scale-[0.98]",
    dark:
      "bg-apple-blue-light text-white shadow-[0_4px_14px_rgb(var(--accent-light)/0.35)] hover:bg-apple-blue active:scale-[0.98]"
  };

  return (
    <Link href={localizeHref(href, localePath)} className={cn(buttonBaseClasses, buttonVariantClasses[variant], className)}>
      {children}
    </Link>
  );
}
