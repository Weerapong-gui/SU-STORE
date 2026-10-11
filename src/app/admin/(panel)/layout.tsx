import { AdminNav } from "@/components/admin/AdminNav";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { ToastProvider } from "@/components/admin/ui";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AdminNav />
        <main className="mx-auto max-w-6xl px-4 py-6 pb-28">{children}</main>
      </ConfirmProvider>
    </ToastProvider>
  );
}
