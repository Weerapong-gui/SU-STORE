import type { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/clientIp";

// Anonymous random id used only to count "visitors online" (no personal data, so it
// is a strictly-necessary cookie under PDPA). Students on one campus/mobile IP would
// otherwise be counted as a single visitor. Read server-side only.
export const VISITOR_COOKIE = "su_vid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function visitorId(request: NextRequest): string | undefined {
  return request.cookies.get(VISITOR_COOKIE)?.value;
}

export function setVisitorCookie(response: NextResponse, id: string): NextResponse {
  response.cookies.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS
  });
  return response;
}

// Query string for the order-api's /site-status heartbeat (it validates both values).
export function siteStatusQuery(request: NextRequest, id = visitorId(request)): string {
  const ip = clientIp(request);
  const params = new URLSearchParams({ vid: id ?? "", ip: ip === "unknown" ? "" : ip });
  return params.toString();
}
