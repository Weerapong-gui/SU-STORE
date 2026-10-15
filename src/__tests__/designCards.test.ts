import { describe, expect, it } from "vitest";
import { cardMatches, designCards, productCard } from "@/lib/designCards";
import type { StoreProduct, StoreVariant } from "@/types/store";

const variant = (id: number, code: string, overrides: Partial<StoreVariant> = {}): StoreVariant => ({
  id, size: "", color: "", label: code, price: 99, stock: 3, sku: "", active: true, soldOut: false,
  designCode: code, designName: "วิทยาศาสตร์เครื่องสำอาง", designNameEn: "Cosmetic Science", image: "",
  images: overrides.image ? [overrides.image] : [], ...overrides,
});
const product: StoreProduct = {
  id: 1, slug: "keychain", name: "พวงกุญแจ", nameEn: "Keychain", categoryId: 2, optionKind: "designs",
  description: "", images: ["/product.jpg"], status: "active", buyerFields: [], sortOrder: 0,
  saleStartsAt: null, saleEndsAt: null, saleState: "open", minPrice: 99, maxPrice: 99, soldOut: false,
  variants: [variant(1, "SCS", { image: "/scs.jpg" }), variant(2, "LAW", { soldOut: true }), variant(3, "OLD", { active: false })],
  createdAt: "", updatedAt: "",
};

describe("design cards", () => {
  it("expands active designs with individual links, images and stock", () => {
    const cards = designCards([product]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ href: "/products/keychain?design=scs", image: "/scs.jpg", code: "SCS", price: 99, soldOut: false });
    expect(cards[1]).toMatchObject({ image: "/product.jpg", soldOut: true });
    expect(new Set(cards.map((card) => card.key)).size).toBe(2);
  });
  it("marks price ranges as from-prices only on product cards", () => {
    expect(productCard({ ...product, maxPrice: 150 }).priceFrom).toBe(true);
    expect(designCards([{ ...product, maxPrice: 150 }])[0].priceFrom).toBe(false);
  });
  it("matches trimmed case-insensitive design and product text", () => {
    const [scsCard] = designCards([product]);
    expect(cardMatches(scsCard, "scs")).toBe(true);
    expect(cardMatches(scsCard, " Cosmetic ")).toBe(true);
    expect(cardMatches(scsCard, "dent")).toBe(false);
    expect(cardMatches(scsCard, " KEYCHAIN ")).toBe(true);
    expect(cardMatches(scsCard, "พวงกุญแจ")).toBe(true);
    expect(cardMatches(scsCard, "วิทยาศาสตร์")).toBe(true);
    expect(cardMatches(scsCard, "  ")).toBe(true);
  });
  it("keeps one product card for either kind and for options expansion", () => {
    const options = { ...product, optionKind: "options" as const };
    expect(designCards([options])).toEqual([productCard(options)]);
    expect(productCard(product)).toMatchObject({ href: "/products/keychain", image: "/product.jpg", name: "พวงกุญแจ", nameEn: "Keychain", price: 99, code: "" });
    expect(productCard({ ...options, images: [], minPrice: null }).image).toBe("");
    expect(designCards([{ ...product, variants: [] }])).toEqual([]);
  });
});
