import { type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../lib/modal";

export function Dialog({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return createPortal(
    <div className="scrim">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
