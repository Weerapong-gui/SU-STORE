import type { ReceiptLayout, ReceiptPage, ReceiptSnapshot } from "@/types/store";
export type { ReceiptPage } from "@/types/store";

// Extra wrapped lines sit tighter than a full row so long names do not waste page space.
export const WRAP_LINE_HEIGHT = 1.35;

export function rowHeight(table: ReceiptLayout["table"], nameLineCount: number): number {
  return table.rowSpacing + table.size * WRAP_LINE_HEIGHT * (nameLineCount - 1);
}

// Canvas measurement runs slightly narrower than the SVG's rendered text, so wrap a little early.
const WRAP_SAFETY = 4;

type Measure = (text: string, size: number) => number;
type SegmenterConstructor = new (locale: string, options: { granularity: "word" }) => {
  segment(text: string): Iterable<{ segment: string }>;
};

function wrapName(name: string, width: number, size: number, measure: Measure): string[] {
  // ES2022 typings omit Segmenter, even though modern browsers and Node provide it.
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
  const segments = Segmenter
    ? Array.from(new Segmenter("th", { granularity: "word" }).segment(name), part => part.segment)
    : Array.from(name);
  const limit = width - WRAP_SAFETY;
  const wrapped: string[] = [];
  let current = "";
  const append = (part: string) => {
    if (current && measure(current + part, size) > limit) {
      wrapped.push(current);
      current = "";
    }
    current += part;
  };
  for (const segment of segments) {
    if (measure(segment, size) <= limit) append(segment);
    else for (const character of segment) append(character);
  }
  if (current || !wrapped.length) wrapped.push(current);
  return wrapped;
}

export function paginate(lines: ReceiptSnapshot["lines"], layout: ReceiptLayout, measure: Measure): ReceiptPage[] {
  const { firstY, bottomY, size, cols } = layout.table;
  const groups: ReceiptPage["rows"][] = [[]];
  let usedHeight = 0;
  for (const line of lines) {
    const nameLines = wrapName(line.name, cols.name.width, size, measure);
    const height = rowHeight(layout.table, nameLines.length);
    // An oversized row stays intact on its own page; always advance instead of looping.
    if (groups[groups.length - 1].length && firstY + usedHeight + height > bottomY) {
      groups.push([]);
      usedHeight = 0;
    }
    groups[groups.length - 1].push({ line, nameLines });
    usedHeight += height;
  }
  return groups.map((rows, index) => ({ rows, pageNo: index + 1, pageCount: groups.length, isLast: index === groups.length - 1 }));
}
