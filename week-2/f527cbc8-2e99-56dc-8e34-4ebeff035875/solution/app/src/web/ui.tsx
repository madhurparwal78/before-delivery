// Shared interface pieces: Notices, the refresh clock, links, busy buttons, fields, dialogs and the focus helper
// (brief: Interactions; Feedback states).
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type ErrorBody, NETWORK } from "./api";
import { dollars } from "./format";
import { SPRING, prefersReducedMotion, useSequence, useSlowLoad } from "./motion";
import { navigate } from "./router";

// ---- Notices ----

export type Tone = "pending" | "success" | "error";
export interface Notice {
  text: string;
  tone: Tone;
  serial: number;
}

export const NoticesContext = createContext<(text: string, tone: Tone) => void>(() => undefined);
export const useNotify = (): ((text: string, tone: Tone) => void) => useContext(NoticesContext);
/** A notice no user action caused (an offer, marks saved elsewhere, an alert): it joins, never replaces, an action's message. */
export const AnnounceContext = createContext<(text: string) => void>(() => undefined);
export const useAnnounce = (): ((text: string) => void) => useContext(AnnounceContext);

export const NETWORK_COPY = "Clinchline can't reach the server. Check your connection and try again.";

/** The failure line for an error the action has no own copy for. */
export const isNetwork = (error: ErrorBody): boolean => error.error === NETWORK;

/** The Notices line under the header: a fixed-height strip so a new message never shifts the page. */
export function NoticesRegion({ notice }: { notice: Notice | null }) {
  return (
    <div className="notices-strip" data-tone={notice?.tone ?? "idle"}>
      <span className="notices-label" aria-hidden="true">
        Notices
      </span>
      {/* The visible "Error:" prefix sits beside the live region, so Notices holds exactly the feedback copy. */}
      <div className="notices-tone" data-tone={notice?.tone ?? "idle"}>
        {notice?.tone === "error" ? <span className="prefix">Error:</span> : null}
        <div className="notices" role="status" aria-live="polite" aria-label="Notices" data-tone={notice?.tone ?? "idle"}>
          {notice ? <p key={notice.serial}>{notice.text}</p> : <p className="idle">No new notices.</p>}
        </div>
      </div>
    </div>
  );
}

// ---- Refresh clock ----

interface Refresh {
  /** Bumps after every action and on the 30 s / 10 s timer; screens reload when it changes. */
  tick: number;
  refresh: () => void;
  /** A screen says whether a pending row is on screen, which shortens the timer to 10 s. */
  setPending: (screen: string, pending: boolean) => void;
}

export const RefreshContext = createContext<Refresh>({ tick: 0, refresh: () => undefined, setPending: () => undefined });
export const useRefresh = (): Refresh => useContext(RefreshContext);

export function usePendingFlag(screen: string, pending: boolean): void {
  const { setPending } = useRefresh();
  useEffect(() => {
    setPending(screen, pending);
    return () => setPending(screen, false);
  }, [screen, pending, setPending]);
}

// ---- Reconciliation notices (brief: Interactions, Reconciliation notices) ----

interface Billable {
  id: string;
  pending: boolean;
  /** The announcement once it reaches billing. */
  copy: string;
  /** The row that plays `invoice-reconciled`. */
  element: () => HTMLElement | null;
}

/**
 * Remembers which invoices this screen last showed as pending and, when a refresh shows one in billing, plays the
 * row's `invoice-reconciled` sequence and announces it once; an invoice is never announced twice on a page.
 */
export function useReconciled(): (items: Billable[]) => void {
  const play = useSequence();
  const pending = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  return useCallback(
    (items: Billable[]) => {
      const landed: Billable[] = [];
      for (const item of items) {
        if (item.pending) pending.current.add(item.id);
        else if (pending.current.has(item.id) && !announced.current.has(item.id)) {
          announced.current.add(item.id);
          pending.current.delete(item.id);
          landed.push(item);
        }
      }
      if (!landed.length) return;
      // The rows re-render with their new status first, then play.
      requestAnimationFrame(() => {
        landed.forEach((item, index) => play("invoice-reconciled", item.element(), index === 0 ? landed.map((l) => l.copy).join(" ") : null, true));
      });
    },
    [play],
  );
}

