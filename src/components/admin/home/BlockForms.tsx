"use client";

import { AlignCenter, AlignLeft, ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button, Field, inputClass } from "@/components/admin/ui";
import type { HeroSlide, HomeBlock, StoreProduct } from "@/types/store";
import { MAX_FEATURED, MAX_SLIDES, emptySlide, move } from "./blocks";
import { ButtonFields, IconButton, ImagePicker, Segmented } from "./controls";

type FormProps<T extends HomeBlock["type"]> = {
  block: Extract<HomeBlock, { type: T }>;
  onChange: (b: HomeBlock) => void;
  products: StoreProduct[];
};

export function BlockForm({ block, onChange, products }: { block: HomeBlock; onChange: (b: HomeBlock) => void; products: StoreProduct[] }) {
  switch (block.type) {
    case "hero":
      return <HeroForm block={block} onChange={onChange} products={products} />;
    case "featured":
      return <FeaturedForm block={block} onChange={onChange} products={products} />;
    case "text":
      return <TextForm block={block} onChange={onChange} products={products} />;
    case "imageText":
      return <ImageTextForm block={block} onChange={onChange} products={products} />;
    case "allProducts":
      return (
        <Field label="หัวข้อ" hint="เว้นว่าง = ใช้คำว่า สินค้าทั้งหมด (และ All products ตอนลูกค้าเลือกภาษาอังกฤษ)">
          <input className={inputClass} value={block.title} maxLength={80} placeholder="สินค้าทั้งหมด" onChange={(e) => onChange({ ...block, title: e.target.value })} />
        </Field>
      );
  }
}

