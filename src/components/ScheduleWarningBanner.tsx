"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SiteStatus = {
  siteClosed?: boolean;
  scheduleClosed?: boolean;
  scheduleWarning?: boolean;
  scheduleWarningMessage?: string;
};

function secondsUntilBangkok23(): number {
  // Bangkok = UTC+7, close at 23:00:00
  const now = new Date();
  const utcMs = now.getTime();
  const bkkOffset = 7 * 60 * 60 * 1000;
  const bkkMs = utcMs + bkkOffset;
  const bkkDate = new Date(bkkMs);
  const h = bkkDate.getUTCHours();
  const m = bkkDate.getUTCMinutes();
  const s = bkkDate.getUTCSeconds();
  const secondsSinceMidnight = h * 3600 + m * 60 + s;
  const closeAt = 23 * 3600;
  return Math.max(0, closeAt - secondsSinceMidnight);
}

export function ScheduleWarningBanner() {
  const router = useRouter();
  const [warning, setWarning] = useState(false);
  const [message, setMessage] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/site-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as SiteStatus;

      if (data.siteClosed) { router.replace("/maintenance?reason=manual"); return; }
      if (data.scheduleClosed) { router.replace("/maintenance?reason=schedule"); return; }

      const isWarning = data.scheduleWarning === true;
      setWarning(isWarning);
      if (isWarning) {
        setMessage(data.scheduleWarningMessage ?? "เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59");
        setSecondsLeft(secondsUntilBangkok23());
      }
    } catch {
      // ignore network errors
    }
  }, [router]);

  useEffect(() => {
    checkStatus();
    const poll = setInterval(checkStatus, 30_000);
    return () => clearInterval(poll);
  }, [checkStatus]);

  // Tick down every second
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
  const secs = secondsLeft % 60;

  return (
    <div className="sticky top-0 z-40 bg-amber-500 px-4 py-3 text-center text-sm font-semibold text-white shadow-md">
      ⚠ {message}
      {" — "}
      <span className="tabular-nums">
        ปิดใน {mins} นาที {String(secs).padStart(2, "0")} วินาที
      </span>
    </div>
  );
}
