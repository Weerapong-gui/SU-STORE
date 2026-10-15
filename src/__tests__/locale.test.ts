import { describe, expect, it } from "vitest";
import {
  decideLocale,
  isBot,
  legacyLangAction,
  localeAlternates,
  localePath,
  preferredLang,
  stripLocale,
  switchLocalePath,
} from "@/lib/locale";

describe("stripLocale / localePath", () => {
  it("splits the Thai prefix", () => {
    expect(stripLocale("/th")).toEqual({ lang: "th", path: "/" });
    expect(stripLocale("/th/")).toEqual({ lang: "th", path: "/" });
    expect(stripLocale("/th/products/abc")).toEqual({ lang: "th", path: "/products/abc" });
    expect(stripLocale("/thai")).toEqual({ lang: "en", path: "/thai" });
    expect(stripLocale("/products")).toEqual({ lang: "en", path: "/products" });
  });
  it("adds the prefix only for Thai", () => {
    expect(localePath("th", "/")).toBe("/th");
    expect(localePath("th", "/order/SU1?t=a")).toBe("/th/order/SU1?t=a");
    expect(localePath("en", "/checkout")).toBe("/checkout");
  });
  it("switches language and keeps the query", () => {
    expect(switchLocalePath("/order/SU1", "?t=abc", "th")).toBe("/th/order/SU1?t=abc");
    expect(switchLocalePath("/th/products/x", "", "en")).toBe("/products/x");
    expect(switchLocalePath("/th", "", "en")).toBe("/");
  });
});

describe("preferredLang / isBot", () => {
  it("reads the highest-q language", () => {
    expect(preferredLang("th-TH,th;q=0.9,en;q=0.8")).toBe("th");
    expect(preferredLang("en-US,th;q=0.9")).toBe("en");
    expect(preferredLang("en;q=0.5,th;q=0.9")).toBe("th");
    expect(preferredLang("ja-JP")).toBe("en");
    expect(preferredLang("")).toBeNull();
    expect(preferredLang(null)).toBeNull();
  });
  it("spots crawlers and link previewers", () => {
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "facebookexternalhit/1.1", "Twitterbot/1.0", "bingbot/2.0"]) {
      expect(isBot(ua)).toBe(true);
    }
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1")).toBe(false);
  });
  it("does not treat the LINE in-app browser as a bot", () => {
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/13.20.0")).toBe(false);
  });
});

describe("decideLocale", () => {
  const human = "Mozilla/5.0 (Macintosh) Safari/605.1";
  const decide = (pathname: string, cookie: string | undefined, acceptLanguage: string | null, userAgent: string | null = human) =>
    decideLocale({ pathname, cookie, acceptLanguage, userAgent });

  it("follows the saved choice over the URL", () => {
    expect(decide("/products/x", "th", "en")).toEqual({ kind: "redirect", to: "/th/products/x" });
    expect(decide("/th/products/x", "en", "th")).toEqual({ kind: "redirect", to: "/products/x" });
  });
  it("uses the device language on a first visit", () => {
    expect(decide("/", undefined, "th-TH")).toEqual({ kind: "redirect", to: "/th" });
    expect(decide("/th/x", undefined, "ja")).toEqual({ kind: "redirect", to: "/x" });
  });
  it("serves the URL when it already matches", () => {
    expect(decide("/th/x", "th", "en")).toEqual({ kind: "serve", lang: "th", path: "/x" });
    expect(decide("/x", undefined, "en-US")).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
  it("never redirects bots or requests without a language", () => {
    expect(decide("/th/x", undefined, "en", "Googlebot/2.1")).toEqual({ kind: "serve", lang: "th", path: "/x" });
    expect(decide("/x", undefined, null)).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
  it("lets a saved language win even for bot-looking user agents", () => {
    expect(decide("/x", "th", "en", "Googlebot/2.1")).toEqual({ kind: "redirect", to: "/th/x" });
    expect(decide("/x", undefined, "th", "Googlebot/2.1")).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
  it("ignores an unknown cookie value", () => {
    expect(decide("/x", "xx", "th")).toEqual({ kind: "redirect", to: "/th/x" });
    expect(decide("/x", "xx", "en")).toEqual({ kind: "serve", lang: "en", path: "/x" });
  });
});

describe("localeAlternates", () => {
  it("links both languages with English as x-default", () => {
    expect(localeAlternates("th", "/products/x")).toEqual({
      canonical: "/th/products/x",
      languages: { en: "/products/x", th: "/th/products/x", "x-default": "/products/x" },
    });
  });
});

describe("legacyLangAction", () => {
  it("moves the old localStorage choice into the cookie once", () => {
    expect(legacyLangAction("th", undefined, "en")).toEqual({ setCookie: "th", navigate: true });
    expect(legacyLangAction("en", undefined, "en")).toEqual({ setCookie: "en", navigate: false });
    expect(legacyLangAction("th", "en", "en")).toBeNull();
    expect(legacyLangAction(null, undefined, "en")).toBeNull();
    expect(legacyLangAction("xx", undefined, "en")).toBeNull();
  });
});
