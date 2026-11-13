import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import { ArrowRight } from "lucide-preact";
import { openDialog } from "./dialog";
import { Link } from "./router";
import { messageStore, statusWord, useStore } from "./store";

const cx = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

/** True when the system asks for reduced motion. */
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Variant = "primary" | "outline" | "plain";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size" | "type"> {
  variant?: Variant;
  arrow?: boolean;
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}

export function Button({ variant = "primary", arrow, busy, children, className, type = "button", disabled, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={cx("btn", `btn-${variant}`, className as string)}>
      {children}
      {arrow && <ArrowRight className="btn-arrow" size={20} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  );
}

interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "role"> { href: string; variant?: Variant; arrow?: boolean; external?: boolean }

export function LinkButton({ variant = "outline", arrow, href, children, className, external, ...rest }: LinkButtonProps) {
  const body = (
    <>
      {children}
      {arrow && <ArrowRight className="btn-arrow" size={20} strokeWidth={1.75} aria-hidden="true" />}
    </>
  );
  const cls = cx("btn", `btn-${variant}`, className as string);
  return external ? (
    <a {...rest} href={href} className={cls}>{body}</a>
  ) : (
    <Link {...rest} href={href} className={cls}>{body}</Link>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  returnTo?: () => HTMLElement | null;
  className?: string;
  children: ComponentChildren;
}

/** A modal dialog; mount it when it should be open. Focus returns to the opener however it closes. */
export function Dialog({ title, onClose, returnTo, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnTo);
  returnRef.current = returnTo;
  const heading = useId();
  useLayoutEffect(() => {
    return openDialog(ref.current!, opener.current, () => closeRef.current(), () => returnRef.current?.() ?? null);
  }, []);
  return (
    <dialog ref={ref} className={cx("dialog", className)} title={title}>
      <div className="dialog-body">
        <h2 id={heading} className="dialog-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ComponentChildren;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className={cx("field", error && "field-error")}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? note : undefined })}
      {(error || hint) && <p id={note} className={error ? "field-note field-note-error" : "field-note"}>{error ?? hint}</p>}
    </div>
  );
}

/** Focuses the first field with an error after a rejected save. */
export function focusFirstError(root: HTMLElement | null): void {
  queueMicrotask(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("skeleton", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="bar" style={{ width: `${92 - ((i * 17) % 40)}%` }} />)}
    </div>
  );
}

/** A status as a word, with a shape for the states that settle. */
export function StatusWord({ state }: { state: string }) {
  const settled = ["approved", "merged", "published", "scored"].includes(state);
  const failed = ["failed", "abandoned"].includes(state);
  return (
    <span className={cx("status-word", `is-${state}`)}>
      <span className={cx("status-square", settled && "filled", failed && "crossed")} aria-hidden="true" />
      {statusWord(state)}
    </span>
  );
}

export function EmptyIllustration() {
  return (
    <div className="empty-art" aria-hidden="true">
      <svg viewBox="0 0 160 112" width="160" height="112">
        <rect x="34" y="14" width="92" height="84" rx="10" fill="#fff" stroke="#D6D6D6" />
        <rect x="46" y="28" width="40" height="6" rx="3" fill="#131E29" opacity=".75" />
        <rect x="46" y="44" width="68" height="5" rx="2.5" fill="#D6D6D6" />
        <rect x="46" y="56" width="58" height="5" rx="2.5" fill="#E7E7E9" />
        <rect x="46" y="68" width="64" height="5" rx="2.5" fill="#E7E7E9" />
        <rect x="46" y="80" width="26" height="8" rx="4" fill="none" stroke="#737373" />
      </svg>
    </div>
  );
}

interface EmptyProps { heading: string; text: string; children?: ComponentChildren }

export function EmptyState({ heading, text, children }: EmptyProps) {
  return (
    <div className="empty">
      <EmptyIllustration />
      <h2 className="empty-title">{heading}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

/** The two live regions every page carries: pending and success copy, and failures. */
export function LiveRegions() {
  const { status, problem } = useStore(messageStore);
  return (
    <div className="live">
      <div role="status" aria-label="Desk updates" aria-live="polite" className={cx("live-status", status && "has-text")}>{status}</div>
      <div role="alert" aria-label="Desk problems" className={cx("live-problem", problem && "has-text")}>{problem}</div>
    </div>
  );
}

export function useHeadingFocus(title: string): void {
  useLayoutEffect(() => { document.title = `${title} · Interline Desk`; }, [title]);
}

/** Stays true once `done` has been true, so a page swaps its loading placeholder for its content once and never again. */
export function useSettled(done: boolean): boolean {
  const seen = useRef(false);
  if (done) seen.current = true;
  return seen.current;
}

/** One placeholder card for a page whose cards are still loading: it leaves the page when they all arrive together. */
export function PageSkeleton({ lines = 6 }: { lines?: number }) {
  return <div className="card" aria-busy="true"><Skeleton lines={lines} /></div>;
}

/** A one-line "tabular" figure with a caption under it. */
export function Stat({ value, caption }: { value: number | string; caption: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-caption">{caption}</span>
    </div>
  );
}

export function useOutside(ref: { current: HTMLElement | null }, onOutside: () => void, active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [active, onOutside, ref]);
}

export { cx };
