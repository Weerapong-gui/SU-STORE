"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, ShoppingBag, X } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { Container } from "@/components/ui/Container";
import { cn } from "@/lib/utils";
import { useLang, useLocalePath } from "@/lib/i18n";
import { stripLocale } from "@/lib/locale";

const navigationLinks = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/check-order", label: "Track Order" },
  { href: "/checkout", label: "Checkout" }
];

export function Navbar() {
  const { itemCount } = useCart();
  const localePath = useLocalePath();
  // Link hrefs and the active-link check compare language-neutral paths.
  const pathname = stripLocale(usePathname()).path;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { lang, setLang } = useLang();

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const close = () => setIsMenuOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [isMenuOpen]);

  if (/^\/checkout\/payment\/[^/]+/.test(pathname)) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[rgba(255,255,255,0.88)] backdrop-blur-xl backdrop-saturate-150">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href={localePath("/")}
          className="inline-flex min-h-11 min-w-11 items-center transition hover:opacity-80"
          aria-label="SU STORE"
        >
          <Image
            src="/images/SUSTORE.png"
            alt="SU STORE"
            width={1235}
            height={1009}
            priority
            sizes="64px"
            className="h-7 w-auto md:h-8"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navigationLinks.map((link) => (
            <Link
              key={link.href}
              href={localePath(link.href)}
              className="inline-flex items-center gap-2 text-sm text-zinc-600 transition hover:text-zinc-900"
            >
              {link.label}
              {link.href === "/checkout" ? (
                <span className="relative inline-flex">
                  <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
                  {itemCount > 0 ? (
                    <span className="absolute -right-2.5 -top-2.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-circle bg-apple-blue px-1 text-[10px] font-semibold leading-none text-white">
                      {itemCount > 99 ? "99+" : itemCount}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Link>
          ))}
          <button
            onClick={() => setLang(lang === "en" ? "th" : "en")}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
          >
            {lang === "en" ? "EN" : "TH"}
          </button>
        </nav>

        {/* Mobile: lang toggle + cart icon + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            onClick={() => setLang(lang === "en" ? "th" : "en")}
            className="min-h-11 min-w-11 rounded-full border border-zinc-300 px-3 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
          >
            {lang === "en" ? "EN" : "TH"}
          </button>
          <Link
            href={localePath("/checkout")}
            className="relative flex h-11 w-11 items-center justify-center rounded-circle text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Checkout"
          >
            <ShoppingBag className="h-5 w-5" strokeWidth={1.8} />
            {itemCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-circle bg-apple-blue px-1 text-[9px] font-semibold leading-none text-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            ) : null}
          </Link>

          <button
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMenuOpen}
            className="flex h-11 w-11 items-center justify-center rounded-circle text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            {isMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" strokeWidth={1.8} />
            )}
          </button>
        </div>
      </Container>

      {/* Mobile dropdown */}
      <div
        className={cn(
          "absolute left-0 right-0 overflow-hidden bg-white transition-[max-height,opacity] duration-300 ease-in-out md:hidden",
          isMenuOpen ? "max-h-72 opacity-100 border-b border-black/[0.06]" : "max-h-0 opacity-0"
        )}
      >
        <nav className="flex flex-col px-6 py-2">
          {navigationLinks.map((link) => (
            <Link
              key={link.href}
              href={localePath(link.href)}
              className={cn(
                "flex items-center justify-between border-b border-zinc-100 py-4 text-[15px] transition last:border-0",
                pathname === link.href ? "font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-900"
              )}
            >
              {link.label}
              {link.href === "/checkout" && itemCount > 0 ? (
                <span className="text-xs font-semibold text-apple-blue">{itemCount > 99 ? "99+" : itemCount} items</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
