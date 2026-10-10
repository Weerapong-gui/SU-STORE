import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScheduleWarningBanner } from "@/components/ScheduleWarningBanner";
import { AnnouncementBar } from "@/components/store/AnnouncementBar";
import { accentVars, DEFAULT_ACCENT } from "@/lib/accent";
import { LanguageProvider } from "@/lib/i18n";

// Shared by the storefront and the /admin/home preview (which passes the draft accent).
export function StoreShell({ accent, announcement, children }: {
  accent?: string;
  announcement?: string;
  children: React.ReactNode;
}) {
  const style = accent && accent.toLowerCase() !== DEFAULT_ACCENT ? (accentVars(accent) as React.CSSProperties) : undefined;
  return (
    <LanguageProvider>
      <CartProvider>
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
