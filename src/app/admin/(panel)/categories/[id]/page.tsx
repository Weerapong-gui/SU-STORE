import { notFound } from "next/navigation";
import { CategoriesWorkspace } from "@/components/admin/category/CategoriesWorkspace";

export default function EditCategoryPage({ params }: { params: { id: string } }) {
  if (params.id === "new") return <CategoriesWorkspace selected="new" />;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) notFound();
  return <CategoriesWorkspace selected={id} />;
}
