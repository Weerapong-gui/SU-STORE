"use client";

import { Globe } from "lucide-react";
import { usePathname } from "next/navigation";
import { localePath, stripLocale, type Lang } from "@/lib/locale";
import { useLang } from "@/lib/i18n";

const LANGUAGE_LABELS: Record<Lang, string> = { en: "English", th: "ไทย" };
const ADMIN_PREFIX = "/admin";

export function LanguagePicker() {
  const { lang, setLang } = useLang();
  const path = stripLocale(usePathname()).path;
  // The admin home preview renders this footer too; /th/admin does not exist.
  const other: Lang | null = path.startsWith(ADMIN_PREFIX) ? null : lang === "en" ? "th" : "en";
  const order: Lang[] = ["en", "th"];

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <Globe className="h-4 w-4" aria-hidden="true" />
      {order
        .filter((code) => code === lang || code === other)
        .map((code, index) => (
          <span key={code} className="inline-flex items-center gap-2">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            {code === lang ? (
              <span aria-current="true" className="font-semibold text-white">
                {LANGUAGE_LABELS[code]}
              </span>
            ) : (
              <a
                href={localePath(code, path)}
                lang={code}
                hrefLang={code}
                onClick={(event) => {
                  event.preventDefault();
                  setLang(code);
                }}
                className="inline-flex min-h-11 items-center transition hover:text-white"
              >
                {LANGUAGE_LABELS[code]}
              </a>
            )}
          </span>
        ))}
    </div>
  );
}
