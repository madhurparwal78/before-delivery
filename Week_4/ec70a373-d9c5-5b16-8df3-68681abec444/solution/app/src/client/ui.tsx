// Shared interface pieces: dialogs, status regions, field errors, motion preference, pending buttons and empty states.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { interruptibleDialogOpened } from "./session.ts";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The layout bands, decided here for the browser: phone below 640 px. Everything else in layout is CSS at the same edges. */
const PHONE_BAND = "(max-width: 639.98px)";

export function usePhoneBand(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_BAND).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE_BAND);
    const update = (): void => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/** Re-renders every `ms` milliseconds. */
export function useTick(ms: number): void {
  const [, setAt] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAt((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const EASE = "cubic-bezier(.2,0,0,1)";

/** Briefly tints an element and lets it settle back (row status changes, lot lines). */
export function tint(element: Element | null): void {
  if (!element || prefersReducedMotion()) return;
  element.animate(
    [{ backgroundColor: "color-mix(in srgb, var(--green) 16%, var(--paper))" }, { backgroundColor: "transparent" }],
    { duration: 250, easing: EASE },
  );
}

type Tone = "info" | "error";

interface StatusMessage {
  text: string;
  tone: Tone;
}

export type Say = (text: string, tone?: Tone) => void;

/**
 * Status-region writes, in one place: each write replaces the whole text at once. A write of the text already shown
 * empties the region and sets it again on the next animation frame, the only empty frame between two copies.
 */
export function useStatusRegion(): [StatusMessage | null, Say] {
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const shown = useRef<string | null>(null);
  const frame = useRef(0);
  const say = useCallback<Say>((text, tone = "info") => {
    cancelAnimationFrame(frame.current);
    if (shown.current === text) {
      setMessage(null);
      frame.current = requestAnimationFrame(() => setMessage({ text, tone }));
      return;
    }
    shown.current = text;
    setMessage({ text, tone });
  }, []);
  return [message, say];
}

const COUNTING = /(PL-[A-Z0-9]{6}|\$[\d,]+\.\d{2}|\d{4}-\d{2}(?:-\d{2})?|\d{2}:\d{2}(?:[–-]\d{2}:\d{2})?|\d+\.\d{2})/;

/** Published copy with every counting numeral (hours, times, money, references, dates) set in the mono face. */
export function Numerals({ text }: { text: string }): ReactNode {
  return <span>{text.split(COUNTING).map((part, i) => (i % 2 === 1 ? <span key={i} className="mono">{part}</span> : part))}</span>;
}

/** A named live region: polite, read whole, present and empty in the first frame of its screen or dialog. */
export function StatusRegion({ name, className, children }: { name: string; className: string; children: ReactNode }): ReactNode {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" aria-label={name} className={className}>
      {children}
    </div>
  );
}

export function Status({ name, message }: { name: string; message: StatusMessage | null }): ReactNode {
  return (
    <StatusRegion name={name} className={`status${message?.tone === "error" ? " status-error" : ""}`}>
      {message ? <Numerals text={message.text} /> : null}
    </StatusRegion>
  );
}

/** The rule that only the latest request for a screen's subject is drawn: `begin` makes every earlier request stale. */
export function useLatestRequest(): () => () => boolean {
  const newest = useRef(0);
  return useCallback(() => {
    const ticket = ++newest.current;
    return () => ticket === newest.current;
  }, []);
}

export interface FieldErrors {
  /** Shows a published copy beside its field. */
  set: (field: string, copy: string) => void;
  clear: (field: string) => void;
  clearAll: () => void;
  /** Attributes for the field while it has an error. */
  attrs: (field: string) => { "aria-invalid"?: true; "aria-describedby"?: string };
  /** The error element, placed directly after its field. */
  node: (field: string) => ReactNode;
}

/** Field-error linking, in one place: `aria-invalid` and `aria-describedby` while shown, gone on the next value change. */
export function useFieldErrors(): FieldErrors {
  const prefix = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idOf = (field: string): string => `${prefix}-${field}-error`;
  return {
    set: (field, copy) => setErrors((all) => ({ ...all, [field]: copy })),
    clear: (field) => setErrors((all) => {
      if (!(field in all)) return all;
      const { [field]: _gone, ...rest } = all;
      return rest;
    }),
    clearAll: () => setErrors({}),
    attrs: (field) => (errors[field] ? { "aria-invalid": true, "aria-describedby": idOf(field) } : {}),
    node: (field) =>
      errors[field] ? (
        <p className="field-error" id={idOf(field)}>
          {errors[field]}
        </p>
      ) : null,
  };
}

/** A button under the Pending buttons rule: aria-disabled while pending, keeps focus, ignores presses, never `disabled`. */
export function ActionButton({
  pending,
  onPress,
  children,
  ...rest
}: { pending: boolean; onPress: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled">): ReactNode {
  return (
    <button
      type="button"
      {...rest}
      aria-disabled={pending}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (!pending) onPress();
      }}
    >
      {children}
    </button>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);
}

interface DialogProps {
  title: string;
  onClose: () => void;
  /** Where focus goes when the dialog closes; defaults to the control that opened it. */
  returnFocus?: () => HTMLElement | null;
  /** A Cancel booking, Check out or Buy dialog, which Sign in again can interrupt. */
  interruptible?: boolean;
  /** The compact steel-edged panel of Sign in again. */
  compact?: boolean;
  children: (close: () => void) => ReactNode;
}

/**
 * A modal dialog: focus moves to its `data-autofocus` control or first control on open, Tab and Shift+Tab cycle
 * inside, Escape closes, focus returns to the opener, and the page behind is inert.
 */
export function Dialog({ title, onClose, returnFocus, interruptible = false, compact = false, children }: DialogProps): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closing = useRef(false);
  const restore = useRef(returnFocus);
  restore.current = returnFocus;
  const titleId = useId();

  useEffect(() => (interruptible ? interruptibleDialogOpened() : undefined), [interruptible]);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0])?.focus();
    if (!prefersReducedMotion()) {
      dialog.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 250, easing: EASE });
    }
    return () => {
      dialog.close();
      const target = restore.current?.() ?? opener.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  const close = (): void => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    const leaving = dialog.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(4px)" }], { duration: 100, easing: EASE, fill: "forwards" });
    void leaving.finished.then(onClose, onClose);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={compact ? "dialog dialog-compact" : "dialog"}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || !ref.current) return;
        const list = focusables(ref.current);
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last) return;
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (index === list.length - 1 || index === -1)) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id={titleId} className="dialog-title">
        <Numerals text={title} />
      </h2>
      {children(close)}
    </dialog>
  );
}

/** A small drawn steel-line illustration for empty lists. */
export function EmptyState({ drawing, children }: { drawing: "spike" | "clipboard"; children: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true" className="empty-drawing">
        {drawing === "spike" ? (
          <>
            <line x1="36" y1="8" x2="36" y2="58" />
            <path d="M22 58h28l4 6H18z" />
            <path d="M24 30h24v14l-4 3-4-3-4 3-4-3-4 3-4-3z" strokeDasharray="3 3" />
          </>
        ) : (
          <>
            <rect x="16" y="12" width="40" height="52" rx="2" />
            <rect x="27" y="8" width="18" height="9" rx="2" />
            <line x1="24" y1="30" x2="48" y2="30" />
            <line x1="24" y1="40" x2="48" y2="40" />
            <line x1="24" y1="50" x2="40" y2="50" />
          </>
        )}
      </svg>
      <p>{children}</p>
    </div>
  );
}
