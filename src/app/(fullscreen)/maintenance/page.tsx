import { Suspense } from "react";
import Image from "next/image";
import { MaintenancePolling } from "./MaintenanceClient";

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
      {/* Landscape */}
      <div className="relative hidden h-full w-full [@media(orientation:landscape)]:block">
        <Image src={horizontal} alt="We'll be back" fill className="object-cover" priority sizes="100vw" />
      </div>
      {/* Portrait */}
      <div className="relative h-full w-full [@media(orientation:landscape)]:hidden">
        <Image src={vertical} alt="We'll be back" fill className="object-cover" priority sizes="100vw" />
      </div>

      <Suspense>
        <MaintenancePolling reason={searchParams.reason} />
      </Suspense>
    </div>
  );
}
