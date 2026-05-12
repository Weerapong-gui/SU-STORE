"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  CART_STORAGE_KEY,
  clampCartQuantity,
  createCartItem,
  getCartItemCount,
  getCartSubtotal
} from "@/lib/cart";
import { CartItem } from "@/types/cart";
import { Product } from "@/types/product";

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hydrated: boolean;
  addItem: (product: Product, selection: { quantity: number; size?: string; school: string }) => void;
  replaceItem: (
    itemId: string,
    product: Product,
    selection: { quantity: number; size?: string; school: string }
  ) => void;
  removeItem: (itemId: string) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function readStoredCartItems() {
  if (typeof window === "undefined") {
    return [] as CartItem[];
  }

  try {
    const rawValue = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!rawValue) {
      return [] as CartItem[];
    }

    const parsedValue = JSON.parse(rawValue) as CartItem[];
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [] as CartItem[];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readStoredCartItems());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [hydrated, items]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) {
        setItems(readStoredCartItems());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo<CartContextValue>(() => {
    return {
      items,
      itemCount: getCartItemCount(items),
      subtotal: getCartSubtotal(items),
      hydrated,
      addItem: (product, selection) => {
        const nextItem = createCartItem(product, selection);

        setItems((currentItems) => {
          const matchingItem = currentItems.find(
            (item) =>
              item.productSlug === nextItem.productSlug &&
              item.size === nextItem.size &&
              item.school === nextItem.school
          );

          if (!matchingItem) {
            return [...currentItems, nextItem];
          }

          return currentItems.map((item) =>
            item.id === matchingItem.id
              ? {
                  ...item,
                  quantity: clampCartQuantity(item.quantity + nextItem.quantity)
                }
              : item
          );
        });
      },
      replaceItem: (itemId, product, selection) => {
        const nextItem = createCartItem(product, selection);

        setItems((currentItems) =>
          currentItems.map((item) =>
            item.id === itemId
              ? {
                  ...nextItem,
                  id: item.id,
                  addedAt: item.addedAt
                }
              : item
          )
        );
      },
      removeItem: (itemId) => {
        setItems((currentItems) => currentItems.filter((item) => item.id !== itemId));
      },
      updateItemQuantity: (itemId, quantity) => {
        setItems((currentItems) =>
          currentItems.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  quantity: clampCartQuantity(quantity)
                }
              : item
          )
        );
      },
      clearCart: () => {
        setItems([]);
      }
    };
  }, [hydrated, items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }

  return context;
}
