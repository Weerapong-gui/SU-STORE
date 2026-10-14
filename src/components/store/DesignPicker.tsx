"use client";

import { useLocalized } from "@/lib/localized";
import { useStoreText } from "@/lib/storeI18n";
import { cn } from "@/lib/utils";
import type { StoreVariant } from "@/types/store";

// The design image when there is one, otherwise the short code on a neutral chip.
export function DesignPicker({ designs, selectedId, onSelect }: {
  designs: StoreVariant[];
  selectedId: number | undefined;
  onSelect: (design: StoreVariant) => void;
}) {
  const t = useStoreText();
  const localized = useLocalized();
  const selected = designs.find((d) => d.id === selectedId);
  return (
    <fieldset>
      <legend className="text-[15px] font-semibold text-ink">
        {t.design}
        {selected && <span className="font-normal text-ink-soft"> · {selected.designCode}</span>}
      </legend>
      <div role="radiogroup" aria-label={t.chooseDesign} className="-mx-6 mt-2.5 flex gap-2.5 overflow-x-auto px-6 pb-2 pt-1 md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0">
        {designs.map((design) => {
          const checked = design.id === selectedId;
          const name = localized(design.designName, design.designNameEn);
          return (
            <button
              key={design.id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${design.designCode} ${name}${design.soldOut ? ` (${t.designSoldOut})` : ""}`}
              disabled={design.soldOut}
              onClick={() => onSelect(design)}
              className={cn(
                "flex h-14 w-14 shrink-0 md:aspect-square md:h-auto md:w-auto items-center justify-center overflow-hidden rounded-xl bg-mist p-0 text-[11px] font-bold text-ink ring-1 ring-inset ring-black/10 transition",
                checked && "ring-2 ring-apple-blue ring-offset-2",
                design.soldOut && "cursor-not-allowed opacity-30"
              )}
            >
              {design.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={design.image} alt="" className="h-full w-full object-cover" />
              ) : (
                design.designCode
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
