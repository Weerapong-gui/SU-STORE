import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import { setVisitorCookie, siteStatusQuery, VISITOR_COOKIE, visitorId } from "@/lib/visitorId";

const ID = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://sumfu.store/", { headers });
}

describe("visitorId", () => {
  it("reads the id from the cookie", () => {
    expect(visitorId(request({ cookie: `${VISITOR_COOKIE}=${ID}` }))).toBe(ID);
    expect(visitorId(request())).toBeUndefined();
  });

  it("sets an httpOnly cookie", () => {
    const header = setVisitorCookie(NextResponse.next(), ID).headers.get("set-cookie") ?? "";
    expect(header).toContain(`${VISITOR_COOKIE}=${ID}`);
    expect(header.toLowerCase()).toContain("httponly");
  });

  it("sends both the id and the client ip to /site-status", () => {
    const params = new URLSearchParams(siteStatusQuery(request({ "cf-connecting-ip": "1.2.3.4" }), ID));
    expect(params.get("vid")).toBe(ID);
    expect(params.get("ip")).toBe("1.2.3.4");
  });

  it("sends an empty ip when it is unknown", () => {
    expect(new URLSearchParams(siteStatusQuery(request())).get("ip")).toBe("");
  });
});
