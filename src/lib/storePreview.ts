import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { ORDER_API_BASE } from "@/lib/orderApi";

// While the store is closed, signed-in staff browse the storefront in a read-only
// "preview" so they can check it before opening. The middleware sets this request header
// (after stripping any client-sent copy) and the (main) layout reads it.
export const STORE_PREVIEW_HEADER = "x-su-store-preview";

export const PREVIEW_ORDER_BLOCKED_MESSAGE = "ร้านปิดอยู่ โหมดดูตัวอย่างสั่งซื้อไม่ได้";

// Pages that would let staff place a real order; they keep the closed page in preview.
const ORDER_PATHS = ["/checkout"];

export type StoreGate = "open" | "preview" | "closed";

export function storeGate({ closed, staff, pathname }: { closed: boolean; staff: boolean; pathname: string }): StoreGate {
  if (!closed) return "open";
  if (!staff) return "closed";
  const ordering = ORDER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return ordering ? "closed" : "preview";
}

// ── Staff session check ───────────────────────────────────────────────────────
// The cookie alone proves nothing (anyone can set one), so ask the order-api once and
// cache the answer briefly; each preview page load would otherwise add a round trip.
const SESSION_TTL_MS = 60_000;
const SESSION_CACHE_MAX = 200;
const SESSION_TIMEOUT_MS = 2000;
const sessionCache = new Map<string, { valid: boolean; ts: number }>();

export function adminCookie(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_COOKIE)?.value || undefined;
}

export async function isStaffSession(request: NextRequest, fetcher: typeof fetch = fetch): Promise<boolean> {
  const auth = adminCookie(request);
  if (!auth || !ORDER_API_BASE) return false;

  const now = Date.now();
  const cached = sessionCache.get(auth);
  if (cached && now - cached.ts < SESSION_TTL_MS) return cached.valid;

  let valid = false;
  try {
    const res = await fetcher(`${ORDER_API_BASE}/v2/admin/me`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
      cache: "no-store"
    });
    valid = res.ok;
  } catch {
    // Fail closed: if the order-api can't vouch for the session, show the closed page.
    return false;
  }
  if (sessionCache.size >= SESSION_CACHE_MAX) sessionCache.clear();
  sessionCache.set(auth, { valid, ts: now });
  return valid;
}
