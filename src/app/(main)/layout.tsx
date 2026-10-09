import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScheduleWarningBanner } from "@/components/ScheduleWarningBanner";
import { AnnouncementBar } from "@/components/store/AnnouncementBar";
import { LanguageProvider } from "@/lib/i18n";

export default function MainLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <LanguageProvider>
      <CartProvider>
        <AnnouncementBar />
        <Navbar />
        <ScheduleWarningBanner />
        <main className="flex-1">{children}</main>
        <Footer />
      </CartProvider>
    </LanguageProvider>
  );
}
