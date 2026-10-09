import { getStoreMeta } from "@/lib/storeApi";

// Staff-written notice from /admin/settings, shown above every storefront page.
export async function AnnouncementBar() {
  const meta = await getStoreMeta();
  const text = meta?.announcement?.trim();
  if (!text) return null;
  return (
    <div className="bg-apple-blue px-4 py-2.5 text-center text-sm font-medium text-white" role="status">
      {text}
    </div>
  );
}
