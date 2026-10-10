import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeBlocks } from "@/components/store/home/HomeBlocks";
import { StoreShell } from "@/components/store/StoreShell";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { getStoreMeta } from "@/lib/storeApi";
import type { ResolvedHome } from "@/types/store";
import { ORDER_API_BASE } from "@/lib/orderApi";

export const dynamic = "force-dynamic";

// The draft home page from /admin/home, rendered with the real storefront chrome.
export default async function HomePreviewPage() {
  const auth = cookies().get(ADMIN_COOKIE)?.value;
  if (!auth) redirect("/admin/login");
  const res = await fetch(`${ORDER_API_BASE}/v2/admin/home/preview`, { headers: { Authorization: auth }, cache: "no-store" });
  if (res.status === 401) redirect("/admin/login");
  if (!res.ok) throw new Error("โหลดตัวอย่างไม่สำเร็จ");
  const home = (await res.json()) as ResolvedHome;
  const meta = await getStoreMeta();

  return (
    <>
      <div className="sticky top-0 z-[60] bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-amber-950">
        ตัวอย่าง: ลูกค้ายังไม่เห็นหน้านี้ · กลับไปกด &quot;เผยแพร่&quot; ที่หลังร้านเมื่อพร้อม
      </div>
      <StoreShell accent={home.accent} announcement={meta?.announcement}>
        <HomeBlocks home={home} />
      </StoreShell>
    </>
  );
}
