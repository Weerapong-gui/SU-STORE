import type { Metadata } from "next";
import "@/app/globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Fresher Package 28th",
  description: "เธฃเนเธฒเธเน€เธชเธทเนเธญเน€เธเธฃเธเธเธตเน SU STORE เธชเธณเธซเธฃเธฑเธเธชเธฑเนเธเธเธทเนเธญเน€เธชเธทเนเธญเน€เธ”เธตเนเธขเธงเนเธฅเธฐเธเธธเธ”เน€เธเธ•",
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
      <body>
        <CartProvider>
          <Navbar />
          <main>{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
