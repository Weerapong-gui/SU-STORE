import type { SaleState, StoreProduct } from "@/types/store";

export type ProductCard = {
  key: string;
  href: string;
  image: string;
  name: string;
  nameEn: string;
  code: string;
  productName: string;
  productNameEn: string;
  price: number | null;
  // True when the product's variants have different prices, so the card reads "from ฿X".
  priceFrom: boolean;
  soldOut: boolean;
  saleState: SaleState;
  saleStartsAt: string | null;
};

export function productCard(p: StoreProduct): ProductCard {
  return {
    key: `product-${p.id}`,
    href: `/products/${p.slug}`,
    image: p.images[0] || "",
    name: p.name,
    nameEn: p.nameEn,
    code: "",
    productName: p.name,
    productNameEn: p.nameEn,
    price: p.minPrice,
    priceFrom: p.minPrice !== p.maxPrice,
    soldOut: p.soldOut,
    saleState: p.saleState,
    saleStartsAt: p.saleStartsAt,
  };
}

export function designCards(products: StoreProduct[]): ProductCard[] {
  return products.flatMap((p) => {
    const card = productCard(p);
    if (p.optionKind === "options") return [card];
    return p.variants.filter((variant) => variant.active).map((variant) => ({
      ...card,
      key: `product-${p.id}-design-${variant.id}`,
      href: `${card.href}?design=${encodeURIComponent(variant.designCode.toLowerCase())}`,
      image: variant.image || card.image,
      name: variant.designName,
      nameEn: variant.designNameEn,
      code: variant.designCode,
      price: variant.price,
      priceFrom: false,
      soldOut: variant.soldOut,
    }));
  });
}

export function cardMatches(card: ProductCard, query: string): boolean {
  const search = query.trim().toLowerCase();
  return [card.name, card.nameEn, card.code, card.productName, card.productNameEn]
    .some((text) => text.toLowerCase().includes(search));
}