/** The announcement for an invoice that reached billing (brief: Feedback states). */
export const billingCopy = (kind: "visit" | "trip", horse: string, totalCents: number): string =>
  kind === "trip"
    ? `Trip-share invoice for ${horse} is now in billing: ${dollars(totalCents)}.`
    : `Invoice for ${horse} is now in billing: ${dollars(totalCents)}.`;

// ---- Live streams ----

/**
 * Follows a server event stream. EventSource reconnects by itself with its last event id; a `reset` event means
 * the screen must fetch its rows again.
 */
export function useEventStream(url: string | null, onEvent: (event: string, data: unknown) => void): boolean {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!url) return;
    // The stream opens once the page load has settled, so the screen's first reads finish on their own; the
    // first open sends a synthetic reset that fetches the rows again and covers any change made in between.
    let source: EventSource | null = null;
    const names = ["booking_added", "booking_removed", "booking_moved", "day_status", "allocation_fixed", "reset", "marks_saved", "visit_closed"];
    const listeners = names.map((name) => {
      const listener = (event: MessageEvent<string>): void => {
        let data: unknown = null;
        try {
          data = JSON.parse(event.data);
        } catch {
          data = null;
        }
        handler.current(name, data);
      };
      return [name, listener] as const;
    });
    const open = (): void => {
      const stream = new EventSource(url);
      for (const [name, listener] of listeners) stream.addEventListener(name, listener);
      let first = true;
      stream.onopen = () => {
        setLive(true);
        if (first) handler.current("reset", null);
        first = false;
      };
      stream.onerror = () => setLive(false);
      source = stream;
    };
    // The delay runs on AbortSignal.timeout, a wall-clock timer, so a page whose timers are paused or faked still
    // opens its stream on time.
    let cancelled = false;
    const later = (): void => {
      if (typeof AbortSignal.timeout !== "function") return open();
      AbortSignal.timeout(STREAM_OPEN_DELAY_MS).addEventListener("abort", () => {
        if (!cancelled) open();
      }, { once: true });
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", later);
      const stream = source as EventSource | null;
      if (stream) {
        for (const [name, listener] of listeners) stream.removeEventListener(name, listener);
        stream.close();
      }
      setLive(false);
    };
  }, [url]);
  return live;
}

/** How long after the page load a live stream opens. */
const STREAM_OPEN_DELAY_MS = 900;

// ---- Links and buttons ----

/** An in-app link that pushes a history entry instead of reloading. */
export function AppLink({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: "primary" | "secondary" | "quiet" };

/** A button that is marked busy and disabled while its action is in flight (brief: Feedback states). */
export function Button({ busy = false, variant = "secondary", className, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={["btn", `btn-${variant}`, className].filter(Boolean).join(" ")}
      disabled={busy || disabled}
      aria-busy={busy ? "true" : undefined}
      {...rest}
    />
  );
}

/**
 * Runs an async action once at a time: the pending copy goes to Notices at once and the button is busy until the
 * answer arrives, so pressing again sends nothing.
 */
export function useAction(): [boolean, (pendingCopy: string, work: () => Promise<void>) => Promise<void>] {
  const notify = useNotify();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (pendingCopy: string, work: () => Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      notify(pendingCopy, "pending");
      try {
        await work();
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [notify],
  );
  return [busy, run];
}

/**
 * A ruled status word. The spaces around it keep it a separate word in the row's text (screen readers, copy and
 * text search) next to an amount in the neighbouring cell; the inline-flex box drops them visually.
 */
export function StatusTag({ status, children }: { status: string; children: ReactNode }) {
  return (
    <span className="status-tag" data-status={status}>
      {" "}
      {children}{" "}
    </span>
  );
}

// ---- Fields ----

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

/** A labelled control with its error under it, tied to the control as its description. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(described ? { "aria-describedby": described } : {}), ...(error ? { "aria-invalid": true } : {}) })}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          <span className="prefix">Error: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Moves focus to the first invalid control inside a form once its errors are on screen. */
export function focusFirstInvalid(root: HTMLElement | null): void {
  focusWhenReady(() => root?.querySelector<HTMLElement>("[aria-invalid='true']") ?? null);
}

// ---- Focus ----

/**
 * Focuses an element as soon as it can take focus: it may appear only after the next refresh, or sit behind a
 * modal dialog that is still closing, so focus is retried on each change until it lands.
 */
export function focusWhenReady(find: string | (() => HTMLElement | null)): void {
  const locate = typeof find === "string" ? () => document.querySelector<HTMLElement>(find) : find;
  const attempt = (): boolean => {
    const element = locate();
    if (!element || element.hasAttribute("disabled")) return false;
    element.focus();
    return document.activeElement === element;
  };
  queueMicrotask(() => {
    if (attempt()) return;
    const observer = new MutationObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "open"] });
    window.setTimeout(() => observer.disconnect(), 10_000);
  });
}

