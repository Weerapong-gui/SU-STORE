"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

// One line per product variant. Price is for display only; the server reprices on order.
export type CartItem = {
  variantId: number;
  productSlug: string;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  image: string;
  quantity: number;
};

const STORAGE_KEY = "su-store-cart-v2";
const CHECKOUT_ID_KEY = "su-store-checkout-id";
export const MAX_ITEM_QUANTITY = 50;
export const MAX_CART_LINES = 20; // server: MAX_ITEMS_PER_ORDER

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hydrated: boolean;
  /** Same value for one unchanged cart, across tabs and retries; the server uses it to
   * return the existing order instead of creating a duplicate. */
  checkoutId: string;
  addItem: (item: CartItem) => void;
  setQuantity: (variantId: number, quantity: number) => void;
  removeItem: (variantId: number) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const clamp = (q: number) => Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.floor(q)));

// localStorage is user-editable and may hold carts from older versions: keep only
// well-formed lines, one per variant.
function readStored(): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    const items: CartItem[] = [];
    for (const i of parsed) {
      if (!Number.isInteger(i?.variantId) || !Number.isFinite(i?.quantity) || seen.has(i.variantId)) continue;
      seen.add(i.variantId);
      items.push({
        variantId: i.variantId,
        productSlug: typeof i.productSlug === "string" ? i.productSlug : "",
        productName: typeof i.productName === "string" ? i.productName : "",
        variantLabel: typeof i.variantLabel === "string" ? i.variantLabel : "",
        unitPrice: Number.isFinite(i.unitPrice) ? i.unitPrice : 0,
        image: typeof i.image === "string" ? i.image : "",
        quantity: clamp(i.quantity),
      });
    }
    return items;
  } catch {
    return [];
  }
}

function newCheckoutId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function readCheckoutId(): string {
  try {
    const stored = localStorage.getItem(CHECKOUT_ID_KEY);
    if (stored && /^[A-Za-z0-9-]{16,64}$/.test(stored)) return stored;
  } catch {
    // ignore
  }
  return newCheckoutId();
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [checkoutId, setCheckoutId] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readStored());
    setCheckoutId(readCheckoutId());
    setHydrated(true);
    // Keep tabs in step: after an order in one tab, the others must not still hold the
    // old cart.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(readStored());
      if (e.key === CHECKOUT_ID_KEY) setCheckoutId(readCheckoutId());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(CHECKOUT_ID_KEY, checkoutId);
    } catch {
      // storage blocked: cart lives for this tab only
    }
  }, [items, checkoutId, hydrated]);

  // Any change to the cart makes it a different checkout.
  const changed = useCallback(() => setCheckoutId(newCheckoutId()), []);

  const addItem = useCallback((item: CartItem) => {
    changed();
    setItems((list) => {
      const existing = list.find((i) => i.variantId === item.variantId);
      if (!existing) return [...list, { ...item, quantity: clamp(item.quantity) }];
      return list.map((i) =>
        i.variantId === item.variantId ? { ...item, quantity: clamp(i.quantity + item.quantity) } : i
      );
    });
  }, [changed]);

  const setQuantity = useCallback((variantId: number, quantity: number) => {
    changed();
    setItems((list) => list.map((i) => (i.variantId === variantId ? { ...i, quantity: clamp(quantity) } : i)));
  }, [changed]);

  const removeItem = useCallback((variantId: number) => {
    changed();
    setItems((list) => list.filter((i) => i.variantId !== variantId));
  }, [changed]);

  const clearCart = useCallback(() => {
    changed();
    setItems([]);
  }, [changed]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      hydrated,
      checkoutId,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [items, hydrated, checkoutId, addItem, setQuantity, removeItem, clearCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
