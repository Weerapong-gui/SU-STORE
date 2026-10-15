import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { clientIp } from "@/lib/clientIp";
import { ORDER_API_BASE } from "@/lib/orderApi";
import { decideLocale, LANG_COOKIE, LANG_HEADER, type Lang, PATH_HEADER } from "@/lib/locale";
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

// Uploaded images and files such as robots.txt or sitemap.xml exist once, not per language.
function isLocalizedPage(pathname: string): boolean {
  if (pathname.startsWith("/product-images/")) return false;
  return !(pathname.split("/").pop() ?? "").includes(".");
}

// Temporary: the target depends on the visitor, so browsers must not remember it.
const TEMPORARY_REDIRECT = 307;

type PageLocale = { lang: Lang; path: string };

// The redirect depends on this visitor's cookie and device, so shared caches must not keep it.
function localeRedirect(request: NextRequest, to: string): NextResponse {
  const res = NextResponse.redirect(new URL(to + request.nextUrl.search, request.url), TEMPORARY_REDIRECT);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Vary", "Cookie, Accept-Language");
  return res;
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

  // ── Language: redirect to the visitor's language, or serve /th/* from the shared pages ──
  const isPageGet = request.method === "GET" && isPageRequest(request);
  let locale: PageLocale | null = null;
  if (isPageGet && isLocalizedPage(pathname)) {
    const decision = decideLocale({
      pathname,
      cookie: request.cookies.get(LANG_COOKIE)?.value,
      acceptLanguage: request.headers.get("accept-language"),
      userAgent: request.headers.get("user-agent")
    });
    if (decision.kind === "redirect") return localeRedirect(request, decision.to);
    locale = { lang: decision.lang, path: decision.path };
  }

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

  // ── Always-open deployments (store.sumfu.xyz / Docker) ─────────────────────
  if (isAlwaysOpen(request)) return locale ? pageResponse(request, false, locale) : NextResponse.next();

  // ── Page navigations: visitor cookie + site-closed check ─────────────────────
  if (isPageGet) {
    const pageLocale = locale ?? { lang: "en", path: pathname };
    const existingId = visitorId(request);
    const id = existingId ?? crypto.randomUUID();
    const response = hasBypass ? pageResponse(request, false, pageLocale) : await gatedPageResponse(request, id, pageLocale);
    return existingId ? response : setVisitorCookie(response, id);
  }

  return NextResponse.next();
}

// Page navigations: rewrite to /maintenance while the store is closed, except for
// signed-in staff, who get a read-only preview.
async function gatedPageResponse(request: NextRequest, visitorIdValue: string, locale: PageLocale): Promise<NextResponse> {
  const reason = await siteClosedReason(request, visitorIdValue, locale.path);
  const gate = storeGate({
    closed: reason !== "",
    staff: reason !== "" && (await isStaffSession(request)),
    pathname: locale.path
  });
  if (gate === "closed") {
    // Keep the language headers so the closed page speaks the language of the URL.
    return NextResponse.rewrite(new URL(`/maintenance?reason=${reason}`, request.url), {
      request: { headers: pageHeaders(request, false, locale) }
    });
  }
  return pageResponse(request, gate === "preview", locale);
}

// Layouts trust these headers, so never pass through client-sent copies.
function pageHeaders(request: NextRequest, preview: boolean, locale: PageLocale): Headers {
  const headers = new Headers(request.headers);
  headers.delete(STORE_PREVIEW_HEADER);
  if (preview) headers.set(STORE_PREVIEW_HEADER, "1");
  // set() replaces any client-sent value.
  headers.set(LANG_HEADER, locale.lang);
  headers.set(PATH_HEADER, locale.path);
  return headers;
}

// Thai URLs render the same pages as English ones; only the headers differ.
function pageResponse(request: NextRequest, preview: boolean, locale: PageLocale): NextResponse {
  const headers = pageHeaders(request, preview, locale);
  if (locale.lang === "th") {
    return NextResponse.rewrite(new URL(locale.path + request.nextUrl.search, request.url), { request: { headers } });
  }
  return NextResponse.next({ request: { headers } });
}

// Why the store is closed ("" = open), cached for SITE_STATUS_TTL.
// `pathname` is the page path with any /th prefix removed.
async function siteClosedReason(request: NextRequest, visitorIdValue?: string, pathname = request.nextUrl.pathname): Promise<string> {
  if (pathname === "/maintenance" || !ORDER_API_BASE) return "";

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
