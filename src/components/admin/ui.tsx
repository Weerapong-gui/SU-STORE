"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { OrderStatus, ProductStatus } from "@/types/store";

export function Card({ title, step, hint, children }: {
  title?: string;
  step?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      {title && (
        <header className="mb-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
            {step !== undefined && (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs text-white">
                {step}
              </span>
            )}
            {title}
          </h2>
          {hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-zinc-800">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:bg-zinc-100";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-zinc-900 text-white hover:bg-zinc-700",
    secondary: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
    danger: "bg-red-600 text-white hover:bg-red-500",
    ghost: "text-zinc-600 hover:bg-zinc-100",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

const PRODUCT_STATUS_STYLE: Record<ProductStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  active: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-700",
};
export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "ฉบับร่าง",
  active: "เปิดขาย",
  archived: "ปิดการขาย",
};

const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  pending_payment: "bg-zinc-100 text-zinc-600",
  waiting_confirm: "bg-amber-100 text-amber-800",
  paid: "bg-sky-100 text-sky-700",
  ready: "bg-violet-100 text-violet-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "รอโอนเงิน",
  waiting_confirm: "รอตรวจสลิป",
  paid: "ชำระแล้ว",
  ready: "พร้อมรับสินค้า",
  completed: "รับสินค้าแล้ว",
  cancelled: "ยกเลิก",
};

export function Badge({ kind, status }: { kind: "product"; status: ProductStatus } | { kind: "order"; status: OrderStatus }) {
  const style = kind === "product" ? PRODUCT_STATUS_STYLE[status] : ORDER_STATUS_STYLE[status];
  const label = kind === "product" ? PRODUCT_STATUS_LABEL[status] : ORDER_STATUS_LABEL[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>{label}</span>;
}

type Toast = { id: number; text: string; tone: "ok" | "error" };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${
              t.tone === "ok" ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {t.tone === "ok" ? "✓ " : "✕ "}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
      <p className="text-base font-semibold text-zinc-800">{title}</p>
      {children && <div className="mt-2 text-sm text-zinc-500">{children}</div>}
    </div>
  );
}
