import { Suspense } from "react";
import Image from "next/image";
import { MaintenancePolling } from "./MaintenanceClient";
import { imageBlurMap } from "@/data/products";

function getImages(reason: string | undefined) {
  if (reason === "beRightBack") {
    return {
      horizontal: "/images/anc/BE_RIGHT_BACK_horizontal.png",
      vertical: "/images/anc/BE_RIGHT_BACK_vertical.png",
    };
  }
  if (reason === "schedule") {
    return {
      horizontal: "/images/anc/STAY_TUNED_horizontal.png",
      vertical: "/images/anc/STAY_TUNED_vertical.png",
    };
  }
  return {
    horizontal: "/images/anc/BE_BACK_horizontal.png",
    vertical: "/images/anc/BE_BACK_vertical.png",
  };
}

export default function MaintenancePage({
  searchParams,
}: {
  searchParams: { reason?: string };
}) {
  const { horizontal, vertical } = getImages(searchParams.reason);

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* Use opacity (not display:none) so both images count as LCP candidates */}
      <Image src={horizontal} alt="We'll be back" fill
        className="object-cover opacity-0 [@media(orientation:landscape)]:opacity-100"
        priority sizes="100vw"
        placeholder={imageBlurMap[horizontal] ? "blur" : "empty"}
        blurDataURL={imageBlurMap[horizontal]}
      />
      <Image src={vertical} alt="We'll be back" fill
        className="object-cover opacity-100 [@media(orientation:landscape)]:opacity-0"
        priority sizes="100vw"
        placeholder={imageBlurMap[vertical] ? "blur" : "empty"}
        blurDataURL={imageBlurMap[vertical]}
      />

      <Suspense>
        <MaintenancePolling reason={searchParams.reason} />
      </Suspense>
    </div>
  );
}
