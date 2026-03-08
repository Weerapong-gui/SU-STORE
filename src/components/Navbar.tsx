import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Container } from "@/components/ui/Container";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/checkout", label: "Checkout" }
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/60 bg-white/70 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="text-sm font-semibold tracking-[0.12em] text-ink">
          SU STORE
        </Link>
        <nav className="flex items-center gap-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-2 text-sm text-zinc-600 transition hover:text-zinc-900"
            >
              {item.label}
              {item.href === "/checkout" ? <ShoppingBag className="h-4 w-4" strokeWidth={1.8} /> : null}
            </Link>
          ))}
        </nav>
      </Container>
    </header>
  );
}
