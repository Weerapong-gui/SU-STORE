"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";

type PaymentSlipUploadFormProps = {
  orderId: string;
  hasUploadedSlip: boolean;
  orderStatus: string;
  slipUploadEnabled: boolean;
  slipUploadMessage?: string | null;
};

type UploadState = "idle" | "loading";

const FILE_INPUT_CLASSES =
  "block w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-apple-blue file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-apple-blue-dark";
const SUBMIT_BUTTON_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-70";

export function PaymentSlipUploadForm({
  orderId,
  hasUploadedSlip,
  orderStatus,
  slipUploadEnabled,
  slipUploadMessage,
}: PaymentSlipUploadFormProps) {
  const router = useRouter();
  const { t } = useLang();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  if (orderStatus !== "pending_payment") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {t.slip.sent}
      </div>
    );
  }

  if (!slipUploadEnabled) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {slipUploadMessage ?? "Slip upload is not available right now."}
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadState("loading");
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/order/${orderId}/payment`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(30000)
      });

      const result = (await response.json().catch(() => null)) as
        | { message?: string; orderId?: string }
        | null;

      if (!response.ok || !result?.orderId) {
        setErrorMessage(result?.message ?? t.slip.errorUpload);
        setUploadState("idle");
        return;
      }

      router.push(`/checkout/complete/${result.orderId}`);
    } catch {
      setErrorMessage(t.slip.errorConnection);
      setUploadState("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block">
        <input
          name="slip"
          type="file"
          required
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          className={FILE_INPUT_CLASSES}
        />
      </label>

      <p className="text-xs text-zinc-500">{t.slip.fileHint}</p>

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p>{errorMessage}</p>
          <p className="mt-1 text-xs text-rose-600">หากพบปัญหาขัดข้องเกี่ยวกับระบบให้ติดต่อผู้ดูแลระบบ โทร : 0838627000 ปาร์ค</p>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={uploadState === "loading"}
          className={SUBMIT_BUTTON_CLASSES}
        >
          {uploadState === "loading"
            ? t.slip.uploading
            : hasUploadedSlip
              ? t.slip.replace
              : t.slip.submit}
        </button>
      </div>
    </form>
  );
}
