import { describe, expect, it } from "vitest";
import { DEFAULT_FONT, findFont, fontFamily, fontPreviewStylesheet, fontStylesheet, STORE_FONTS } from "@/lib/fonts";

describe("fonts", () => {
  it("falls back to the default font for unknown ids", () => {
    expect(findFont("comic-sans").id).toBe(DEFAULT_FONT);
    expect(findFont(undefined).id).toBe(DEFAULT_FONT);
  });

  it("builds the Google Fonts URL for the chosen family", () => {
    expect(fontStylesheet(findFont("noto-sans-thai"))).toBe(
      "https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap"
    );
  });

  it("does not load Sarabun twice", () => {
    expect(fontStylesheet(findFont(DEFAULT_FONT))).toBeNull();
  });

  it("uses a serif fallback only for serif fonts", () => {
    expect(fontFamily(findFont("pridi"))).toMatch(/serif$/);
    expect(fontFamily(findFont("kanit"))).toMatch(/sans-serif$/);
  });

  it("previews every family in one request", () => {
    const url = fontPreviewStylesheet("กข Aa");
    expect(url.match(/family=/g)).toHaveLength(STORE_FONTS.length);
    expect(url).toContain("text=");
  });
});
