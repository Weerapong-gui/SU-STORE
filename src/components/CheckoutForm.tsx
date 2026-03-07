"use client";

import { FormEvent, useMemo, useState } from "react";
import { products } from "@/data/products";

type CheckoutFormProps = {
  defaultProduct?: string;
};

type SubmitStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; message: string }
  | { type: "error"; message: string };

export function CheckoutForm({ defaultProduct }: CheckoutFormProps) {
  const safeDefault = useMemo(() => {
    const matched = products.find((product) => product.slug === defaultProduct);
    return matched?.slug ?? products[0].slug;
  }, [defaultProduct]);

  const [status, setStatus] = useState<SubmitStatus>({ type: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ type: "loading" });

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(data.message || "ไม่สามารถส่งคำสั่งซื้อได้");
      }

      setStatus({ type: "success", message: data.message || "ส่งคำสั่งซื้อเรียบร้อย" });
      event.currentTarget.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด";
      setStatus({ type: "error", message });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-3xl border border-zinc-200 bg-white p-7 shadow-soft">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm text-zinc-600">ชื่อ</span>
          <input
            name="name"
            required
            className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
            placeholder="ชื่อผู้สั่งซื้อ"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm text-zinc-600">เบอร์โทร</span>
          <input
            name="phone"
            required
            className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
            placeholder="08x-xxx-xxxx"
          />
        </label>
      </div>

      <label className="space-y-2">
        <span className="text-sm text-zinc-600">สินค้า</span>
        <select
          name="product"
          defaultValue={safeDefault}
          className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
        >
          {products.map((product) => (
            <option key={product.slug} value={product.slug}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm text-zinc-600">ไซซ์</span>
          <select
            name="size"
            className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
            defaultValue="M"
          >
            <option value="S">S</option>
            <option value="M">M</option>
            <option value="L">L</option>
            <option value="XL">XL</option>
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-sm text-zinc-600">จำนวน</span>
          <input
            name="quantity"
            type="number"
            min={1}
            defaultValue={1}
            className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
          />
        </label>
      </div>

      <label className="space-y-2">
        <span className="text-sm text-zinc-600">ที่อยู่จัดส่ง</span>
        <textarea
          name="address"
          required
          rows={4}
          className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm outline-none transition focus:border-zinc-700"
          placeholder="บ้านเลขที่, ถนน, เขต/อำเภอ, จังหวัด, รหัสไปรษณีย์"
        />
      </label>

      <button
        type="submit"
        disabled={status.type === "loading"}
        className="inline-flex w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status.type === "loading" ? "กำลังส่งคำสั่งซื้อ..." : "ยืนยันคำสั่งซื้อ"}
      </button>

      {status.type === "success" ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status.message}</p>
      ) : null}

      {status.type === "error" ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{status.message}</p>
      ) : null}
    </form>
  );
}