export const focusKey = (key: string): string => `[data-focus="${CSS.escape(key)}"]`;

// ---- Dialogs (adapted from kit/modules/a11y_dialog) ----

const FOCUSABLE = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("disabled") && !element.closest("[hidden],[inert]") && element.getClientRects().length > 0,
  );
}

/** A dialog that persists its last content so it can fade out after closing. */
export function useDialog<T>(): { data: T | null; open: boolean; show: (data: T) => void; hide: () => void } {
  const [state, setState] = useState<{ data: T | null; open: boolean }>({ data: null, open: false });
  const show = useCallback((data: T) => setState({ data, open: true }), []);
  const hide = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { ...state, show, hide };
}

interface ModalProps {
  title: string;
  open: boolean;
  /** Escape: the dialog's own dismiss action (release hold, keep booking, cancel). */
  onDismiss: () => void;
  /** The element that gets focus on open; defaults to the first field. */
  initialFocus?: string;
  children: ReactNode;
}

/** Native modal dialog: focus starts inside, Tab and Shift+Tab stay inside, Escape dismisses. */
export function Modal({ title, open, onDismiss, initialFocus, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const target = (initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(dialog)[0];
      target?.focus();
      // Focus is placed first; the dialog then grows from 96 % over 320 ms, springy (brief: Motion, Dialogs).
      if (!prefersReducedMotion()) {
        dialog.animate(
          [
            { opacity: 0, transform: "scale(0.96)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 320, easing: SPRING },
        );
      }
    } else if (!open && dialog.open) dialog.close();
  }, [open, initialFocus]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss.current();
      }}
      onKeyDown={(event) => {
        const dialog = ref.current;
        if (!dialog) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss.current();
        } else if (event.key === "Tab") {
          const items = focusables(dialog);
          const first = items[0];
          const last = items[items.length - 1];
          if (!first || !last) {
            event.preventDefault();
            return;
          }
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <h2 className="dialog-title" id={titleId}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}

// ---- Drawings ----

/** The empty-state horseshoe (original drawing). */
export function Horseshoe({ size = 56 }: { size?: number }) {
  return (
    <svg className="horseshoe" width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <path d="M14 50V26a14 14 0 0 1 28 0v24" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="square" />
      <path d="M14 50h7M35 50h7" stroke="var(--forge)" strokeWidth="7" />
      {[18, 30, 42].map((y) => (
        <g key={y} fill="var(--ground)">
          <circle cx={14 - 0.2 * (42 - y)} cy={y} r="1.6" />
          <circle cx={42 + 0.2 * (42 - y)} cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Horseshoe />
      <p>{children}</p>
    </div>
  );
}

/** The not-available copy: it names nothing from the requested record (brief: Screens, Not available). */
export function NotAvailable({ copy }: { copy: string }) {
  return (
    <div className="not-available">
      <Horseshoe />
      <p>{copy}</p>
    </div>
  );
}

/**
 * Skeleton rows of the same height as real rows while a load lasts more than 120 ms, with a shimmer crossing every
 * 1400 ms (a still block under reduced motion). The space is held from the start so content replaces it in place.
 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  const shown = useSlowLoad(true);
  return (
    <div className="skeleton" aria-hidden="true" data-shown={shown ? "true" : "false"}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
