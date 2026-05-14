"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

type SurchargeToastProps = {
  visible: boolean;
  amount: number;
  toastKey: number;
  onDismiss: () => void;
};

const DURATION = 4000;

export function SurchargeToast({ visible, amount, toastKey, onDismiss }: SurchargeToastProps) {
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, DURATION);
    return () => clearTimeout(timer);
  }, [visible, toastKey, onDismiss]);

  return (
    <div
      className={cn(
        "fixed z-50 overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl transition-all duration-300",
        // Mobile: full-width at top
        "left-4 right-4 top-4",
        // Desktop: fixed width at bottom-right
        "md:left-auto md:right-6 md:top-auto md:bottom-6 md:w-80",
        visible
          ? "translate-y-0 opacity-100"
          : "-translate-y-3 md:translate-y-3 opacity-0 pointer-events-none"
      )}
    >
      <div className="px-5 py-4">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-zinc-400 uppercase">Note</p>
        <p className="mt-1.5 text-sm font-medium leading-snug text-white">
          สำหรับเสื้อไซส์ 2XL ขึ้นไป มีค่าใช้จ่ายเพิ่ม {amount} บาท
        </p>
        <p className="mt-1 text-xs leading-snug text-zinc-400">
          An extra {amount} baht will be charged for size 2XL and above
        </p>
      </div>
      <div className="h-[3px] w-full bg-zinc-800">
        {visible && (
          <div
            key={toastKey}
            className="h-full origin-left bg-apple-blue"
            style={{ animation: `toast-progress ${DURATION}ms linear forwards` }}
          />
        )}
      </div>
    </div>
  );
}
