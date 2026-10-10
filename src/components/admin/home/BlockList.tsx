"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui";
import type { HomeBlock, HomeBlockType, StoreProduct } from "@/types/store";
import { BLOCK_INFO, MAX_BLOCKS, move, newBlock, summarize } from "./blocks";
import { BlockForm } from "./BlockForms";
import { IconButton } from "./controls";

// The ordered list of home page blocks: reorder (buttons or drag), hide, delete, edit, add.
export function BlockList({ blocks, products, onChange }: {
  blocks: HomeBlock[];
  products: StoreProduct[];
  onChange: (blocks: HomeBlock[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const dragFrom = useRef<number | null>(null);

  const setBlock = (i: number, block: HomeBlock) => onChange(blocks.map((b, j) => (j === i ? block : b)));

  function addBlock(type: HomeBlockType) {
    const block = newBlock(type);
    onChange([...blocks, block]);
    setOpenId(block.id);
    setAdding(false);
  }

  function drop(to: number) {
    if (dragFrom.current !== null) onChange(move(blocks, dragFrom.current, to));
    dragFrom.current = null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-zinc-900">บล็อกในหน้าแรก (เรียงจากบนลงล่าง)</h2>
      {blocks.length === 0 && (
        <p className="rounded-2xl border-2 border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500">
          ยังไม่มีบล็อก หน้าแรกจะว่างเปล่า กด ＋ เพิ่มบล็อก ด้านล่าง
        </p>
      )}
      {blocks.map((block, i) => (
        <BlockCard
          key={block.id}
          block={block}
          open={openId === block.id}
          isFirst={i === 0}
          isLast={i === blocks.length - 1}
          products={products}
          onToggle={() => setOpenId(openId === block.id ? null : block.id)}
          onChange={(b) => setBlock(i, b)}
          onMove={(delta) => onChange(move(blocks, i, i + delta))}
          onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
          onDragStart={() => (dragFrom.current = i)}
          onDrop={() => drop(i)}
        />
      ))}

      {adding ? (
        <AddBlockMenu onPick={addBlock} onClose={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" className="w-full border-dashed py-3" disabled={blocks.length >= MAX_BLOCKS} onClick={() => setAdding(true)}>
          ＋ เพิ่มบล็อก
        </Button>
      )}
    </section>
  );
}

function BlockCard({ block, open, isFirst, isLast, products, onToggle, onChange, onMove, onRemove, onDragStart, onDrop }: {
  block: HomeBlock;
  open: boolean;
  isFirst: boolean;
  isLast: boolean;
  products: StoreProduct[];
  onToggle: () => void;
  onChange: (block: HomeBlock) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const info = BLOCK_INFO[block.type];
  const summary = summarize(block);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`rounded-2xl border bg-white shadow-sm ${open ? "border-zinc-400" : "border-zinc-200"} ${block.hidden ? "opacity-60" : ""}`}
    >
      <div draggable onDragStart={onDragStart} onClick={onToggle} className="flex cursor-pointer items-center gap-2 p-3 sm:p-4">
        <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-zinc-400" aria-hidden />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
          <info.icon className="h-5 w-5 text-zinc-700" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-zinc-900">
            {info.label}
            {block.hidden && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600">ซ่อนอยู่</span>}
          </p>
          {summary.warning ? (
            <p className="truncate text-xs font-medium text-amber-700">{summary.warning}</p>
          ) : (
            summary.text && <p className="truncate text-xs text-zinc-500">{summary.text}</p>
          )}
        </div>
        <IconButton label="เลื่อนขึ้น" icon={ArrowUp} disabled={isFirst} onClick={() => onMove(-1)} />
        <IconButton label="เลื่อนลง" icon={ArrowDown} disabled={isLast} onClick={() => onMove(1)} />
        <IconButton
          label={block.hidden ? "แสดงบล็อกนี้" : "ซ่อนบล็อกนี้"}
          icon={block.hidden ? EyeOff : Eye}
          onClick={() => onChange({ ...block, hidden: !block.hidden })}
        />
        <IconButton label="ลบบล็อก" icon={Trash2} danger onClick={() => window.confirm(`ลบบล็อก "${info.label}"?`) && onRemove()} />
        <ChevronDown className={`h-5 w-5 shrink-0 text-zinc-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </div>
      {open && (
        <div className="border-t border-zinc-100 p-4 sm:p-5">
          <BlockForm block={block} onChange={onChange} products={products} />
        </div>
      )}
    </div>
  );
}

function AddBlockMenu({ onPick, onClose }: { onPick: (type: HomeBlockType) => void; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center">
        <p className="mr-auto text-sm font-bold">เลือกชนิดบล็อก</p>
        <Button variant="ghost" onClick={onClose}>
          ปิด
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(BLOCK_INFO) as HomeBlockType[]).map((type) => {
          const info = BLOCK_INFO[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              className="flex items-start gap-3 rounded-xl border border-zinc-200 p-3 text-left hover:border-zinc-500 hover:bg-zinc-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                <info.icon className="h-5 w-5 text-zinc-700" />
              </span>
              <span>
                <span className="block text-sm font-bold">{info.label}</span>
                <span className="block text-xs text-zinc-500">{info.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
