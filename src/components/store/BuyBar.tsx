"use client";

import { useStoreText } from "@/lib/storeI18n";

// Below `md` it is sticky to the bottom of the screen and, as the last item of the page content, rests above the footer instead of covering it. Inline from `md` up.
export function BuyBar({ canOrder, disabled, notice, previewMessage, onBuy, onAdd }: {
  canOrder: boolean;
  disabled: boolean;
  notice: string;
  previewMessage?: string;
  onBuy: () => void;
  onAdd: () => void;
}) {
  const t = useStoreText();
  const off = !canOrder || disabled;
  return (
    <div className="sticky bottom-0 z-30 order-last -mx-6 flex flex-wrap gap-2.5 border-t border-zinc-200 bg-white/95 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:z-auto md:order-none md:mx-0 md:gap-3 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      {previewMessage && <p className="w-full rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900">{previewMessage}</p>}
      {/* Always mounted so screen readers announce changes; the bar stays on screen on mobile, so feedback must live here. */}
      <p role="status" aria-live="polite" className={notice ? "w-full text-sm font-medium text-apple-blue md:order-3" : "sr-only"}>{notice}</p>
      <button
        type="button"
        onClick={onAdd}
        disabled={off}
        className="min-h-12 flex-1 whitespace-nowrap md:min-h-[52px] rounded-full bg-apple-blue-soft px-4 text-base font-semibold text-apple-blue transition hover:bg-apple-blue/15 disabled:cursor-not-allowed disabled:opacity-40 md:order-2 md:flex-none md:text-sm"
      >
        {t.addToCart}
      </button>
      <button
        type="button"
        onClick={onBuy}
        disabled={off}
        className="min-h-12 flex-1 whitespace-nowrap md:min-h-[52px] rounded-full bg-apple-blue px-4 text-base font-semibold text-white shadow-[0_4px_14px_rgb(var(--accent)/0.35)] transition hover:bg-apple-blue-dark disabled:cursor-not-allowed disabled:opacity-40 md:order-1 md:flex-none md:text-sm"
      >
        {t.buyNow}
      </button>
    </div>
  );
}
