// Storefront fonts staff can pick in /admin/home. Every family covers Thai and Latin.
// Ids must match HOME_FONTS in server/store/home.py.

export type StoreFont = { id: string; name: string; family: string; weights: string; serif?: boolean };

export const STORE_FONTS: StoreFont[] = [
  { id: "sarabun", name: "Sarabun (เดิม)", family: "Sarabun", weights: "400;500;600;700;800" },
  { id: "prompt", name: "Prompt", family: "Prompt", weights: "400;500;600;700;800" },
  { id: "kanit", name: "Kanit", family: "Kanit", weights: "400;500;600;700;800" },
  { id: "noto-sans-thai", name: "Noto Sans Thai", family: "Noto Sans Thai", weights: "400;500;600;700;800" },
  { id: "ibm-plex-sans-thai", name: "IBM Plex Sans Thai", family: "IBM Plex Sans Thai", weights: "400;500;600;700" },
  { id: "anuphan", name: "Anuphan", family: "Anuphan", weights: "400;500;600;700" },
  { id: "mitr", name: "Mitr", family: "Mitr", weights: "400;500;600;700" },
  { id: "chakra-petch", name: "Chakra Petch", family: "Chakra Petch", weights: "400;500;600;700" },
  { id: "bai-jamjuree", name: "Bai Jamjuree", family: "Bai Jamjuree", weights: "400;500;600;700" },
  { id: "pridi", name: "Pridi (มีเชิง)", family: "Pridi", weights: "400;500;600;700", serif: true },
];

export const DEFAULT_FONT = "sarabun";
// Same fallbacks as body in globals.css.
const SANS_FALLBACK = '"Sukhumvit Set", "Sukhumvit", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";

export function findFont(id: string | undefined | null): StoreFont {
  return STORE_FONTS.find((f) => f.id === id) ?? (STORE_FONTS[0] as StoreFont);
}

export function fontFamily(font: StoreFont): string {
  return `"${font.family}", ${font.serif ? SERIF_FALLBACK : SANS_FALLBACK}`;
}

const familyParam = (font: StoreFont, weights = font.weights) =>
  `family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@${weights}`;

// Full stylesheet for the storefront. Sarabun is already loaded by globals.css.
export function fontStylesheet(font: StoreFont): string | null {
  return font.id === DEFAULT_FONT ? null : `${GOOGLE_FONTS_CSS}?${familyParam(font)}&display=swap`;
}

// One small request for the picker: every family, regular weight, only the sample glyphs.
export function fontPreviewStylesheet(sample: string): string {
  const families = STORE_FONTS.map((f) => familyParam(f, "400;700")).join("&");
  return `${GOOGLE_FONTS_CSS}?${families}&text=${encodeURIComponent(sample)}&display=swap`;
}
