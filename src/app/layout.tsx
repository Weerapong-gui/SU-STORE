import type { Metadata } from "next";
import "@/app/globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ScheduleWarningBanner } from "@/components/ScheduleWarningBanner";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Fresher Package 28th",
  description: "SU STORE — Fresher shirt store for ordering individual shirts and sets",
  icons: {
    icon: [
      { url: "/images/LOGO-01.png", media: "(prefers-color-scheme: light)" },
      { url: "/images/LOGO-02.png", media: "(prefers-color-scheme: dark)" }
    ]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <LanguageProvider>
          <CartProvider>
            <Navbar />
            <ScheduleWarningBanner />
            <main className="flex-1">{children}</main>
            <Footer />
          </CartProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
