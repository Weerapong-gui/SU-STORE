"use client";

import { useStoreText } from "@/lib/storeI18n";

// Fixed to the bottom of the screen below `md` (the page pads its bottom to match), inline from `md` up.
export function BuyBar({ canOrder, disabled, onBuy, onAdd }: {
  canOrder: boolean;
  disabled: boolean;
  onBuy: () => void;
  onAdd: () => void;
}) {
  const t = useStoreText();
  const off = !canOrder || disabled;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2.5 border-t border-zinc-200 bg-white/95 px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:z-auto md:flex-wrap md:gap-3 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      <button
        type="button"
        onClick={onAdd}
        disabled={off}
        className="min-h-12 flex-1 md:min-h-[52px] rounded-full bg-apple-blue-soft px-7 text-base font-semibold text-apple-blue transition hover:bg-apple-blue/15 disabled:cursor-not-allowed disabled:opacity-40 md:order-2 md:flex-none md:text-sm"
      >
        {t.addToCart}
      </button>
      <button
        type="button"
        onClick={onBuy}
        disabled={off}
        className="min-h-12 flex-1 md:min-h-[52px] rounded-full bg-apple-blue px-7 text-base font-semibold text-white shadow-[0_4px_14px_rgb(var(--accent)/0.35)] transition hover:bg-apple-blue-dark disabled:cursor-not-allowed disabled:opacity-40 md:order-1 md:flex-none md:text-sm"
      >
        {t.buyNow}
      </button>
    </div>
  );
}
