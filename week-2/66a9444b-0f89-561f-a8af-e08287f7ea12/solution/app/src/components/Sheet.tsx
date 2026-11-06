// The agenda sits beside the schedule at 1280; at 768 it opens as a bottom sheet and at 375 as a full-height sheet.
import { useEffect, useRef, type ReactNode } from "react";

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("h2")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onClose]);
  return <div ref={box} className={`sheet${open ? " is-open" : ""}`}>{children}</div>;
}
