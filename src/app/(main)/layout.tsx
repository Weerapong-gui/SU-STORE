import { StoreShell } from "@/components/store/StoreShell";
import { getStoreMeta } from "@/lib/storeApi";

export default async function MainLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const meta = await getStoreMeta();
  return (
    <StoreShell accent={meta?.accent} radius={meta?.radius} font={meta?.font} announcement={meta?.announcement}>
      {children}
    </StoreShell>
  );
}
