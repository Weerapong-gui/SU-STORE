import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "หลังร้าน · SU STORE",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div lang="th" className="min-h-screen bg-zinc-100 text-zinc-900 antialiased">{children}</div>;
}
