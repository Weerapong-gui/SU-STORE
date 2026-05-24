import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = (process.env.ORDER_API_BASE_URL ?? "").replace(/\/$/, "");
const ALWAYS_OPEN = process.env.ALWAYS_OPEN === "1";

export async function GET(request: NextRequest) {
  if (ALWAYS_OPEN) {
    return NextResponse.json({ siteClosed: false, scheduleClosed: false, beRightBack: false, alwaysOpen: true, activeVisitors: 0 });
  }
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "";

  try {
    const url = API_BASE
      ? `${API_BASE}/site-status?ip=${encodeURIComponent(ip)}`
      : null;

    if (!url) {
      return NextResponse.json({ siteClosed: false, activeVisitors: 0 });
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store"
    });

    if (!res.ok) {
      return NextResponse.json({ siteClosed: false, activeVisitors: 0 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ siteClosed: false, activeVisitors: 0 });
  }
}
