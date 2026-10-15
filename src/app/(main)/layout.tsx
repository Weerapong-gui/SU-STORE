import type { Metadata } from "next";
import { headers } from "next/headers";
import { LegacyLangMigration } from "@/components/LegacyLangMigration";
import { StoreShell } from "@/components/store/StoreShell";
import { localeAlternates } from "@/lib/locale";
import { requestLang, requestPath } from "@/lib/requestLocale";
import { STORE_PREVIEW_HEADER } from "@/lib/storePreview";
import { getStoreMeta } from "@/lib/storeApi";

export function generateMetadata(): Metadata {
  return { alternates: localeAlternates(requestLang(), requestPath()) };
}

export default async function MainLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const meta = await getStoreMeta();
  // Set only by the middleware, for verified staff while the store is closed.
  const preview = headers().get(STORE_PREVIEW_HEADER) === "1" ? "closedStore" : null;
  return (
    <StoreShell
      accent={meta?.accent}
      radius={meta?.radius}
      font={meta?.font}
      announcement={meta?.announcement}
      preview={preview}
      lang={requestLang()}
    >
      {/* Here, not in StoreShell: the admin draft preview must never migrate or redirect. */}
      <LegacyLangMigration />
      {children}
    </StoreShell>
  );
}
