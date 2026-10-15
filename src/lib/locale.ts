// Pure helpers shared by Edge middleware, server and client components:
// no "use client", no next/headers, no browser globals.

export type Lang = "en" | "th";

export const LANG_COOKIE = "su_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LANG_HEADER = "x-su-lang";
export const PATH_HEADER = "x-su-path";
export const SITE_URL = "https://sumfu.store";

const THAI_PREFIX = "/th";
// Crawlers and link previewers must see the URL's own language, never a redirect.
// No "line/": the LINE in-app browser UA has it and carries real customers (LINE's
// preview crawler is already caught by facebookexternalhit).
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|preview/i;

export type LocaleDecision =
  | { kind: "redirect"; to: string }
  | { kind: "serve"; lang: Lang; path: string };

export function parseLang(value: string | null | undefined): Lang | null {
  return value === "en" || value === "th" ? value : null;
}

export function stripLocale(pathname: string): { lang: Lang; path: string } {
  if (pathname === THAI_PREFIX) return { lang: "th", path: "/" };
  if (pathname.startsWith(`${THAI_PREFIX}/`)) {
    return { lang: "th", path: pathname.slice(THAI_PREFIX.length) || "/" };
  }
  return { lang: "en", path: pathname };
}

/** `path` may carry a query string. English paths are returned unchanged. */
export function localePath(lang: Lang, path: string): string {
  if (lang === "en") return path;
  if (path === "/" || path.startsWith("/?")) return `${THAI_PREFIX}${path.slice(1)}`;
  return `${THAI_PREFIX}${path}`;
}

export function switchLocalePath(pathname: string, search: string, lang: Lang): string {
  return localePath(lang, `${stripLocale(pathname).path}${search}`);
}

export function preferredLang(acceptLanguage: string | null): Lang | null {
  if (!acceptLanguage?.trim()) return null;
  let best: { tag: string; q: number } | null = null;
  for (const part of acceptLanguage.split(",")) {
    const [tag, ...params] = part.trim().split(";");
    if (!tag) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    if (Number.isNaN(q)) continue;
    if (!best || q > best.q) best = { tag, q };
  }
  if (!best) return null;
  return best.tag.toLowerCase().split("-")[0] === "th" ? "th" : "en";
}

export function isBot(userAgent: string | null): boolean {
  return !!userAgent && BOT_PATTERN.test(userAgent);
}

/** `to` excludes the query string; middleware appends it. */
export function decideLocale(input: {
  pathname: string;
  cookie: string | undefined;
  acceptLanguage: string | null;
  userAgent: string | null;
}): LocaleDecision {
  const { lang: urlLang, path } = stripLocale(input.pathname);
  // A saved choice always wins; only the Accept-Language guess is skipped for bots.
  const wanted =
    parseLang(input.cookie) ?? (isBot(input.userAgent) ? null : preferredLang(input.acceptLanguage));
  if (wanted && wanted !== urlLang) return { kind: "redirect", to: localePath(wanted, path) };
  return { kind: "serve", lang: urlLang, path };
}

export function localeAlternates(
  lang: Lang,
  path: string,
): { canonical: string; languages: Record<"en" | "th" | "x-default", string> } {
  return {
    canonical: localePath(lang, path),
    languages: { en: path, th: localePath("th", path), "x-default": path },
  };
}

/** One-time migration of the old localStorage language choice into the cookie. */
export function legacyLangAction(
  stored: string | null,
  cookie: string | undefined,
  pathLang: Lang,
): { setCookie: Lang; navigate: boolean } | null {
  const storedLang = parseLang(stored);
  if (!storedLang || parseLang(cookie)) return null;
  return { setCookie: storedLang, navigate: storedLang !== pathLang };
}
