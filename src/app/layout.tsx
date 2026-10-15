import type { Metadata } from "next";
import "@/app/globals.css";
import { SITE_URL } from "@/lib/locale";
import { requestLang } from "@/lib/requestLocale";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SU STORE",
  description: "SU STORE Official store of the Mae Fah Luang University Student Union.",
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
    <html lang={requestLang()}>
      <body className="flex min-h-screen flex-col">
        {children}
      </body>
    </html>
  );
}
