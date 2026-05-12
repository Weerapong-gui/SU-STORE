"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/CartProvider";
import { Container } from "@/components/ui/Container";

const navigationLinks = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/check-order", label: "เช็คสถานะ" },
  { href: "/checkout", label: "Checkout" }
];

export function Navbar() {
  const { itemCount } = useCart();
  const pathname = usePathname();
  const navigationLinkClasses =
    "inline-flex items-center gap-2 text-sm text-zinc-600 transition hover:text-zinc-900";

  if (/^\/checkout\/payment\/[^/]+/.test(pathname)) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-[rgba(255,255,255,0.88)] backdrop-blur-xl backdrop-saturate-150">
      <Container className="flex h-16 items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center transition hover:opacity-80"
          aria-label="SU STORE"
        >
          <Image
            src="/images/SUSTORE.png"
            alt="SU STORE"
            width={1235}
            height={1009}
            priority
            className="h-7 w-auto md:h-8"
          />
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
