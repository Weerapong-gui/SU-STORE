"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/products", label: "สินค้า" },
  { href: "/admin/orders", label: "ออเดอร์" },
];

// FP28 orders still live in the original order-api admin page.
const LEGACY_ADMIN_URL = "https://admin.sumfu.xyz/admin";

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }

  return (
    <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-3">
        <span className="mr-3 text-sm font-bold text-zinc-900">SU STORE · หลังร้าน</span>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              pathname.startsWith(item.href) ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <a
            href={LEGACY_ADMIN_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100"
            title="ระบบเดิมของ Fresher Package 28 (ดูออเดอร์เก่า, จุดรับของ)"
          >
            ข้อมูล FP28 (เก่า) ↗
          </a>
          <button
            onClick={handleLogout}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </nav>
  );
}
