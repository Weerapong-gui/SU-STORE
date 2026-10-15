import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScheduleWarningBanner } from "@/components/ScheduleWarningBanner";
import { AnnouncementBar } from "@/components/store/AnnouncementBar";
import { StorePreviewBar, StorePreviewProvider, type StorePreviewMode } from "@/components/store/StorePreview";
import { accentVars, DEFAULT_ACCENT } from "@/lib/accent";
import { DEFAULT_FONT, findFont, fontFamily, fontStylesheet } from "@/lib/fonts";
import { DEFAULT_RADIUS, radiusVars } from "@/lib/radius";
import { LanguageProvider } from "@/lib/i18n";
import type { Lang } from "@/lib/locale";

// Shared by the storefront and the /admin/home preview (which passes the draft theme and
// no language, so it shows English).
export function StoreShell({ accent, radius, font, announcement, preview = null, lang = "en", children }: {
  accent?: string;
  radius?: number;
  font?: string;
  announcement?: string;
  preview?: StorePreviewMode | null;
  lang?: Lang;
  children: React.ReactNode;
}) {
  const style = {
    ...(accent && accent.toLowerCase() !== DEFAULT_ACCENT ? accentVars(accent) : {}),
    ...(radius !== undefined && radius !== DEFAULT_RADIUS ? radiusVars(radius) : {}),
    ...(font && font !== DEFAULT_FONT ? { fontFamily: fontFamily(findFont(font)) } : {}),
  } as React.CSSProperties;
  const stylesheet = fontStylesheet(findFont(font));
  return (
    <LanguageProvider lang={lang}>
      <StorePreviewProvider mode={preview}>
        <CartProvider>
          {stylesheet && <link rel="stylesheet" href={stylesheet} />}
          <div className="flex min-h-screen flex-col" style={style}>
            {preview === "closedStore" && <StorePreviewBar />}
            <AnnouncementBar text={announcement} />
            <Navbar />
            <ScheduleWarningBanner />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </CartProvider>
      </StorePreviewProvider>
    </LanguageProvider>
  );
}
