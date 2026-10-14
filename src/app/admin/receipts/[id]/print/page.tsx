import { notFound } from "next/navigation";
import { ReceiptPrintView } from "@/components/admin/receipt/ReceiptPrintView";

// Lives outside the (panel) layout so no admin navigation ends up on paper.
export default function ReceiptPrintPage({ params, searchParams }: {
  params: { id: string };
  searchParams: { copy?: string };
}) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <ReceiptPrintView receiptId={id} copy={searchParams.copy === "1"} />;
}
