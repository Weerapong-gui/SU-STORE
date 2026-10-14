"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = "button:not([disabled]), input, select, textarea, [href], [tabindex]:not([tabindex='-1'])";

// Modal behaviour shared by the receipt dialogs: focus the first field, keep Tab inside,
// close on Esc (unless a request is in flight) and give focus back to the opener on close.
export function useModalFocus(busy: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Disabled buttons drop focus to body mid-request; pull it back so Tab stays trapped.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (busy && dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [busy]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("input, select, textarea")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only; onClose is read once
  }, []);

  // Backdrop click must not dismiss mid-request either.
  const onBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !busyRef.current) onClose();
  };
  return { dialogRef, onBackdropMouseDown };
}
