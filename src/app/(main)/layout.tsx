import { headers } from "next/headers";
import { StoreShell } from "@/components/store/StoreShell";
import { STORE_PREVIEW_HEADER } from "@/lib/storePreview";
import { getStoreMeta } from "@/lib/storeApi";

export default async function MainLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const meta = await getStoreMeta();
  // Set only by the middleware, for verified staff while the store is closed.
  const preview = headers().get(STORE_PREVIEW_HEADER) === "1" ? "closedStore" : null;
  return (
    <StoreShell accent={meta?.accent} radius={meta?.radius} font={meta?.font} announcement={meta?.announcement} preview={preview}>
      {children}
    </StoreShell>
  );
}
