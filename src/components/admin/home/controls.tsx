"use client";

import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { adminFetch } from "@/lib/adminApi";
import { Button, Field, inputClass, useToast } from "@/components/admin/ui";
import type { StoreProduct } from "@/types/store";

// Small inputs shared by the home page block forms.

const LINK_SUGGESTIONS = [
  { href: "/products", label: "หน้าสินค้าทั้งหมด" },
  { href: "/check-order", label: "หน้าตรวจสอบออเดอร์" },
];

export function ImagePicker({ value, onChange, hint }: { value: string; onChange: (url: string) => void; hint: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const { url } = await adminFetch<{ url: string }>("home/images", { method: "POST", body: form });
      onChange(url);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-28 w-48 rounded-xl border border-zinc-200 object-cover" />
        ) : (
          <div className="flex h-28 w-48 items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 text-xs text-zinc-400">
            ยังไม่มีรูป
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? "กำลังอัปโหลด..." : value ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
          </Button>
          {value && (
            <Button variant="ghost" onClick={() => onChange("")}>
              เอารูปออก
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}

export function ButtonFields({ text, href, onChange, products }: {
  text: string;
  href: string;
  onChange: (patch: { buttonText?: string; buttonHref?: string }) => void;
  products: StoreProduct[];
}) {
  const listId = useRef(`links-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="ข้อความบนปุ่ม" hint="เว้นว่าง = ไม่มีปุ่ม">
        <input className={inputClass} value={text} maxLength={30} placeholder="เช่น สั่งซื้อเลย" onChange={(e) => onChange({ buttonText: e.target.value })} />
      </Field>
      <Field label="กดแล้วไปที่" hint="เลือกจากรายการ หรือพิมพ์ลิงก์ที่ขึ้นต้นด้วย https://">
        <input
          className={inputClass}
          value={href}
          list={listId}
          placeholder="/products"
          onChange={(e) => onChange({ buttonHref: e.target.value.trim() })}
        />
        <datalist id={listId}>
          {LINK_SUGGESTIONS.map((l) => (
            <option key={l.href} value={l.href}>{l.label}</option>
          ))}
          {products.map((p) => (
            <option key={p.id} value={`/products/${p.slug}`}>{p.name}</option>
          ))}
        </datalist>
      </Field>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-zinc-300 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${
            value === o.value ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
        >
          {o.icon && <o.icon className="h-4 w-4" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({ label, icon: Icon, onClick, disabled, danger }: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        // Icon buttons sit inside clickable cards; don't also toggle the card.
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-lg p-2 transition disabled:opacity-30 ${danger ? "text-red-600 hover:bg-red-50" : "text-zinc-600 hover:bg-zinc-100"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
