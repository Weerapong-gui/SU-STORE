// The v2 receipt SVG is served by order-api through the admin proxy; editor and print page share this fetch.
export async function loadReceiptTemplate(): Promise<string> {
  const res = await fetch("/api/admin/v2/receipt-template", { cache: "no-store" });
  if (!res.ok) throw new Error("โหลดแบบใบเสร็จไม่สำเร็จ");
  return res.text();
}
