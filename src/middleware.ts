import { NextRequest, NextResponse } from "next/server";

// ── Rate limiting ──────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

// ── Site-closed cache ──────────────────────────────────────────────────────────
// Edge Runtime modules may not be shared between requests so this is best-effort.
let siteClosedCache = { closed: false, reason: "", beRightBack: false, ts: 0 };
const SITE_STATUS_TTL = 15_000; // 15 seconds

const API_BASE = (process.env.ORDER_API_BASE_URL ?? "").replace(/\/$/, "");

// Hosts that bypass the admin site-closed gate and stay open at all times.
const ALWAYS_OPEN_HOSTS = new Set(["store.sumfu.xyz"]);

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Rate-limit POST /api/order ──────────────────────────────────────────────
  if (request.method === "POST" && pathname === "/api/order") {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      entry.count++;
      if (entry.count > MAX_REQUESTS) {
        return NextResponse.json(
          { success: false, message: "Too many requests. Please try again later." },
          { status: 429 }
        );
      }
    }
    return NextResponse.next();
  }

  // ── Site-closed check for page navigations ──────────────────────────────────
  const host = request.headers.get("host") ?? "";
  if (request.method === "GET" && isPageRequest(request) && !ALWAYS_OPEN_HOSTS.has(host)) {
    // Allow maintenance page itself through
    if (pathname === "/maintenance") {
      return NextResponse.next();
    }

    if (API_BASE) {
      const now = Date.now();
      if (now - siteClosedCache.ts > SITE_STATUS_TTL) {
        try {
          const ip =
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            request.headers.get("x-real-ip") ??
            "";
          const res = await fetch(
            `${API_BASE}/site-status?ip=${encodeURIComponent(ip)}`,
            { signal: AbortSignal.timeout(2000), cache: "no-store" }
          );
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

      if (siteClosedCache.closed) {
        return NextResponse.redirect(
          new URL(`/maintenance?reason=${siteClosedCache.reason}`, request.url)
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
