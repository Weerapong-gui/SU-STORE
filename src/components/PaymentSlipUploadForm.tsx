"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentSlipUploadFormProps = {
  orderId: string;
  hasUploadedSlip: boolean;
};

type UploadState = "idle" | "loading";

const FILE_INPUT_CLASSES =
  "block w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-700 file:mr-4 file:rounded-full file:border-0 file:bg-apple-blue file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-apple-blue-dark";
const SUBMIT_BUTTON_CLASSES =
  "inline-flex items-center justify-center rounded-full bg-apple-blue px-5 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(0,113,227,0.24)] transition hover:bg-apple-blue-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-apple-blue/20 disabled:cursor-not-allowed disabled:opacity-70";

export function PaymentSlipUploadForm({
  orderId,
  hasUploadedSlip
}: PaymentSlipUploadFormProps) {
  const router = useRouter();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadState("loading");
    setErrorMessage("");

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/order/${orderId}/payment`, {
        method: "POST",
        body: formData
      });

      const result = (await response.json().catch(() => null)) as
        | {
            message?: string;
            orderId?: string;
          }
        | null;

      if (!response.ok || !result?.orderId) {
        setErrorMessage(result?.message ?? "ไม่สามารถอัปโหลดสลิปได้ในขณะนี้");
        setUploadState("idle");
        return;
      }

      router.push(`/checkout/complete/${result.orderId}`);
    } catch {
      setErrorMessage("ไม่สามารถเชื่อมต่อกับระบบอัปโหลดสลิปได้ในขณะนี้");
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

      <p className="text-xs text-zinc-500">รองรับไฟล์ JPG, PNG, WEBP หรือ PDF ขนาดไม่เกิน 5 MB</p>

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={uploadState === "loading"}
        className={SUBMIT_BUTTON_CLASSES}
      >
        {uploadState === "loading"
          ? "UPLOADING..."
          : hasUploadedSlip
            ? "REPLACE SLIP"
            : "SUBMIT SLIP FOR REVIEW"}
      </button>
    </form>
  );
}
