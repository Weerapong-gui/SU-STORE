import { HomeBlocks } from "@/components/store/home/HomeBlocks";
import { getStoreHome } from "@/lib/storeApi";

export const dynamic = "force-dynamic";

// Layout comes from /admin/home (published version only).
export default async function HomePage() {
  return <HomeBlocks home={await getStoreHome()} />;
}
