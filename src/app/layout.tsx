import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "SU STORE",
  description: "SU STORE · Official store of the Mae Fah Luang University Student Union.",
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
        {children}
      </body>
    </html>
  );
}
