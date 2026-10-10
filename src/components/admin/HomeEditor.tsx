"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  EyeOff,
  GalleryHorizontal,
  GripVertical,
  LayoutGrid,
  PanelLeft,
  Star,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import { adminFetch, formatThaiDateTime } from "@/lib/adminApi";
import { contrastWithWhite } from "@/lib/accent";
import { Button, Card, Field, inputClass, useToast } from "@/components/admin/ui";
import type { HeroSlide, HomeAdminState, HomeBlock, HomeBlockType, HomeLayout, StoreProduct } from "@/types/store";

const AUTOSAVE_MS = 1000;
const MAX_BLOCKS = 20;
const MAX_SLIDES = 6;
const MAX_FEATURED = 12;

const BLOCK_INFO: Record<HomeBlockType, { label: string; icon: LucideIcon; description: string }> = {
  hero: { label: "แบนเนอร์", icon: GalleryHorizontal, description: "รูปใหญ่เต็มความกว้าง มีหัวข้อและปุ่ม ใส่ได้หลายรูปแล้วเลื่อนเป็นสไลด์" },
  featured: { label: "สินค้าแนะนำ", icon: Star, description: "เลือกสินค้าที่อยากโชว์เองว่าจะให้ขึ้นชิ้นไหนบ้าง" },
  text: { label: "ข้อความ", icon: Type, description: "หัวข้อกับย่อหน้าสั้นๆ เช่น วันรับของ หรือวิธีสั่งซื้อ" },
  imageText: { label: "รูปคู่ข้อความ", icon: PanelLeft, description: "รูปหนึ่งรูปวางข้างข้อความ เหมาะกับเล่าเรื่องสินค้าหรือกิจกรรม" },
  allProducts: { label: "สินค้าทั้งหมด", icon: LayoutGrid, description: "ตารางสินค้าที่เปิดขายทุกชิ้น เรียงตามลำดับในหน้าสินค้า" },
};

const ACCENT_PRESETS = [
  { hex: "#0071e3", name: "ฟ้า (เดิม)" },
  { hex: "#1d3a8a", name: "กรมท่า" },
  { hex: "#15803d", name: "เขียว" },
  { hex: "#c62828", name: "แดง" },
  { hex: "#7b1fa2", name: "ม่วง" },
  { hex: "#c2410c", name: "ส้ม" },
  { hex: "#be185d", name: "ชมพู" },
  { hex: "#1d1d1f", name: "ดำ" },
];

const LINK_SUGGESTIONS = [
  { href: "/products", label: "หน้าสินค้าทั้งหมด" },
  { href: "/check-order", label: "หน้าตรวจสอบออเดอร์" },
];

const emptySlide = (): HeroSlide => ({ image: "", eyebrow: "", title: "", subtitle: "", buttonText: "", buttonHref: "" });

