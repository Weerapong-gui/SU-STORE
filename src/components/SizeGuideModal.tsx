"use client";

import Image from "next/image";

type SizeGuideModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SizeGuideModal({ open, onClose }: SizeGuideModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Size guide"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close size guide"
      />

      <div className="relative z-10 max-h-[92vh] max-w-[94vw] overflow-hidden rounded-[1.75rem] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.26)]">
        <Image
          src="/images/size guide/Horizontal.png"
          alt="Size guide horizontal"
          width={1080}
          height={1566}
          priority
          className="hidden max-h-[92vh] w-auto max-w-[94vw] object-contain md:block landscape:block"
        />
        <Image
          src="/images/size guide/Vertical.png"
          alt="Size guide vertical"
          width={1350}
          height={829}
          priority
          className="block max-h-[92vh] w-auto max-w-[94vw] object-contain md:hidden landscape:hidden"
        />

        <button
          type="button"
          className="absolute right-[2%] top-[2%] h-12 w-12 opacity-0"
          onClick={onClose}
          aria-label="Close size guide"
        />
      </div>
    </div>
  );
}
