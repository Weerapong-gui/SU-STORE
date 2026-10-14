import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { clientIp } from "@/lib/clientIp";
import { ORDER_API_BASE } from "@/lib/orderApi";
import { consume, type RateLimitStore } from "@/lib/rateLimitCore";
import { adminCookie, isStaffSession, PREVIEW_ORDER_BLOCKED_MESSAGE, STORE_PREVIEW_HEADER, storeGate } from "@/lib/storePreview";
import { setVisitorCookie, siteStatusQuery, visitorId } from "@/lib/visitorId";

// ── Rate limiting (order creation / lookup) ───────────────────────────────────
const orderRateLimits: RateLimitStore = {};
const MAX_ORDER_REQUESTS = 10;

// ── Site-closed cache ──────────────────────────────────────────────────────────
// Edge Runtime modules may not be shared between requests so this is best-effort.
let siteClosedCache = { closed: false, reason: "", beRightBack: false, ts: 0 };
const SITE_STATUS_TTL = 15_000; // 15 seconds

const BYPASS_TOKEN = process.env.BYPASS_TOKEN ?? "";
const ALWAYS_OPEN = process.env.ALWAYS_OPEN === "1";
const STAGING_HOST = process.env.STAGING_HOST ?? "";

function isPageRequest(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/favicon")
  ) {
    return false;
  }
  // Skip static file extensions
  if (/\.(ico|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|otf|css|js|map)$/.test(pathname)) {
    return false;
  }
  return true;
}

function isAlwaysOpen(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  return ALWAYS_OPEN || (STAGING_HOST !== "" && host.startsWith(STAGING_HOST));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin pages: require a staff session, never show the store-closed page ──
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname !== "/admin/login" && !request.cookies.get(ADMIN_COOKIE)?.value) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  const hasBypass = BYPASS_TOKEN !== "" && request.cookies.get("bypass_gate")?.value === "1";

  // ── Rate-limit order creation and order lookup ──────────────────────────────
  if (request.method === "POST" && (pathname === "/api/store/orders" || pathname === "/api/store/orders/lookup")) {
    // Staff previewing the closed store must not create real orders.
    if (pathname === "/api/store/orders" && adminCookie(request) && !hasBypass && !isAlwaysOpen(request) && (await siteClosedReason(request))) {
      return NextResponse.json({ success: false, message: PREVIEW_ORDER_BLOCKED_MESSAGE }, { status: 403 });
    }
    if (consume(orderRateLimits, clientIp(request), MAX_ORDER_REQUESTS) === "limited") {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }
    return NextResponse.next();
  }

  // ── Always-open deployments (store.sumfu.xyz / Docker) ─────────────────────
  if (isAlwaysOpen(request)) return NextResponse.next();

  // ── Bypass token ────────────────────────────────────────────────────────────
  if (BYPASS_TOKEN && request.method === "GET") {
    const urlToken = request.nextUrl.searchParams.get("token");
    if (urlToken === BYPASS_TOKEN) {
      const url = request.nextUrl.clone();
      url.searchParams.delete("token");
      const res = NextResponse.redirect(url);
      res.cookies.set("bypass_gate", "1", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
      return res;
    }
  }

  // ── Page navigations: visitor cookie + site-closed check ─────────────────────
  if (request.method === "GET" && isPageRequest(request)) {
    const existingId = visitorId(request);
    const id = existingId ?? crypto.randomUUID();
    const response = hasBypass ? pageResponse(request, false) : await gatedPageResponse(request, id);
    return existingId ? response : setVisitorCookie(response, id);
  }

  return NextResponse.next();
}

// Page navigations: rewrite to /maintenance while the store is closed, except for
// signed-in staff, who get a read-only preview.
async function gatedPageResponse(request: NextRequest, visitorIdValue: string): Promise<NextResponse> {
  const reason = await siteClosedReason(request, visitorIdValue);
  const gate = storeGate({
    closed: reason !== "",
    staff: reason !== "" && (await isStaffSession(request)),
    pathname: request.nextUrl.pathname
  });
  if (gate === "closed") {
    return NextResponse.rewrite(new URL(`/maintenance?reason=${reason}`, request.url));
  }
  return pageResponse(request, gate === "preview");
}

// The layout trusts the preview flag, so never pass through a client-sent copy.
function pageResponse(request: NextRequest, preview: boolean): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(STORE_PREVIEW_HEADER);
  if (preview) headers.set(STORE_PREVIEW_HEADER, "1");
  return NextResponse.next({ request: { headers } });
}

// Why the store is closed ("" = open), cached for SITE_STATUS_TTL.
async function siteClosedReason(request: NextRequest, visitorIdValue?: string): Promise<string> {
  if (request.nextUrl.pathname === "/maintenance" || !ORDER_API_BASE) return "";

  const now = Date.now();
  if (now - siteClosedCache.ts > SITE_STATUS_TTL) {
    try {
      const res = await fetch(`${ORDER_API_BASE}/site-status?${siteStatusQuery(request, visitorIdValue)}`, {
        signal: AbortSignal.timeout(2000),
        cache: "no-store"
      });
      if (res.ok) {
        const data = (await res.json()) as { siteClosed?: boolean; scheduleClosed?: boolean; beRightBack?: boolean };
        const brb = data.beRightBack === true;
        const closed = brb || data.siteClosed === true || data.scheduleClosed === true;
        const reason = brb ? "beRightBack" : data.siteClosed ? "manual" : data.scheduleClosed ? "schedule" : "";
        siteClosedCache = { closed, reason, beRightBack: brb, ts: now };
      }
    } catch {
      // Fail open — don't block if API unreachable
    }
  }

  return siteClosedCache.closed ? siteClosedCache.reason : "";
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
