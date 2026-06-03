"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type SiteStatus = {
  siteClosed?: boolean;
  scheduleClosed?: boolean;
  beRightBack?: boolean;
};

export function MaintenancePolling({ reason }: { reason?: string }) {
  const router = useRouter();
  const isBeRightBack = reason === "beRightBack";

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

  return null;
}
