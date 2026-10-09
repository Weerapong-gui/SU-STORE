import { AdminNav } from "@/components/admin/AdminNav";
import { ToastProvider } from "@/components/admin/ui";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminNav />
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28">{children}</main>
    </ToastProvider>
  );
}
