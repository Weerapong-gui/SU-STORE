import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, parseLang, type Lang } from "@/lib/locale";

// Browser-only. Not httpOnly on purpose: the client writes it when the visitor picks a
// language, and the middleware reads it to choose between "/..." and "/th/...".
export function writeLangCookie(lang: Lang): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${lang}; Max-Age=${LANG_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

export function readLangCookie(): Lang | null {
  const prefix = `${LANG_COOKIE}=`;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return parseLang(entry?.slice(prefix.length));
}
