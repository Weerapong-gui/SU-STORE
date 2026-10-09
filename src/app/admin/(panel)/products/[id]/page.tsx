import { notFound } from "next/navigation";
import { ProductEditor } from "@/components/admin/ProductEditor";

export default function EditProductPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <ProductEditor productId={id} />;
}
