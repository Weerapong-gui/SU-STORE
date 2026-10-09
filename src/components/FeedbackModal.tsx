"use client";

import { useEffect, useState } from "react";
import { MessageSquare, X, Angry, Frown, Meh, Smile, Laugh, Check } from "lucide-react";
import { useLang } from "@/lib/i18n";

type Props = {
  orderId: string;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
};

type RatingTier = { value: 1 | 2 | 3 | 4 | 5; Icon: typeof Angry; color: string; ring: string; bg: string };

const TIERS: RatingTier[] = [
  { value: 1, Icon: Angry, color: "text-rose-600",    ring: "ring-rose-400",    bg: "bg-rose-100" },
  { value: 2, Icon: Frown, color: "text-orange-500",  ring: "ring-orange-400",  bg: "bg-orange-100" },
  { value: 3, Icon: Meh,   color: "text-amber-500",   ring: "ring-amber-400",   bg: "bg-amber-100" },
  { value: 4, Icon: Smile, color: "text-lime-600",    ring: "ring-lime-400",    bg: "bg-lime-100" },
  { value: 5, Icon: Laugh, color: "text-emerald-600", ring: "ring-emerald-400", bg: "bg-emerald-100" },
];

export function FeedbackModal({ orderId, open, onClose, onSubmitted }: Props) {
  const { t } = useLang();
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRating(null); setHover(null); setComment("");
      setSubmitting(false); setSubmitted(false); setErr(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeLabel = hover ?? rating;
  const labelText = activeLabel ? t.feedback.ratingLabels[activeLabel - 1] : "";

  async function submit() {
    if (!rating || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/order/${encodeURIComponent(orderId)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          try { localStorage.setItem(`feedback_${orderId}_done`, "1"); } catch {}
          setSubmitted(true);
          setTimeout(() => { onSubmitted?.(); onClose(); }, 1200);
          return;
        }
        setErr(data.message || t.feedback.errorGeneric);
        setSubmitting(false);
        return;
      }
      try { localStorage.setItem(`feedback_${orderId}_done`, "1"); } catch {}
      setSubmitted(true);
      setTimeout(() => { onSubmitted?.(); onClose(); }, 1500);
    } catch {
      setErr(t.feedback.errorGeneric);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white">
              <MessageSquare className="h-4 w-4" />
            </div>
            <span className="text-base font-bold text-zinc-900">{t.feedback.title}</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <p className="text-lg font-bold text-zinc-900">{t.feedback.thanks}</p>
            <p className="text-sm text-zinc-500">{t.feedback.thanksSub}</p>
          </div>
        ) : (
          <>
            <div className="px-6 pt-6 text-center">
              <h2 className="text-2xl font-bold text-zinc-900">{t.feedback.question}</h2>
              <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">{t.feedback.subtitle}</p>
            </div>

            <div className="flex items-end justify-center gap-3 px-6 pt-6">
              {TIERS.map((tier) => {
                const isSelected = rating === tier.value;
                const isActive = activeLabel === tier.value;
                const Icon = tier.Icon;
                return (
                  <button
                    key={tier.value}
                    type="button"
                    onMouseEnter={() => setHover(tier.value)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setRating(tier.value)}
                    aria-label={t.feedback.ratingLabels[tier.value - 1]}
                    className={`group flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                      isSelected ? `${tier.bg} ring-4 ${tier.ring} scale-110` : "bg-zinc-100 hover:scale-105"
                    }`}
                  >
                    <Icon className={`h-7 w-7 ${isSelected || isActive ? tier.color : "text-zinc-400"}`} strokeWidth={2} />
                  </button>
                );
              })}
            </div>

            <div className="flex h-8 items-center justify-center px-6 pt-3">
              {labelText && (
                <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white">{labelText}</span>
              )}
            </div>

            <div className="px-6 pt-2">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder={t.feedback.commentPlaceholder}
                rows={4}
                className="w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:bg-white"
              />
              <div className="mt-1 flex justify-end text-[10px] text-zinc-400">{comment.length}/500</div>
            </div>

            {err && (
              <div className="mx-6 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
            )}

            <div className="px-6 pb-6 pt-2">
              <button
                type="button"
                disabled={!rating || submitting}
                onClick={submit}
                className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-600 hover:to-teal-700 disabled:cursor-not-allowed disabled:from-zinc-300 disabled:to-zinc-300 disabled:shadow-none"
              >
                {submitting ? t.feedback.submitting : t.feedback.submit}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
