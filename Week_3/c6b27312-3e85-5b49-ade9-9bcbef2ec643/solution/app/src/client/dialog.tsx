// A modal dialog: everything outside is inert and out of the accessibility tree, Tab cycles inside,
// Escape closes only the topmost surface, and focus returns to the opener (or to main when it has left).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const stack: symbol[] = [];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function setBackground(inert: boolean): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.toggleAttribute("inert", inert);
  if (inert) root.setAttribute("aria-hidden", "true");
  else root.removeAttribute("aria-hidden");
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;

  useEffect(() => {
    const token = Symbol("dialog");
    stack.push(token);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBackground(true);
    const node = box.current;
    const first = node?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closer.current();
      } else if (event.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
        if (items.length === 0) return;
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
        event.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(token), 1);
      if (stack.length === 0) setBackground(false);
      if (opener && opener.isConnected) opener.focus();
      else document.querySelector<HTMLElement>("main")?.focus();
    };
  }, []);

  return createPortal(
    <div className="dialog-scrim">
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
