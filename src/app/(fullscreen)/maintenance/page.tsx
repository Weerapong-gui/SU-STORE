import { Suspense } from "react";
import Image from "next/image";
import { MaintenancePolling } from "./MaintenanceClient";
import { getStoreMeta } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

// One message per reason the middleware sends (see src/middleware.ts).
const COPY: Record<string, { th: string; en: string; thSub: string; enSub: string }> = {
  manual: {
    th: "ร้านปิดอยู่ตอนนี้",
    en: "The store is closed",
    thSub: "ยังไม่เปิดรับออเดอร์ แวะกลับมาใหม่อีกครั้งนะ",
    enSub: "We're not taking orders right now. Please check back soon.",
  },
  schedule: {
    th: "นอกเวลาเปิดร้าน",
    en: "Outside opening hours",
    thSub: "ร้านจะกลับมาเปิดตามเวลาที่แจ้งไว้",
    enSub: "The store will reopen at its scheduled time.",
  },
  beRightBack: {
    th: "พักร้านแป๊บนึง",
    en: "Be right back",
    thSub: "กำลังปรับปรุงระบบ เดี๋ยวกลับมา",
    enSub: "We're making a few updates and will be back shortly.",
  },
};

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: { reason?: string };
}) {
  const copy = COPY[searchParams.reason ?? ""] ?? COPY.manual;
  const announcement = (await getStoreMeta())?.announcement?.trim();

  return (
    <main className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#f5f5f7] px-6 py-12 text-center">
      <Image
        src="/images/SUSTORE.png"
        alt="SU STORE"
        width={1235}
        height={1009}
        priority
        sizes="96px"
        className="h-16 w-auto md:h-20"
      />

      <h1 className="mt-10 text-3xl font-semibold tracking-tight text-[#1d1d1f] md:text-5xl">{copy.th}</h1>
      <p className="mt-2 text-lg text-[#6e6e73] md:text-xl">{copy.en}</p>

      <p className="mt-6 max-w-md text-base text-[#1d1d1f]">{copy.thSub}</p>
      <p className="mt-1 max-w-md text-sm text-[#6e6e73]">{copy.enSub}</p>

      {announcement && (
        <div className="mt-8 max-w-md rounded-2xl bg-white px-6 py-4 text-sm font-medium text-[#1d1d1f] shadow-sm ring-1 ring-black/5">
          {announcement}
        </div>
      )}

      <p className="mt-12 text-xs text-[#86868b]">องค์การนักศึกษา มหาวิทยาลัยแม่ฟ้าหลวง</p>

      <Suspense>
        <MaintenancePolling reason={searchParams.reason} />
      </Suspense>
    </main>
  );
}
