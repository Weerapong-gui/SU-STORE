"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SiteStatus = {
  siteClosed?: boolean;
  scheduleClosed?: boolean;
  beRightBack?: boolean;
};

export function MaintenanceClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");
  const isSchedule = reason === "schedule";
  const isBeRightBack = reason === "beRightBack";

  const horizontal = isBeRightBack
    ? "/images/anc/BE_RIGHT_BACK_horizontal.png"
    : isSchedule
    ? "/images/anc/STAY_TUNED_horizontal.png"
    : "/images/anc/BE_BACK_horizontal.png";
  const vertical = isBeRightBack
    ? "/images/anc/BE_RIGHT_BACK_vertical.png"
    : isSchedule
    ? "/images/anc/STAY_TUNED_vertical.png"
    : "/images/anc/BE_BACK_vertical.png";

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/site-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as SiteStatus;
        if (!data.siteClosed && !data.scheduleClosed && !data.beRightBack) {
          router.replace("/");
        }
      } catch {
        // ignore
      }
    };

    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, [router, isBeRightBack]);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* Landscape */}
      <div className="relative hidden h-full w-full [@media(orientation:landscape)]:block">
        <Image src={horizontal} alt="We'll be back" fill className="object-cover" priority />
      </div>
      {/* Portrait */}
      <div className="relative h-full w-full [@media(orientation:landscape)]:hidden">
        <Image src={vertical} alt="We'll be back" fill className="object-cover" priority />
      </div>
    </div>
  );
}
