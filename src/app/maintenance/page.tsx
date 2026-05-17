"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MaintenancePage() {
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/site-status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { siteClosed?: boolean };
        if (!data.siteClosed) {
          router.replace("/");
        }
      } catch {
        // ignore network errors
      }
    };

    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* Landscape */}
      <div className="relative hidden h-full w-full [@media(orientation:landscape)]:block">
        <Image
          src="/images/anc/BE_BACK_horizontal.png"
          alt="We'll be back"
          fill
          className="object-cover"
          priority
        />
      </div>
      {/* Portrait */}
      <div className="relative h-full w-full [@media(orientation:landscape)]:hidden">
        <Image
          src="/images/anc/BE_BACK_vertical.png"
          alt="We'll be back"
          fill
          className="object-cover"
          priority
        />
      </div>
    </div>
  );
}
