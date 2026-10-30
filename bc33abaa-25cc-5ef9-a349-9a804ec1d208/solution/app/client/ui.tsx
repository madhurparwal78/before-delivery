// Shared interface pieces: navigation, busy buttons, dialogs with a focus trap, fields, live regions and icons.
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

// --- Navigation ------------------------------------------------------------------------------------------------

const routeListeners = new Set<() => void>();
window.addEventListener("popstate", () => routeListeners.forEach((l) => l()));

export function navigate(path: string): void {
  history.pushState(null, "", path);
  routeListeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useLayoutEffect(() => {
    const update = () => setPath(location.pathname);
    routeListeners.add(update);
    return () => { routeListeners.delete(update); };
  }, []);
  return path;
}

export function Link(props: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(props.href);
  };
  return <a {...props} onClick={onClick} />;
}

// --- Motion preference -----------------------------------------------------------------------------------------

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
export const prefersReducedMotion = () => motionQuery.matches;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(motionQuery.matches);
  useLayoutEffect(() => {
    const update = () => setReduced(motionQuery.matches);
    motionQuery.addEventListener("change", update);
    return () => motionQuery.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The stored still image the server inlined into the page for views without WebGL. */
export function stillImage(): string | null {
  const boot = document.getElementById("orrery-still");
  if (!boot?.textContent) return null;
  const data: { src?: unknown } = JSON.parse(boot.textContent);
  return typeof data.src === "string" ? data.src : null;
}

// --- Buttons ---------------------------------------------------------------------------------------------------

type ButtonProps = JSX.HTMLAttributes<HTMLButtonElement> & {
  busy?: boolean; variant?: "primary" | "danger" | "quiet"; small?: boolean; disabled?: boolean; type?: "button" | "submit";
};

/** A pending control is disabled and shows the busy bar, or the word "Working…" when motion is reduced. */
export function Button({ busy = false, variant, small, disabled, children, class: className, type = "button", ...rest }: ButtonProps) {
  const reduced = useReducedMotion();
  const classes = ["button", variant, small ? "small" : "", typeof className === "string" ? className : ""].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type} class={classes} disabled={disabled || busy} aria-busy={busy ? "true" : undefined}>
      {children}
      {busy && reduced ? <span class="busy-text">Working…</span> : null}
      {busy && !reduced ? <span class="busy-bar" aria-hidden="true" /> : null}
    </button>
  );
}

/** Runs an async action with the control marked pending until it settles. */
export function useBusy(): [boolean, <T>(work: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { return await work(); } finally { setBusy(false); }
  };
  return [busy, run];
}

// --- Panel motion ----------------------------------------------------------------------------------------------

const ENTER_MS = 240;
const LEAVE_MS = 160;

/** Panels, sheets and dialogs fade in and slide about 8 px into place; with reduced motion they only fade. */
export function enterMotion(el: HTMLElement, axis: "x" | "y" = "y"): void {
  const shift = axis === "x" ? "translateX(8px)" : "translateY(8px)";
  const frames = prefersReducedMotion()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: shift }, { opacity: 1, transform: "none" }];
  el.animate(frames, { duration: ENTER_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
}

/** The leaving half: about 160 ms, then done. */
export function leaveMotion(el: HTMLElement, done: () => void, axis: "x" | "y" = "y"): void {
  const shift = axis === "x" ? "translateX(8px)" : "translateY(8px)";
  const frames = prefersReducedMotion()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: shift }];
  const animation = el.animate(frames, { duration: LEAVE_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  let finished = false;
  const once = () => { if (!finished) { finished = true; done(); } };
  animation.addEventListener("finish", once);
  window.setTimeout(once, LEAVE_MS + 60);
}

// --- Dialogs ---------------------------------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string; onClose: () => void; children: (close: () => void) => ComponentChildren;
  alert?: boolean; initialFocus?: string; returnFocus?: HTMLElement | null;
}

/** A modal dialog: focus stays inside, Escape closes, focus returns to the control that opened it. */
export function Dialog({ title, onClose, children, alert = false, initialFocus, returnFocus }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const leaving = useRef(false);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2)}`).current;

  const close = () => {
    const node = ref.current;
    if (leaving.current || !node) return;
    leaving.current = true;
    leaveMotion(node, () => { onClose(); opener.current?.focus(); });
  };

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    enterMotion(node);
    const target = (initialFocus ? node.querySelector<HTMLElement>(initialFocus) : null) ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node;
    target.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!ref.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  };

  return (
    <div class="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} class="dialog" role={alert ? "alertdialog" : "dialog"} aria-modal="true"
        aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <header><h2 id={titleId}>{title}</h2></header>
        {children(close)}
      </div>
    </div>
  );
}

// --- Fields ----------------------------------------------------------------------------------------------------

let fieldCounter = 0;
const useId = (prefix: string) => useRef(`${prefix}-${++fieldCounter}`).current;

type FieldProps = JSX.HTMLAttributes<HTMLInputElement> & {
  label: string; error?: string; type?: string; value?: string | number; autocomplete?: string;
  min?: number; max?: number; step?: string; readOnly?: boolean; inputMode?: string; name?: string; required?: boolean; placeholder?: string;
};

export function Field({ label, error, ...input }: FieldProps) {
  const id = useId("field");
  const errorId = `${id}-error`;
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input {...input} id={id} aria-invalid={error ? "true" : undefined} aria-describedby={error ? errorId : undefined}
        aria-errormessage={error ? errorId : undefined} />
      {error ? <span class="field-error" id={errorId}>{error}</span> : null}
    </div>
  );
}

export function Status({ label, text, alert = false }: { label: string; text: string; alert?: boolean }) {
  return <div role="status" aria-label={label} aria-live="polite" class={`status-line${alert ? " field-error" : ""}`}>{text}</div>;
}

// --- Icons (drawn for this app) --------------------------------------------------------------------------------

const paths = {
  menu: "M4 7h16M4 12h16M4 17h16",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  sheet: "M4 4h16v16H4zM14 4v16",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  pin: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 8v4M12 14h.01",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  out: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  comment: "M4 5h16v11H9l-5 4z",
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
      <circle cx="16" cy="16" r="11" stroke="var(--putty)" />
      <circle cx="16" cy="16" r="5.5" />
      <circle cx="27" cy="16" r="2.6" fill="var(--cobalt)" stroke="none" />
      <path d="M16 3v4M16 25v4M3 16h4" stroke="var(--ink-muted)" />
    </svg>
  );
}

/** A drafted line drawing for empty states. */
export function EmptyDrawing() {
  return (
    <svg viewBox="0 0 96 64" aria-hidden="true" stroke-width="1.4">
      <rect x="6" y="10" width="84" height="44" stroke-dasharray="4 3" />
      <path d="M30 44 48 22l18 22z" />
      <circle cx="66" cy="22" r="5" />
      <path d="M6 58h84M6 56v4M90 56v4" />
    </svg>
  );
}
