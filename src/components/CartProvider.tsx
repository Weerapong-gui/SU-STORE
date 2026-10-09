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
export const MAX_ITEM_QUANTITY = 50;

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hydrated: boolean;
  addItem: (item: CartItem) => void;
  setQuantity: (variantId: number, quantity: number) => void;
  removeItem: (variantId: number) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function readStored(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((i): i is CartItem => typeof i?.variantId === "number" && typeof i?.quantity === "number")
      : [];
  } catch {
    return [];
  }
}

const clamp = (q: number) => Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.floor(q)));

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readStored());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // storage blocked: cart lives for this tab only
    }
  }, [items, hydrated]);

  const addItem = useCallback((item: CartItem) => {
    setItems((list) => {
      const existing = list.find((i) => i.variantId === item.variantId);
      if (!existing) return [...list, { ...item, quantity: clamp(item.quantity) }];
      return list.map((i) =>
        i.variantId === item.variantId ? { ...item, quantity: clamp(i.quantity + item.quantity) } : i
      );
    });
  }, []);

  const setQuantity = useCallback((variantId: number, quantity: number) => {
    setItems((list) => list.map((i) => (i.variantId === variantId ? { ...i, quantity: clamp(quantity) } : i)));
  }, []);

  const removeItem = useCallback((variantId: number) => {
    setItems((list) => list.filter((i) => i.variantId !== variantId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      hydrated,
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [items, hydrated, addItem, setQuantity, removeItem, clearCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
