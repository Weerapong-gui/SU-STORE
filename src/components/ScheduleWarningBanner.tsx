"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStorePreview } from "@/components/store/StorePreview";
import { useLang } from "@/lib/i18n";
import { localePath } from "@/lib/locale";

type SiteStatus = {
  siteClosed?: boolean;
  scheduleClosed?: boolean;
  beRightBack?: boolean;
  scheduleEnabled?: boolean;
  scheduleWarning?: boolean;
  scheduleWarningMessage?: string;
  alwaysOpen?: boolean;
};

/** Bangkok time helpers (UTC+7, no DST) */
function bangkokTotalMinutes(): number {
  const bkkMs = Date.now() + 7 * 60 * 60 * 1000;
  const d = new Date(bkkMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function secondsUntilBangkok23(): number {
  const bkkMs = Date.now() + 7 * 60 * 60 * 1000;
  const d = new Date(bkkMs);
  const secondsSinceMidnight = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return Math.max(0, 23 * 3600 - secondsSinceMidnight);
}

const WARN_START_MIN = 22 * 60 + 50; // 22:50
const CLOSE_MIN = 23 * 60;           // 23:00

export function ScheduleWarningBanner() {
  const router = useRouter();
  const { t, lang } = useLang();
  const preview = useStorePreview();
  const [warning, setWarning] = useState(false);
  const [customMessage, setCustomMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/site-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SiteStatus;

      if (data.alwaysOpen) return;
      if (preview) {
        // The middleware decided preview per request; once the store reopens, re-render so
        // the preview bar and disabled buttons go away.
        const closed = data.siteClosed || data.scheduleClosed || data.beRightBack;
        if (!closed && preview === "closedStore") router.refresh();
        return;
      }
      if (data.siteClosed) { router.replace(localePath(lang, "/maintenance?reason=manual")); return; }
      if (data.scheduleClosed) { router.replace(localePath(lang, "/maintenance?reason=schedule")); return; }

      // API says warning (either schedule time or test warning)
      const apiWarning = data.scheduleWarning === true;
      // Client-side schedule check — fires immediately at 22:50 without needing poll
      const min = bangkokTotalMinutes();
      const clientWarning = data.scheduleEnabled === true && min >= WARN_START_MIN && min < CLOSE_MIN;

      if (apiWarning || clientWarning) {
        if (data.scheduleWarningMessage) setCustomMessage(data.scheduleWarningMessage);
        setSecondsLeft(secondsUntilBangkok23());
        setWarning(true);
      } else {
        setWarning(false);
      }
    } catch {
      // ignore network errors
    }
  }, [router, preview, lang]);

  // Poll every 10s so test-warning appears quickly
  useEffect(() => {
    checkStatus();
    const poll = setInterval(checkStatus, 10_000);
    return () => clearInterval(poll);
  }, [checkStatus]);

  // Re-check immediately when page becomes visible (handles Safari BFCache + tab switching)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") checkStatus(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) checkStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [checkStatus]);

  // Tick countdown every second
  useEffect(() => {
    if (!warning) return;
    const tick = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          router.replace(localePath(lang, "/maintenance?reason=schedule"));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [warning, router, lang]);

  if (!warning) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="sticky top-0 z-40 bg-amber-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-md">
      ⚠ {customMessage ?? t.schedule.defaultWarning}
      {" "}
      <span className="tabular-nums">
        {t.schedule.closingIn(mins, secs)}
      </span>
    </div>
  );
}
