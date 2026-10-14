"use client";

import { cn } from "@/lib/utils";

export function OptionButtons({ label, options, selected, isAvailable, onSelect }: {
  label: string;
  options: string[];
  selected: string;
  isAvailable: (option: string) => boolean;
  onSelect: (option: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const available = isAvailable(option);
          return (
            <button
              key={option}
              type="button"
              disabled={!available}
              onClick={() => onSelect(option)}
              aria-pressed={selected === option}
              className={cn(
                "min-h-11 min-w-12 rounded-full border px-4 py-2 text-sm font-medium transition",
                selected === option
                  ? "border-apple-blue bg-apple-blue-soft text-apple-blue"
                  : "border-zinc-300 text-ink hover:border-ink",
                !available && "cursor-not-allowed border-zinc-200 text-zinc-300 line-through hover:border-zinc-200"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
