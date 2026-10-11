import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScheduleWarningBanner } from "@/components/ScheduleWarningBanner";
import { AnnouncementBar } from "@/components/store/AnnouncementBar";
import { accentVars, DEFAULT_ACCENT } from "@/lib/accent";
import { DEFAULT_FONT, findFont, fontFamily, fontStylesheet } from "@/lib/fonts";
import { DEFAULT_RADIUS, radiusVars } from "@/lib/radius";
import { LanguageProvider } from "@/lib/i18n";

// Shared by the storefront and the /admin/home preview (which passes the draft theme).
export function StoreShell({ accent, radius, font, announcement, children }: {
  accent?: string;
  radius?: number;
  font?: string;
  announcement?: string;
  children: React.ReactNode;
}) {
  const style = {
    ...(accent && accent.toLowerCase() !== DEFAULT_ACCENT ? accentVars(accent) : {}),
    ...(radius !== undefined && radius !== DEFAULT_RADIUS ? radiusVars(radius) : {}),
    ...(font && font !== DEFAULT_FONT ? { fontFamily: fontFamily(findFont(font)) } : {}),
  } as React.CSSProperties;
  const stylesheet = fontStylesheet(findFont(font));
  return (
    <LanguageProvider>
      <CartProvider>
        {stylesheet && <link rel="stylesheet" href={stylesheet} />}
        <div className="flex min-h-screen flex-col" style={style}>
          <AnnouncementBar text={announcement} />
          <Navbar />
          <ScheduleWarningBanner />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </CartProvider>
    </LanguageProvider>
  );
}