function newBlock(type: HomeBlockType): HomeBlock {
  const id = `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case "hero":
      return { id, type, hidden: false, autoplay: true, slides: [emptySlide()] };
    case "featured":
      return { id, type, hidden: false, title: "", productIds: [] };
    case "text":
      return { id, type, hidden: false, title: "", body: "", align: "center" };
    case "imageText":
      return { id, type, hidden: false, image: "", title: "", body: "", buttonText: "", buttonHref: "", imageSide: "left" };
    case "allProducts":
      return { id, type, hidden: false, title: "" };
  }
}

// One-line description of a block for its collapsed card, plus a warning when it won't show.
function summarize(block: HomeBlock): { text: string; warning?: string } {
  switch (block.type) {
    case "hero": {
      const blank = block.slides.length === 1 && !block.slides[0].image && !block.slides[0].title && !block.slides[0].subtitle;
      return { text: blank ? "ข้อความแนะนำร้านมาตรฐาน" : `${block.slides.length} สไลด์` };
    }
    case "featured":
      return block.productIds.length
        ? { text: `${block.productIds.length} ชิ้น${block.title ? ` · "${block.title}"` : ""}` }
        : { text: "", warning: "ยังไม่ได้เลือกสินค้า จึงยังไม่แสดงในหน้าร้าน" };
    case "text":
      return block.title || block.body
        ? { text: `"${(block.title || block.body).slice(0, 40)}"` }
        : { text: "", warning: "ยังว่างอยู่ จึงยังไม่แสดงในหน้าร้าน" };
    case "imageText":
      return block.image || block.title || block.body
        ? { text: block.title ? `"${block.title.slice(0, 40)}"` : "มีรูปแล้ว" }
        : { text: "", warning: "ยังว่างอยู่ จึงยังไม่แสดงในหน้าร้าน" };
    case "allProducts":
      return { text: block.title ? `"${block.title}"` : "" };
  }
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ── Small inputs ─────────────────────────────────────────────────────────────

function ImagePicker({ value, onChange, hint }: { value: string; onChange: (url: string) => void; hint: string }) {
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

function ButtonFields({ text, href, onChange, products }: {
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

function Segmented<T extends string>({ value, options, onChange }: {
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

// ── Block forms ──────────────────────────────────────────────────────────────

function HeroForm({ block, onChange, products }: {
  block: Extract<HomeBlock, { type: "hero" }>;
  onChange: (b: HomeBlock) => void;
  products: StoreProduct[];
}) {
  const setSlide = (i: number, patch: Partial<HeroSlide>) =>
    onChange({ ...block, slides: block.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

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
                <IconButton label="เลื่อนขึ้น" icon={ArrowUp} disabled={i === 0} onClick={() => onChange({ ...block, slides: move(block.slides, i, i - 1) })} />
                <IconButton
                  label="เลื่อนลง"
                  icon={ArrowDown}
                  disabled={i === block.slides.length - 1}
                  onClick={() => onChange({ ...block, slides: move(block.slides, i, i + 1) })}
                />
                <IconButton
                  label="ลบสไลด์"
                  icon={Trash2}
                  danger
                  onClick={() => window.confirm(`ลบสไลด์ที่ ${i + 1}?`) && onChange({ ...block, slides: block.slides.filter((_, j) => j !== i) })}
                />
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

function FeaturedForm({ block, onChange, products }: {
  block: Extract<HomeBlock, { type: "featured" }>;
  onChange: (b: HomeBlock) => void;
  products: StoreProduct[];
}) {
  const selected = new Set(block.productIds);
  const toggle = (id: number) =>
    onChange({ ...block, productIds: selected.has(id) ? block.productIds.filter((x) => x !== id) : [...block.productIds, id] });

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
            {products.filter((p) => p.status !== "archived" || selected.has(p.id)).map((p) => {
              const order = block.productIds.indexOf(p.id);
              const checked = order >= 0;
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
                    {checked ? order + 1 : ""}
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

function BlockForm({ block, onChange, products }: { block: HomeBlock; onChange: (b: HomeBlock) => void; products: StoreProduct[] }) {
  switch (block.type) {
    case "hero":
      return <HeroForm block={block} onChange={onChange} products={products} />;
    case "featured":
      return <FeaturedForm block={block} onChange={onChange} products={products} />;
    case "text":
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
    case "imageText":
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
    case "allProducts":
      return (
        <Field label="หัวข้อ" hint="เว้นว่าง = ใช้คำว่า สินค้าทั้งหมด (และ All products ตอนลูกค้าเลือกภาษาอังกฤษ)">
          <input className={inputClass} value={block.title} maxLength={80} placeholder="สินค้าทั้งหมด" onChange={(e) => onChange({ ...block, title: e.target.value })} />
        </Field>
      );
  }
}

function IconButton({ label, icon: Icon, onClick, disabled, danger }: {
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
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-lg p-2 transition disabled:opacity-30 ${danger ? "text-red-600 hover:bg-red-50" : "text-zinc-600 hover:bg-zinc-100"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ── Accent colour ────────────────────────────────────────────────────────────

function AccentPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(text);
  const readable = valid && contrastWithWhite(text) >= 4.5;

  function commit(hex: string) {
    setText(hex);
    if (/^#[0-9a-f]{6}$/i.test(hex) && contrastWithWhite(hex) >= 4.5) onChange(hex.toLowerCase());
  }

  const preview = valid ? text : value;
  return (
    <Card title="สีหลักของร้าน" hint="ใช้กับปุ่ม ลิงก์ และแถบประกาศทั้งร้าน (หลังร้านไม่เปลี่ยนสี)">
      <div className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            onClick={() => commit(p.hex)}
            className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${
              value === p.hex ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200 hover:border-zinc-400"
            }`}
          >
            <span className="h-6 w-6 rounded-full" style={{ background: p.hex }} />
            {p.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input type="color" value={valid ? text : value} onChange={(e) => commit(e.target.value)} className="h-10 w-14 cursor-pointer rounded-lg border border-zinc-300" aria-label="เลือกสีเอง" />
        <div className="w-32">
          <input className={`${inputClass} font-mono`} value={text} maxLength={7} onChange={(e) => commit(e.target.value.trim())} aria-label="รหัสสี" />
        </div>
        <span className="rounded-full px-5 py-2 text-sm font-semibold text-white" style={{ background: preview }}>
          ตัวอย่างปุ่ม
        </span>
      </div>
      {valid && !readable && (
        <p className="mt-2 text-sm font-medium text-red-600">สีนี้อ่อนเกินไป ตัวหนังสือสีขาวบนปุ่มจะอ่านยาก ยังไม่ได้บันทึก ลองเลือกสีที่เข้มขึ้น</p>
      )}
    </Card>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

type SaveStatus = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

export function HomeEditor() {
  const toast = useToast();
  const [state, setState] = useState<HomeAdminState | null>(null);
  const [layout, setLayout] = useState<HomeLayout | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const pending = useRef<HomeLayout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([adminFetch<HomeAdminState>("home"), adminFetch<{ products: StoreProduct[] }>("products")])
      .then(([home, list]) => {
        setState(home);
        setLayout(home.draft);
        setProducts(list.products);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return true;
    pending.current = null;
    setSave({ kind: "saving" });
    try {
      const saved = await adminFetch<HomeAdminState>("home", { method: "PUT", json: next });
      // Keep local edits; only take the server's view of what is published.
      setState(saved);
      setSave(pending.current ? { kind: "saving" } : { kind: "saved" });
      return true;
    } catch (e) {
      setSave({ kind: "error", message: (e as Error).message });
      return false;
    }
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function update(next: HomeLayout) {
    setLayout(next);
    pending.current = next;
    setSave({ kind: "saving" });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }

  if (!state || !layout) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const blocks = layout.blocks;
  const setBlocks = (next: HomeBlock[]) => update({ ...layout, blocks: next });
  const setBlock = (i: number, block: HomeBlock) => setBlocks(blocks.map((b, j) => (j === i ? block : b)));
  const dirty = state.dirty || save.kind === "saving" || save.kind === "error";

  async function preview() {
    const tab = window.open("about:blank", "_blank");
    const ok = await flush();
    if (!ok) {
      tab?.close();
      toast("แก้ข้อผิดพลาดด้านบนก่อน แล้วค่อยดูตัวอย่าง", "error");
      return;
    }
    if (tab) tab.location.href = "/admin/home/preview";
    else window.location.href = "/admin/home/preview";
  }

  async function publish() {
    if (!(await flush())) {
      toast("แก้ข้อผิดพลาดด้านบนก่อน แล้วค่อยเผยแพร่", "error");
      return;
    }
    if (!window.confirm("เผยแพร่หน้าแรกนี้? ลูกค้าจะเห็นทันที")) return;
    setBusy(true);
    try {
      const saved = await adminFetch<HomeAdminState>("home/publish", { method: "POST" });
      setState(saved);
      toast("เผยแพร่หน้าแรกแล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!window.confirm("ทิ้งการแก้ไขทั้งหมดที่ยังไม่เผยแพร่ แล้วกลับไปเป็นแบบที่ลูกค้าเห็นอยู่ตอนนี้?")) return;
    clearTimeout(timer.current);
    pending.current = null;
    setBusy(true);
    try {
      const saved = await adminFetch<HomeAdminState>("home/discard", { method: "POST" });
      setState(saved);
      setLayout(saved.draft);
      setSave({ kind: "idle" });
      toast("กลับเป็นแบบที่เผยแพร่อยู่แล้ว");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function addBlock(type: HomeBlockType) {
    const block = newBlock(type);
    setBlocks([...blocks, block]);
    setOpenId(block.id);
    setAdding(false);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">ตกแต่งหน้าแรก</h1>
        <p className="text-sm text-zinc-500">จัดหน้าแรกของร้านจากบล็อกสำเร็จรูป แก้แล้วระบบบันทึกเป็นร่างให้เอง ลูกค้าจะเห็นก็ต่อเมื่อกด เผยแพร่</p>
      </div>

      <div className="sticky top-[57px] z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ${
            dirty ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-600"}`} />
          {dirty ? "มีการแก้ไขที่ยังไม่เผยแพร่" : "ตรงกับที่ลูกค้าเห็น"}
        </span>
        <span className="text-xs text-zinc-500" aria-live="polite">
          {save.kind === "saving" && "กำลังบันทึกร่าง..."}
          {save.kind === "saved" && "บันทึกร่างแล้ว"}
          {save.kind === "idle" && (state.publishedAt ? `เผยแพร่ล่าสุด ${formatThaiDateTime(state.publishedAt)}` : "ยังใช้หน้าแรกแบบเดิม")}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {state.dirty && (
            <Button variant="ghost" disabled={busy} onClick={discard}>
              ยกเลิกการแก้ไข
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={preview}>
            <Eye className="h-4 w-4" /> ดูตัวอย่าง
          </Button>
          <Button disabled={busy || !dirty} onClick={publish}>
            เผยแพร่
          </Button>
        </div>
        {save.kind === "error" && (
          <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">บันทึกร่างไม่สำเร็จ: {save.message}</p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-zinc-900">บล็อกในหน้าแรก (เรียงจากบนลงล่าง)</h2>
        {blocks.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500">
            ยังไม่มีบล็อก หน้าแรกจะว่างเปล่า กด ＋ เพิ่มบล็อก ด้านล่าง
          </p>
        )}
        {blocks.map((block, i) => {
          const info = BLOCK_INFO[block.type];
          const summary = summarize(block);
          const open = openId === block.id;
          return (
            <div
              key={block.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom.current !== null) setBlocks(move(blocks, dragFrom.current, i));
                dragFrom.current = null;
              }}
              className={`rounded-2xl border bg-white shadow-sm ${open ? "border-zinc-400" : "border-zinc-200"} ${block.hidden ? "opacity-60" : ""}`}
            >
              <div
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onClick={() => setOpenId(open ? null : block.id)}
                className="flex cursor-pointer items-center gap-2 p-3 sm:p-4"
              >
                <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-zinc-400" aria-hidden />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                  <info.icon className="h-5 w-5 text-zinc-700" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-900">
                    {info.label}
                    {block.hidden && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600">ซ่อนอยู่</span>}
                  </p>
                  {summary.warning ? (
                    <p className="truncate text-xs font-medium text-amber-700">{summary.warning}</p>
                  ) : (
                    summary.text && <p className="truncate text-xs text-zinc-500">{summary.text}</p>
                  )}
                </div>
                <IconButton label="เลื่อนขึ้น" icon={ArrowUp} disabled={i === 0} onClick={() => setBlocks(move(blocks, i, i - 1))} />
                <IconButton label="เลื่อนลง" icon={ArrowDown} disabled={i === blocks.length - 1} onClick={() => setBlocks(move(blocks, i, i + 1))} />
                <IconButton
                  label={block.hidden ? "แสดงบล็อกนี้" : "ซ่อนบล็อกนี้"}
                  icon={block.hidden ? EyeOff : Eye}
                  onClick={() => setBlock(i, { ...block, hidden: !block.hidden })}
                />
                <IconButton
                  label="ลบบล็อก"
                  icon={Trash2}
                  danger
                  onClick={() => window.confirm(`ลบบล็อก "${info.label}"?`) && setBlocks(blocks.filter((_, j) => j !== i))}
                />
                <ChevronDown className={`h-5 w-5 shrink-0 text-zinc-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
              </div>
              {open && (
                <div className="border-t border-zinc-100 p-4 sm:p-5">
                  <BlockForm block={block} onChange={(b) => setBlock(i, b)} products={products} />
                </div>
              )}
            </div>
          );
        })}

        {adding ? (
          <div className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center">
              <p className="mr-auto text-sm font-bold">เลือกชนิดบล็อก</p>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                ปิด
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(BLOCK_INFO) as HomeBlockType[]).map((type) => {
                const info = BLOCK_INFO[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addBlock(type)}
                    className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 text-left hover:border-zinc-500 hover:bg-zinc-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                      <info.icon className="h-5 w-5 text-zinc-700" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{info.label}</span>
                      <span className="block text-xs text-zinc-500">{info.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <Button variant="secondary" className="w-full border-dashed py-3" disabled={blocks.length >= MAX_BLOCKS} onClick={() => setAdding(true)}>
            ＋ เพิ่มบล็อก
          </Button>
        )}
      </section>

      <AccentPicker value={layout.accent} onChange={(accent) => update({ ...layout, accent })} />
    </div>
  );
}
