"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { adminFetch, formatThaiDateTime } from "@/lib/adminApi";
import { Button, useToast } from "@/components/admin/ui";
import type { HomeAdminState, HomeLayout, StoreProduct } from "@/types/store";
import { AccentPicker } from "./AccentPicker";
import { BlockList } from "./BlockList";

const AUTOSAVE_MS = 1000;

type SaveStatus = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

// /admin/home: edits autosave as a draft; customers only see it after "เผยแพร่".
export function HomeEditor() {
  const toast = useToast();
  const [state, setState] = useState<HomeAdminState | null>(null);
  const [layout, setLayout] = useState<HomeLayout | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [save, setSave] = useState<SaveStatus>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const pending = useRef<HomeLayout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    Promise.all([adminFetch<HomeAdminState>("home"), adminFetch<{ products: StoreProduct[] }>("products")])
      .then(([home, list]) => {
        setState(home);
        setLayout(home.draft);
        setProducts(list.products);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  // Saves the latest unsaved layout now. Resolves false when the server rejected it.
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return true;
    pending.current = null;
    setSave({ kind: "saving" });
    try {
      const saved = await adminFetch<HomeAdminState>("home", { method: "PUT", json: next });
      // Keep local edits; only take the server's view of what is published.
      setState(saved);
      setSave(pending.current ? { kind: "saving" } : { kind: "saved" });
      return true;
    } catch (e) {
      setSave({ kind: "error", message: (e as Error).message });
      return false;
    }
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function update(next: HomeLayout) {
    setLayout(next);
    pending.current = next;
    setSave({ kind: "saving" });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }

  async function preview() {
    // Open the tab before awaiting, or popup blockers treat it as unrequested.
    const tab = window.open("about:blank", "_blank");
    if (!(await flush())) {
      tab?.close();
      toast("แก้ข้อผิดพลาดด้านบนก่อน แล้วค่อยดูตัวอย่าง", "error");
      return;
    }
    if (tab) tab.location.href = "/admin/home/preview";
    else window.location.href = "/admin/home/preview";
  }

  async function runAction(path: "home/publish" | "home/discard", done: (saved: HomeAdminState) => void) {
    setBusy(true);
    try {
      done(await adminFetch<HomeAdminState>(path, { method: "POST" }));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!(await flush())) {
      toast("แก้ข้อผิดพลาดด้านบนก่อน แล้วค่อยเผยแพร่", "error");
      return;
    }
    if (!window.confirm("เผยแพร่หน้าแรกนี้? ลูกค้าจะเห็นทันที")) return;
    await runAction("home/publish", (saved) => {
      setState(saved);
      toast("เผยแพร่หน้าแรกแล้ว");
    });
  }

  async function discard() {
    if (!window.confirm("ทิ้งการแก้ไขทั้งหมดที่ยังไม่เผยแพร่ แล้วกลับไปเป็นแบบที่ลูกค้าเห็นอยู่ตอนนี้?")) return;
    clearTimeout(timer.current);
    pending.current = null;
    await runAction("home/discard", (saved) => {
      setState(saved);
      setLayout(saved.draft);
      setSave({ kind: "idle" });
      toast("กลับเป็นแบบที่เผยแพร่อยู่แล้ว");
    });
  }

  if (!state || !layout) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  const dirty = state.dirty || save.kind === "saving" || save.kind === "error";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">ตกแต่งหน้าแรก</h1>
        <p className="text-sm text-zinc-500">จัดหน้าแรกของร้านจากบล็อกสำเร็จรูป แก้แล้วระบบบันทึกเป็นร่างให้เอง ลูกค้าจะเห็นก็ต่อเมื่อกด เผยแพร่</p>
      </div>

      <div className="sticky top-[57px] z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ${
            dirty ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-600"}`} />
          {dirty ? "มีการแก้ไขที่ยังไม่เผยแพร่" : "ตรงกับที่ลูกค้าเห็น"}
        </span>
        <span className="text-xs text-zinc-500" aria-live="polite">
          {save.kind === "saving" && "กำลังบันทึกร่าง..."}
          {save.kind === "saved" && "บันทึกร่างแล้ว"}
          {save.kind === "idle" && (state.publishedAt ? `เผยแพร่ล่าสุด ${formatThaiDateTime(state.publishedAt)}` : "ยังใช้หน้าแรกแบบเดิม")}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {state.dirty && (
            <Button variant="ghost" disabled={busy} onClick={discard}>
              ยกเลิกการแก้ไข
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={preview}>
            <Eye className="h-4 w-4" /> ดูตัวอย่าง
          </Button>
          <Button disabled={busy || !dirty} onClick={publish}>
            เผยแพร่
          </Button>
        </div>
        {save.kind === "error" && (
          <p className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">บันทึกร่างไม่สำเร็จ: {save.message}</p>
        )}
      </div>

      <BlockList blocks={layout.blocks} products={products} onChange={(blocks) => update({ ...layout, blocks })} />

      <AccentPicker value={layout.accent} onChange={(accent) => update({ ...layout, accent })} />
    </div>
  );
}
