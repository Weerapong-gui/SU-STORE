"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { useLang } from "@/lib/i18n";

const ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-6 py-3 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20";
const SECONDARY_ACTION_LINK_CLASSES =
  "inline-flex items-center justify-center rounded-full border border-apple-blue/20 bg-white px-6 py-3 text-sm font-medium text-apple-blue transition hover:bg-apple-blue-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/15";

type OrderAccessFallbackProps = {
  orderId: string;
  title: string;
};

export function OrderAccessFallback({ orderId, title }: OrderAccessFallbackProps) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [studentCode, setStudentCode] = useState("");

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const code = studentCode.trim();
    if (!code) return;
    router.push(`/check-order?studentCode=${encodeURIComponent(code)}`);
  }

  return (
    <section className="bg-[#ececec] py-6 md:py-10">
      <Container className="max-w-4xl">
        <div className="font-sf-pro rounded-[2rem] border border-zinc-300 bg-[#f5f5f7] p-6 md:p-8">
          <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">ORDER SESSION</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
            {title}
          </h1>
          <div className="mt-6 rounded-3xl border border-zinc-300 bg-white p-5 text-sm leading-7 text-zinc-700">
            <p>{t.orderAccess.notFound(orderId)}</p>
            <p className="mt-2">{t.orderAccess.hint}</p>
          </div>

          <div className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5">
            <p className="text-xs font-semibold tracking-[0.1em] text-zinc-500">
              {lang === "th" ? "ค้นหาด้วยรหัสนักศึกษา" : "LOOK UP BY STUDENT ID"}
            </p>
            <form onSubmit={handleLookup} className="mt-3 flex gap-2">
              <input
                type="text"
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                placeholder={t.checkOrder.subtitle.replace("Enter your ", "").replace(" to check your order status", "")}
                className="flex-1 rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm outline-none focus:border-apple-blue focus:ring-2 focus:ring-apple-blue/20"
              />
              <button
                type="submit"
                className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:opacity-80"
              >
                {t.checkOrder.search}
              </button>
            </form>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/checkout" className={ACTION_LINK_CLASSES}>
              Start New Order
            </Link>
            <Link href="/" className={SECONDARY_ACTION_LINK_CLASSES}>
              Back to Home
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
