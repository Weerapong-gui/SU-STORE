import type { Metadata } from "next";
import "@/app/globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Fresher Package 28th",
  description: "ร้านเสื้อเฟรชเชอร์ SU STORE สำหรับสั่งซื้อเสื้อเดี่ยวและชุดเซต",
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
    <html lang="th">
      <body className="flex min-h-screen flex-col">
        <CartProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
