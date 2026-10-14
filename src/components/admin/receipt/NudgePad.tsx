"use client";

import { Button } from "@/components/admin/ui";

const TOUCH = "!h-11 !w-11 !p-0"; // 44px minimum hit area

// Arrow buttons; each press moves the selection by one nudge step (NUDGE_STEP viewBox units).
export function NudgePad({ disabled, horizontalOnly, onNudge }: {
  disabled: boolean;
  horizontalOnly: boolean;
  onNudge: (dx: number, dy: number) => void;
}) {
  const arrow = (label: string, glyph: string, dx: number, dy: number) => (
    <Button
      variant="secondary"
      className={TOUCH}
      aria-label={label}
      disabled={disabled || (horizontalOnly && dy !== 0)}
      onClick={() => onNudge(dx, dy)}
    >
      {glyph}
    </Button>
  );
  return (
    <div className="grid w-fit grid-cols-3 gap-1">
      <span />{arrow("ขึ้น", "↑", 0, -1)}<span />
      {arrow("ซ้าย", "←", -1, 0)}{arrow("ลง", "↓", 0, 1)}{arrow("ขวา", "→", 1, 0)}
    </div>
  );
}
