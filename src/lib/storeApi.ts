import type { StoreMeta, StoreProduct } from "@/types/store";

// Server-side reads of the public /v2 catalog (used by server components).
const API_BASE = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function getStoreProducts(): Promise<StoreProduct[]> {
  if (!API_BASE) return [];
  try {
    const res = await fetch(`${API_BASE}/v2/products`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { products: StoreProduct[] };
    return data.products ?? [];
  } catch {
    return [];
  }
}

export async function getStoreProduct(slug: string): Promise<StoreProduct | null> {
  if (!API_BASE || !/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const res = await fetch(`${API_BASE}/v2/products/${slug}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StoreProduct) : null;
  } catch {
    return null;
  }
}

export async function getStoreMeta(): Promise<StoreMeta | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/v2/meta`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StoreMeta) : null;
  } catch {
    return null;
  }
}
