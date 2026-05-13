import { getStoredProductSize, normalizeStandardProductSize, ProductSizeOption } from "@/lib/productSizing";
import { CartItem } from "@/types/cart";
import { Product } from "@/types/product";

export const CART_STORAGE_KEY = "su-store-cart";
export const CONFIGURE_INTENTS = ["payment", "cart"] as const;
export type ConfigureIntent = (typeof CONFIGURE_INTENTS)[number];

type BuyNowHrefOptions = {
  orderId?: string;
  productSlug?: string;
  size?: string;
  quantity?: number;
  school?: string;
  itemId?: string;
};

type CartEditHrefOptions = {
  itemId: string;
  productSlug: string;
  size?: string;
  quantity?: number;
  school?: string;
};

function isConfigureIntent(value: string | undefined): value is ConfigureIntent {
  return value === "payment" || value === "cart";
}

function createCartItemId() {
  return `cart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeConfigureIntent(value?: string): ConfigureIntent {
  return isConfigureIntent(value) ? value : "payment";
}

export function clampCartQuantity(quantity: number) {
  return Math.min(99, Math.max(1, quantity));
}

export function normalizeProductSize(product: Product, size?: string): ProductSizeOption {
  return normalizeStandardProductSize(product, size);
}

export function createConfiguratorHref(productSlug: string, intent: ConfigureIntent = "payment") {
  return `/products/${productSlug}/configure?intent=${intent}`;
}

export function createCartEditHref({
  itemId,
  productSlug,
  size,
  quantity,
  school
}: CartEditHrefOptions) {
  const searchParams = new URLSearchParams();
  searchParams.set("intent", "cart");
  searchParams.set("itemId", itemId);

  if (size) {
    searchParams.set("size", size);
  }
  if (typeof quantity === "number" && Number.isFinite(quantity)) {
    searchParams.set("quantity", String(clampCartQuantity(quantity)));
  }
  if (school) {
    searchParams.set("school", school);
  }

  return `/products/${productSlug}/configure?${searchParams.toString()}`;
}

export function createBuyNowHref({
  orderId,
  productSlug,
  size,
  quantity,
  school,
  itemId
}: BuyNowHrefOptions) {
  const searchParams = new URLSearchParams();

  if (orderId) {
    searchParams.set("orderId", orderId);
  }
  if (productSlug) {
    searchParams.set("product", productSlug);
  }
  if (size) {
    searchParams.set("size", size);
  }
  if (typeof quantity === "number" && Number.isFinite(quantity)) {
    searchParams.set("quantity", String(clampCartQuantity(quantity)));
  }
  if (school) {
    searchParams.set("school", school);
  }
  if (itemId) {
    searchParams.set("itemId", itemId);
  }

  const queryString = searchParams.toString();
  return queryString ? `/checkout/payment?${queryString}` : "/checkout/payment";
}

export function createCartItem(
  product: Product,
  selection: {
    quantity: number;
    size?: string;
    school: string;
    unitPriceOverride?: number;
  }
): CartItem {
  return {
    id: createCartItemId(),
    productSlug: product.slug,
    productName: product.name,
    productShortName: product.shortName,
    productImage: product.images[0],
    productCategory: product.category,
    unitPrice: selection.unitPriceOverride ?? product.price,
    quantity: clampCartQuantity(selection.quantity),
    size: getStoredProductSize(product, selection.size),
    school: selection.school,
    addedAt: new Date().toISOString()
  };
}

export function getCartItemCount(items: CartItem[]) {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function getCartSubtotal(items: CartItem[]) {
  return items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
}
