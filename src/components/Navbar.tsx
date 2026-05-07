"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { Container } from "@/components/ui/Container";

const navigationLinks = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/checkout", label: "Checkout" }
];

export function Navbar() {
  const { itemCount } = useCart();
  const navigationLinkClasses =
    "inline-flex items-center gap-2 text-sm text-zinc-600 transition hover:text-zinc-900";

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/60 bg-white/70 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-[0.12em] text-ink">
          SU STORE
        </Link>
        <nav className="flex items-center gap-6">
          {navigationLinks.map((navigationLink) => (
            <Link
              key={navigationLink.href}
              href={navigationLink.href}
              className={navigationLinkClasses}
            >
              {navigationLink.label}
              {navigationLink.href === "/checkout" ? (
                <span className="relative inline-flex">
                  <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
                  {itemCount > 0 ? (
                    <span className="absolute -right-2.5 -top-2.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-apple-blue px-1 text-[10px] font-semibold leading-none text-white">
                      {itemCount > 99 ? "99+" : itemCount}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
      </Container>
    </header>
  );
}
