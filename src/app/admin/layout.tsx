import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Admin · SU STORE",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-zinc-100 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
