"use client";

import { useRef, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Button, Card, Field, inputClass, useToast } from "@/components/admin/ui";
import type { ReceiptSettings } from "@/types/store";
import { CONTROL } from "./controls";

type PayeePatch = Partial<Pick<ReceiptSettings, "payeeName" | "signatureUrl">>;

export function PayeeCard({ payeeName, signatureUrl, onChange }: {
  payeeName: string;
  signatureUrl: string;
  onChange: (patch: PayeePatch) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadSignature(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const { url } = await adminFetch<{ url: string }>("images", { method: "POST", body });
      onChange({ signatureUrl: url });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card title="ผู้รับเงิน">
      <div className="space-y-3">
        <Field label="ชื่อผู้รับเงิน">
          <input className={`${inputClass} ${CONTROL}`} maxLength={80} value={payeeName}
            onChange={(e) => onChange({ payeeName: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept="image/png" hidden onChange={(e) => uploadSignature(e.target.files?.[0])} />
          <Button variant="secondary" className={CONTROL} disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? "กำลังอัปโหลด..." : "อัปโหลดรูปลายเซ็น (PNG พื้นใส)"}
          </Button>
          {signatureUrl && (
            <Button variant="ghost" className={CONTROL} onClick={() => onChange({ signatureUrl: "" })}>ลบรูปลายเซ็น</Button>
          )}
        </div>
      </div>
    </Card>
  );
}
