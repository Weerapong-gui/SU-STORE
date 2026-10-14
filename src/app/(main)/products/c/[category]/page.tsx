import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryView } from "@/components/store/CategoryView";
import { getStoreCategory } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

type Props = { params: { category: string } };

// Language is picked client-side, so server metadata uses the Thai name.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await getStoreCategory(params.category);
  return { title: found?.category.name ?? "SU STORE" };
}

export default async function CategoryPage({ params }: Props) {
  const found = await getStoreCategory(params.category);
  if (!found) notFound();
  return <CategoryView category={found.category} products={found.products} />;
}
