"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";

type SiteStatus = {
  siteClosed?: boolean;
  scheduleClosed?: boolean;
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
  const { t } = useLang();
  const [warning, setWarning] = useState(false);
  const [customMessage, setCustomMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/site-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SiteStatus;

      if (data.alwaysOpen) return;
      if (data.siteClosed) { router.replace("/maintenance?reason=manual"); return; }
      if (data.scheduleClosed) { router.replace("/maintenance?reason=schedule"); return; }

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
  }, [router]);

  // Poll every 10s so test-warning appears quickly
  useEffect(() => {
    checkStatus();
    const poll = setInterval(checkStatus, 10_000);
    return () => clearInterval(poll);
  }, [checkStatus]);

  // Tick countdown every second
  useEffect(() => {
    if (!warning) return;
    const tick = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          router.replace("/maintenance?reason=schedule");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [warning, router]);

  if (!warning) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="sticky top-0 z-40 bg-amber-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-md">
      ⚠ {customMessage ?? t.schedule.defaultWarning}
      {" — "}
      <span className="tabular-nums">
        {t.schedule.closingIn(mins, secs)}
      </span>
    </div>
  );
}
