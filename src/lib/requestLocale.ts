import { headers } from "next/headers";
import { LANG_HEADER, PATH_HEADER, parseLang, type Lang } from "@/lib/locale";

// Both headers are set by the middleware (client-sent copies are stripped there). Pages
// that skip the locale step, such as /admin, have neither and fall back to English.
export function requestLang(): Lang {
  return parseLang(headers().get(LANG_HEADER)) ?? "en";
}

export function requestPath(): string {
  return headers().get(PATH_HEADER) || "/";
}
