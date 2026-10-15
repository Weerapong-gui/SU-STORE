"use client";

import { useEffect } from "react";
import { readLangCookie, writeLangCookie } from "@/lib/langCookie";
import { legacyLangAction, stripLocale, switchLocalePath } from "@/lib/locale";
import { replaceLocation } from "@/lib/navigate";

// Temporary migration: visitors who picked a language before it moved into the URL still
// have it in localStorage. Carry it over to the cookie once, then drop the old key.
const LEGACY_LANG_KEY = "su-store-lang";

export function LegacyLangMigration() {
  useEffect(() => {
    const { pathname, search } = window.location;
    const action = legacyLangAction(
      localStorage.getItem(LEGACY_LANG_KEY),
      readLangCookie() ?? undefined,
      stripLocale(pathname).lang,
    );
    if (!action) return;
    writeLangCookie(action.setCookie);
    localStorage.removeItem(LEGACY_LANG_KEY);
    if (action.navigate) replaceLocation(switchLocalePath(pathname, search, action.setCookie));
  }, []);
  return null;
}
