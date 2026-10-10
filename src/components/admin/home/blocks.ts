import { GalleryHorizontal, LayoutGrid, PanelLeft, Star, Type, type LucideIcon } from "lucide-react";
import type { HeroSlide, HomeBlock, HomeBlockType } from "@/types/store";

// Limits mirror validate_home() in server/store/db.py (MAX_HOME_BLOCKS, MAX_HERO_SLIDES, MAX_FEATURED).
export const MAX_BLOCKS = 20;
export const MAX_SLIDES = 6;
export const MAX_FEATURED = 12;

export const BLOCK_INFO: Record<HomeBlockType, { label: string; icon: LucideIcon; description: string }> = {
  hero: { label: "แบนเนอร์", icon: GalleryHorizontal, description: "รูปใหญ่เต็มความกว้าง มีหัวข้อและปุ่ม ใส่ได้หลายรูปแล้วเลื่อนเป็นสไลด์" },
  featured: { label: "สินค้าแนะนำ", icon: Star, description: "เลือกสินค้าที่อยากโชว์เองว่าจะให้ขึ้นชิ้นไหนบ้าง" },
  text: { label: "ข้อความ", icon: Type, description: "หัวข้อกับย่อหน้าสั้นๆ เช่น วันรับของ หรือวิธีสั่งซื้อ" },
  imageText: { label: "รูปคู่ข้อความ", icon: PanelLeft, description: "รูปหนึ่งรูปวางข้างข้อความ เหมาะกับเล่าเรื่องสินค้าหรือกิจกรรม" },
  allProducts: { label: "สินค้าทั้งหมด", icon: LayoutGrid, description: "ตารางสินค้าที่เปิดขายทุกชิ้น เรียงตามลำดับในหน้าสินค้า" },
};

export const emptySlide = (): HeroSlide => ({ image: "", eyebrow: "", title: "", subtitle: "", buttonText: "", buttonHref: "" });

export function newBlock(type: HomeBlockType): HomeBlock {
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

const EMPTY_WARNING = "ยังว่างอยู่ จึงยังไม่แสดงในหน้าร้าน";

// One-line description of a block for its collapsed card, plus a warning when it won't show.
export function summarize(block: HomeBlock): { text: string; warning?: string } {
  switch (block.type) {
    case "hero": {
      const first = block.slides[0];
      const blank = block.slides.length === 1 && !first.image && !first.title && !first.subtitle;
      return { text: blank ? "ข้อความแนะนำร้านมาตรฐาน" : `${block.slides.length} สไลด์` };
    }
    case "featured":
      return block.productIds.length
        ? { text: `${block.productIds.length} ชิ้น${block.title ? ` · "${block.title}"` : ""}` }
        : { text: "", warning: "ยังไม่ได้เลือกสินค้า จึงยังไม่แสดงในหน้าร้าน" };
    case "text":
      return block.title || block.body ? { text: `"${(block.title || block.body).slice(0, 40)}"` } : { text: "", warning: EMPTY_WARNING };
    case "imageText":
      return block.image || block.title || block.body
        ? { text: block.title ? `"${block.title.slice(0, 40)}"` : "มีรูปแล้ว" }
        : { text: "", warning: EMPTY_WARNING };
    case "allProducts":
      return { text: block.title ? `"${block.title}"` : "" };
  }
}

/** Returns a copy of `list` with the item at `from` moved to `to` (unchanged if out of range). */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
