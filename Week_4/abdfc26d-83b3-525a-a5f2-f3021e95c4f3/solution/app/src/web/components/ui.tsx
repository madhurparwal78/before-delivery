import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { copy } from "../copy";
import { useReducedMotion } from "../session";

// ---- Lucide outline icons (ISC), inlined ----

const ICONS = {
  arrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
  arrowUpRight: ["M7 7h10v10", "M7 17 17 7"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  play: ["M6 3 20 12 6 21 6 3z"],
  pause: ["M14 4h4v16h-4z", "M6 4h4v16H6z"],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  clapperboard: ["M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z", "m6.2 5.3 3.1 3.9", "m12.4 3.4 3.1 4", "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"],
  user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  cornerDownLeft: ["M20 4v7a4 4 0 0 1-4 4H4", "m9 10-5 5 5 5"],
  save: ["M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7", "M7 3v4a1 1 0 0 0 1 1h7"],
  shuffle: ["m18 14 4 4-4 4", "m18 2 4 4-4 4", "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22", "M2 6h1.9c1.5 0 2.9.9 3.6 2.2", "M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"],
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// ---- polite live regions that keep each announcement as its own node ----

export interface Announcer {
  messages: { id: number; text: string }[];
  say: (...texts: string[]) => void;
}

let nextMessage = 1;

export function useAnnouncer(initial?: string | null): Announcer {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>(() => (initial ? [{ id: nextMessage++, text: initial }] : []));
  const say = useCallback((...texts: string[]) => {
    setMessages((current) => [...current, ...texts.map((text) => ({ id: nextMessage++, text }))].slice(-4));
  }, []);
  return { messages, say };
}

export function LiveStatus({ label, announcer, className = "" }: { label: string; announcer: Announcer; className?: string }) {
  const last = announcer.messages[announcer.messages.length - 1]?.id;
  return (
    <div role="status" aria-live="polite" aria-label={label} className={`live-status ${className}`}>
      {announcer.messages.map((m) => (
        <p key={m.id} className={m.id === last ? "live-latest" : "live-older"}>
          {m.text}
        </p>
      ))}
    </div>
  );
}

// ---- the assistant render-status pixel panel ----

export type AssistantState = "idle" | "drafting" | "rendering" | "error";

const EYES = new Set([32, 33, 42, 43, 36, 37, 46, 47]);
/** The cells under the 45° cut of the bottom-right corner. */
const CUT = new Set([89, 98, 99]);
const BASE = Array.from({ length: 100 }, (_, i) => (i < 20 ? (i % 3 === 0 ? 2 : i % 2) : (i * 7) % 4));
/** Fixed reduced-motion patterns: one quiet shade change per state, so each state reads differently. */
const STILL_PATTERN: Record<AssistantState, number[]> = {
  idle: [],
  drafting: [54, 65, 76],
  rendering: [52, 63, 74, 85, 57, 68],
  error: [],
};

export function PixelPanel({ state, size = "large" }: { state: AssistantState; size?: "large" | "small" }) {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState<Map<number, number>>(new Map());
  const busy = state === "drafting" || state === "rendering";
  useEffect(() => {
    setLit(new Map());
    if (!busy || reduced) return;
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      setLit((current) => {
        const next = new Map(current);
        let cell = 20 + ((tick * 37) % 80);
        while (EYES.has(cell) || CUT.has(cell)) cell = 20 + ((cell + 3) % 80);
        next.set(cell, (next.get(cell) ?? 0) === 0 ? 1 + (tick % 3) : 0);
        return next;
      });
    }, 150);
    return () => window.clearInterval(timer);
  }, [busy, reduced, state]);
  const pattern = reduced ? new Map(STILL_PATTERN[state].map((c) => [c, 2])) : lit;
  return (
    <figure className={`pixel-panel pixel-${size} pixel-${state}`}>
      <div role="img" aria-label={`Assistant status: ${state}`} className="pixel-grid">
        <svg className="pixel-plate" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <polygon points="0,0 100,0 100,80 80,100 0,100" shapeRendering="crispEdges" vectorEffect="non-scaling-stroke" />
        </svg>
        {BASE.map((shade, i) => (
          <span
            key={i}
            className={CUT.has(i) ? "px cut" : EYES.has(i) ? "px eye" : i < 20 ? `px olive o${shade}` : `px body b${shade}`}
            data-lit={pattern.get(i) ?? 0}
          />
        ))}
      </div>
      <figcaption>Assistant / {state}</figcaption>
    </figure>
  );
}

// ---- modal dialogs and sheets: focus kept inside, Escape closes, focus returns ----

export function Dialog({
  open,
  label,
  onClose,
  returnFocus,
  initialFocus,
  variant = "center",
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  initialFocus?: string;
  variant?: "center" | "sheet";
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reduced = useReducedMotion();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    const target = (initialFocus ? node?.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(node)[0];
    target?.focus();
    const returnTo = returnFocus.current;
    // keys are handled at the window so the dialog keeps them even when a control it disabled dropped focus
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(panel.current);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const inside = panel.current?.contains(document.activeElement) ?? false;
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnTo?.focus();
    };
  }, [open, initialFocus, returnFocus]);
  if (!open) return null;
  return (
    <div className={`dialog-layer dialog-${variant}`}>
      <div className="dialog-backdrop" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog-panel ${reduced ? "" : "dialog-enter"}`}
      >
        <h2 id={titleId} className="dialog-title">
          {label}
        </h2>
        <button type="button" className="icon-button dialog-close" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  );
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

// ---- forms ----

export function ErrorSummary({ fields, ids }: { fields: Record<string, string>; ids: Record<string, string> }) {
  const entries = Object.entries(fields);
  if (!entries.length) return null;
  return (
    <div role="alert" className="error-summary">
      <p className="error-summary-title">{copy.checkFields(entries.length)}</p>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${ids[field] ?? field}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(ids[field] ?? field)?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

export function EmptyState({ sentence, action }: { sentence: string; action: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-sentence">{sentence}</p>
      {action}
    </div>
  );
}

/** Rises and fades in the first time it enters the viewport; in place under reduced motion. Its resting style is visible. */
export function Reveal({ children, className = "", as: Tag = "div", delay = 0 }: { children: ReactNode; className?: string; as?: "div" | "li" | "section"; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      node.animate([{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], {
        duration: 1400,
        delay,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay, reduced]);
  return (
    <Tag ref={ref as never} className={className || undefined}>
      {children}
    </Tag>
  );
}
