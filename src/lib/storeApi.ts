import { DEFAULT_ACCENT } from "@/lib/accent";
import type { HomeLayout, ResolvedHome, StoreMeta, StoreProduct } from "@/types/store";
import { ORDER_API_BASE } from "@/lib/orderApi";

// Server-side reads of the public /v2 catalog (used by server components).

export async function getStoreProducts(): Promise<StoreProduct[]> {
  if (!ORDER_API_BASE) return [];
  try {
    const res = await fetch(`${ORDER_API_BASE}/v2/products`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { products: StoreProduct[] };
    return data.products ?? [];
  } catch {
    return [];
  }
}

export async function getStoreProduct(slug: string): Promise<StoreProduct | null> {
  if (!ORDER_API_BASE || !/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const res = await fetch(`${ORDER_API_BASE}/v2/products/${slug}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StoreProduct) : null;
  } catch {
    return null;
  }
}

export async function getStoreMeta(): Promise<StoreMeta | null> {
  if (!ORDER_API_BASE) return null;
  try {
    const res = await fetch(`${ORDER_API_BASE}/v2/meta`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StoreMeta) : null;
  } catch {
    return null;
  }
}

// Same as the order-api's DEFAULT_HOME: the original hero + all products. Used when
// nothing has been published yet or the API is unreachable.
export const DEFAULT_HOME: HomeLayout = {
  accent: DEFAULT_ACCENT,
  blocks: [
    {
      id: "hero",
      type: "hero",
      hidden: false,
      autoplay: true,
      slides: [{ image: "", eyebrow: "", title: "", subtitle: "", buttonText: "", buttonHref: "" }],
    },
    { id: "all-products", type: "allProducts", hidden: false, title: "" },
  ],
};

export async function getStoreHome(): Promise<ResolvedHome> {
  if (ORDER_API_BASE) {
    try {
      const res = await fetch(`${ORDER_API_BASE}/v2/home`, { cache: "no-store" });
      if (res.ok) return (await res.json()) as ResolvedHome;
    } catch {
      // fall through to the default layout
    }
  }
  return { ...DEFAULT_HOME, products: await getStoreProducts() };
}
