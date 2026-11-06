// Small shared pieces: the named live region every action reports into, and the dialog every confirmation uses.

import { forwardRef, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { MEDIUM, QUICK, tween, type Motion } from "../motion.js";

/** Lay an element `rise` pixels below its place at the given strength (0 to 1). */
function riseTo(node: HTMLElement, strength: number, rise: number): void {
  node.style.opacity = String(strength);
  node.style.transform = strength === 1 ? "" : `translateY(${(1 - strength) * rise}px)`;
}

export interface Notice { text: string; tone: "info" | "error" }

export const quiet: Notice = { text: "", tone: "info" };
export const info = (text: string): Notice => ({ text, tone: "info" });
export const errorNotice = (text: string): Notice => ({ text, tone: "error" });

/** A named `status` live region. Its text is exactly the copy; errors add a hidden alert icon in brick. */
export const Status = forwardRef<HTMLParagraphElement, { label: string; notice: Notice; className?: string }>(
  function Status({ label, notice, className }, ref) {
    const inner = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
      const node = inner.current;
      if (!notice.text || !node) return;
      const appearing = tween(0, 1, QUICK, (v) => riseTo(node, v, 3));
      return () => appearing?.stop();
    }, [notice]);
    return (
      <p ref={ref} role="status" aria-label={label} tabIndex={-1}
        className={`status ${notice.tone === "error" ? "status--error" : ""} ${className ?? ""}`}>
        {notice.text && notice.tone === "error" && <CircleAlert className="status__icon" aria-hidden="true" size={18} />}
        <span ref={inner}>{notice.text}</span>
      </p>
    );
  });

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[inert]"));
}

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Where focus goes when the dialog closes: the opener by default, the page status after a success. */
  returnFocus: () => HTMLElement | null;
  children: ReactNode;
  wide?: boolean;
}

/**
 * A modal dialog: focus moves to its first field, Tab and Shift+Tab cycle inside it, Escape closes it and focus
 * returns. It rises 12 pixels and fades in at the medium speed and fades out at the quick speed; while closing it is
 * inert and hidden from assistive technology, and reopening it mid-exit stops the exit.
 */
export function Dialog({ open, title, onClose, returnFocus, children, wide }: DialogProps): ReactNode {
  const [rendered, setRendered] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const focusOnClose = useRef(returnFocus);
  const motion = useRef<Motion>(null);
  focusOnClose.current = returnFocus;
  if (open && !rendered) setRendered(true);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    motion.current?.stop();
    if (open) {
      (focusables(node)[0] ?? node).focus();
      motion.current = tween(0, 1, MEDIUM, (v) => riseTo(node, v, 12));
      return;
    }
    focusOnClose.current()?.focus();
    const from = Number(node.style.opacity || "1");
    motion.current = tween(from, 0, QUICK, (v) => { node.style.opacity = String(v); }, { onComplete: () => setRendered(false) });
  }, [open]);

  useLayoutEffect(() => () => motion.current?.stop(), []);

  if (!rendered) return null;
  return (
    <div className="scrim" aria-hidden={open ? undefined : true} inert={!open}>
      <div ref={panel} className={`dialog ${wide ? "dialog--wide" : ""}`} role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined} aria-labelledby={titleId} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab" || !panel.current) return;
          const items = focusables(panel.current);
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}>
        <h2 id={titleId} className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A labelled control; an invalid field's message sits next to it, tied to it by `aria-describedby`. */
export function Field({ label, group, htmlFor, error, errorId, children, className }: { label: string;
  /** The heading the field sits under, spoken before `label` but not shown again ("Flute" for "monthly rent"). */
  group?: string; htmlFor: string; error?: string; errorId?: string; children: ReactNode; className?: string }): ReactNode {
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {group && <span className="visually-hidden">{group} </span>}{label}
      </label>
      {children}
      {error && <span id={errorId} className="field-error"><CircleAlert className="field-error__icon" aria-hidden="true" size={16} /><span>{error}</span></span>}
    </div>
  );
}
