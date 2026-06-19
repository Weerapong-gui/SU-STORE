import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default function AdminRoot() {
  const hasToken = Boolean(cookies().get("su-admin-token")?.value);
  if (hasToken) redirect("/admin/orders");
  redirect("/admin/login");
}