function HeroForm({ block, onChange, products }: FormProps<"hero">) {
  const setSlide = (i: number, patch: Partial<HeroSlide>) =>
    onChange({ ...block, slides: block.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSlide = (from: number, to: number) => onChange({ ...block, slides: move(block.slides, from, to) });
  const removeSlide = (i: number) =>
    window.confirm(`ลบสไลด์ที่ ${i + 1}?`) && onChange({ ...block, slides: block.slides.filter((_, j) => j !== i) });

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        ถ้าเว้นว่างทุกช่องของสไลด์ หน้าร้านจะแสดงข้อความแนะนำร้านแบบเดิม (มีทั้งไทยและอังกฤษ)
      </p>
      {block.slides.map((slide, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 p-4">
          <div className="mb-3 flex items-center gap-1">
            <span className="mr-auto text-sm font-bold text-zinc-800">สไลด์ที่ {i + 1}</span>
            {block.slides.length > 1 && (
              <>
                <IconButton label="เลื่อนขึ้น" icon={ArrowUp} disabled={i === 0} onClick={() => moveSlide(i, i - 1)} />
                <IconButton label="เลื่อนลง" icon={ArrowDown} disabled={i === block.slides.length - 1} onClick={() => moveSlide(i, i + 1)} />
                <IconButton label="ลบสไลด์" icon={Trash2} danger onClick={() => removeSlide(i)} />
              </>
            )}
          </div>
          <div className="space-y-4">
            <ImagePicker
              value={slide.image}
              onChange={(image) => setSlide(i, { image })}
              hint="แนะนำรูปแนวนอน 1920×800 พิกเซล ระบบจะทำให้ภาพมืดลงเล็กน้อยเพื่อให้อ่านตัวหนังสือสีขาวได้ ไม่ใส่รูปจะได้พื้นสีเทาอ่อน"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ข้อความเล็กด้านบน">
                <input className={inputClass} value={slide.eyebrow} maxLength={60} placeholder="เช่น คอลเลกชันใหม่" onChange={(e) => setSlide(i, { eyebrow: e.target.value })} />
              </Field>
              <Field label="หัวข้อ">
                <input className={inputClass} value={slide.title} maxLength={80} placeholder="เช่น เสื้อ SU 2026" onChange={(e) => setSlide(i, { title: e.target.value })} />
              </Field>
            </div>
            <Field label="คำโปรย">
              <textarea className={`${inputClass} min-h-16`} value={slide.subtitle} maxLength={200} onChange={(e) => setSlide(i, { subtitle: e.target.value })} />
            </Field>
            <ButtonFields text={slide.buttonText} href={slide.buttonHref} products={products} onChange={(patch) => setSlide(i, patch)} />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" disabled={block.slides.length >= MAX_SLIDES} onClick={() => onChange({ ...block, slides: [...block.slides, emptySlide()] })}>
          ＋ เพิ่มสไลด์ ({block.slides.length}/{MAX_SLIDES})
        </Button>
        {block.slides.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={block.autoplay} onChange={(e) => onChange({ ...block, autoplay: e.target.checked })} />
            เลื่อนสไลด์อัตโนมัติทุก 5 วินาที
          </label>
        )}
      </div>
    </div>
  );
}

function FeaturedForm({ block, onChange, products }: FormProps<"featured">) {
  const selected = new Set(block.productIds);
  const toggle = (id: number) =>
    onChange({ ...block, productIds: selected.has(id) ? block.productIds.filter((x) => x !== id) : [...block.productIds, id] });
  // Archived products can't be picked any more, but stay visible while still selected.
  const choices = products.filter((p) => p.status !== "archived" || selected.has(p.id));

  return (
    <div className="space-y-4">
      <Field label="หัวข้อ" hint="เว้นว่าง = ใช้คำว่า สินค้าแนะนำ">
        <input className={inputClass} value={block.title} maxLength={80} placeholder="สินค้าแนะนำ" onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <div>
        <p className="text-sm font-semibold text-zinc-800">
          เลือกสินค้า ({block.productIds.length}/{MAX_FEATURED})
        </p>
        <p className="mb-2 text-xs text-zinc-500">เรียงตามลำดับที่ติ๊ก สินค้าที่ยังไม่เปิดขายจะยังไม่ขึ้นในหน้าร้าน</p>
        {products.length === 0 ? (
          <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">ยังไม่มีสินค้า เพิ่มได้ที่เมนู สินค้า</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {choices.map((p) => {
              const position = block.productIds.indexOf(p.id);
              const checked = position >= 0;
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2 ${checked ? "border-zinc-900 bg-zinc-50" : "border-zinc-200"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && block.productIds.length >= MAX_FEATURED}
                    onChange={() => toggle(p.id)}
                    className="sr-only"
                  />
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${checked ? "bg-zinc-900 text-white" : "border border-zinc-300"}`}>
                    {checked ? position + 1 : ""}
                  </span>
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  ) : (
                    <span className="h-10 w-10 rounded-lg bg-zinc-100" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.status !== "active" && <span className="block text-xs text-amber-700">ยังไม่เปิดขาย</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TextForm({ block, onChange }: FormProps<"text">) {
  return (
    <div className="space-y-4">
      <Field label="หัวข้อ">
        <input className={inputClass} value={block.title} maxLength={80} placeholder="เช่น รับสินค้าที่ไหน" onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="เนื้อความ" hint="ขึ้นบรรทัดใหม่ได้ตามที่พิมพ์">
        <textarea className={`${inputClass} min-h-28`} value={block.body} maxLength={2000} onChange={(e) => onChange({ ...block, body: e.target.value })} />
      </Field>
      <Segmented
        value={block.align}
        onChange={(align) => onChange({ ...block, align })}
        options={[
          { value: "center", label: "จัดกึ่งกลาง", icon: AlignCenter },
          { value: "left", label: "ชิดซ้าย", icon: AlignLeft },
        ]}
      />
    </div>
  );
}

function ImageTextForm({ block, onChange, products }: FormProps<"imageText">) {
  return (
    <div className="space-y-4">
      <ImagePicker value={block.image} onChange={(image) => onChange({ ...block, image })} hint="แนะนำรูปสัดส่วน 4:3 เช่น 1200×900 พิกเซล" />
      <Field label="วางรูปไว้ด้าน">
        <Segmented
          value={block.imageSide}
          onChange={(imageSide) => onChange({ ...block, imageSide })}
          options={[
            { value: "left", label: "ซ้าย" },
            { value: "right", label: "ขวา" },
          ]}
        />
      </Field>
      <Field label="หัวข้อ">
        <input className={inputClass} value={block.title} maxLength={80} onChange={(e) => onChange({ ...block, title: e.target.value })} />
      </Field>
      <Field label="เนื้อความ">
        <textarea className={`${inputClass} min-h-28`} value={block.body} maxLength={2000} onChange={(e) => onChange({ ...block, body: e.target.value })} />
      </Field>
      <ButtonFields text={block.buttonText} href={block.buttonHref} products={products} onChange={(patch) => onChange({ ...block, ...patch })} />
    </div>
  );
}
