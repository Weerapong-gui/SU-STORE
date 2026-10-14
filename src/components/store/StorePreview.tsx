"use client";

import { createContext, useContext } from "react";
import { useStoreText } from "@/lib/storeI18n";

// "closedStore": staff browsing the storefront while it is closed (see lib/storePreview).
// "draftHome": the /admin/home draft preview. Both are read-only and must not be sent to
// /maintenance by the client-side status poll.
export type StorePreviewMode = "closedStore" | "draftHome";

const StorePreviewContext = createContext<StorePreviewMode | null>(null);

export function StorePreviewProvider({ mode, children }: { mode: StorePreviewMode | null; children: React.ReactNode }) {
  return <StorePreviewContext.Provider value={mode}>{children}</StorePreviewContext.Provider>;
}

export function useStorePreview(): StorePreviewMode | null {
  return useContext(StorePreviewContext);
}

export function StorePreviewBar() {
  const t = useStoreText();
  return (
    // Not sticky: the navbar sticks at top-0 too, and a sticky bar would cover its buttons while scrolling.
    <div className="bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-amber-950">
      {t.previewBar}
    </div>
  );
}
