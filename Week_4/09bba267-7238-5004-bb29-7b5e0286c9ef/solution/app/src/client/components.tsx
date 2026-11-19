// Shared pieces: the page frame, dialogs, ledgers, the server-led countdown and links.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatMoney } from "../shared/rules.js";
import { setRegion } from "./announce.js";
import { follow } from "./router.js";

export function Link({ href, children, ...rest }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }): JSX.Element {
  return <a href={href} onClick={follow} {...rest}>{children}</a>;
}

export function Frame({ path, children }: { path: string; children: ComponentChildren }): JSX.Element {
  const here = (href: string): boolean => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header class="masthead">
        <div class="masthead-inner">
          <Link href="/" class="wordmark">Halyard Hall</Link>
          <nav aria-label="Box office" class="site-nav">
            <Link href="/" aria-current={here("/") ? "page" : undefined}>Programme</Link>
            <Link href="/tickets" aria-current={here("/tickets") ? "page" : undefined}>My tickets</Link>
          </nav>
        </div>
      </header>
      <div role="status" aria-label="Box office updates" aria-live="polite" class="visually-hidden" ref={setRegion} />
      <main id="main" class="page">{children}</main>
      <footer class="colophon">
        <Fleuron />
        <p>Halyard Hall · 900 reserved seats · Box office sales direct to you</p>
      </footer>
    </>
  );
}

function Fleuron(): JSX.Element {
  return (
    <svg class="fleuron" viewBox="0 0 64 12" aria-hidden="true" focusable="false">
      <line x1="0" y1="6" x2="24" y2="6" />
      <path d="M32 1 L37 6 L32 11 L27 6 Z" />
      <line x1="40" y1="6" x2="64" y2="6" />
    </svg>
  );
}

/** A venue-time start label that breaks only after its date, never inside the time. */
export function VenueStart({ label }: { label: string }): JSX.Element {
  const comma = label.indexOf(", ");
  return <>{label.slice(0, comma + 2)}<span class="nowrap">{label.slice(comma + 2)}</span></>;
}

/** A designed empty state: the fleuron rule over an italic line, and any follow-on action. */
export function EmptyState({ text, children }: { text: string; children?: ComponentChildren }): JSX.Element {
  return (
    <div class="empty">
      <Fleuron />
      <p class="empty-line">{text}</p>
      {children}
    </div>
  );
}

interface LedgerLine {
  label: string;
  cents: number;
  total?: boolean;
}

/** Ruled lines with the amounts in their own right-aligned column of tabular figures. */
export function Ledger({ lines }: { lines: LedgerLine[] }): JSX.Element {
  return (
    <div class="ledger">
      {lines.map((line) => (
        <div class={line.total ? "ledger-row ledger-total" : "ledger-row"} key={line.label}>
          <span>{line.label}</span> <span class="amount">{formatMoney(line.cents)}</span>
        </div>
      ))}
    </div>
  );
}

export const totalsLines = (t: { faceCents: number; seatFeesCents: number; orderFeeCents: number; totalCents: number }): LedgerLine[] => [
  { label: "Face value", cents: t.faceCents },
  { label: "Seat fees", cents: t.seatFeesCents },
  { label: "Order fee", cents: t.orderFeeCents },
  { label: "Total", cents: t.totalCents, total: true },
];

export const clockText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Counts down from the seconds the server last reported (`answer` changes on every server answer), once a second,
 * without reading the device's date; at zero it calls `onZero` so the page can ask the server.
 */
export function useCountdown(answer: { seconds: number | null; at: number }, onZero: () => void): number | null {
  const [left, setLeft] = useState<number | null>(answer.seconds);
  const zero = useRef(onZero);
  zero.current = onZero;
  useEffect(() => {
    setLeft(answer.seconds);
    if (answer.seconds === null) return undefined;
    let remaining = answer.seconds;
    if (remaining <= 0) {
      zero.current();
      return undefined;
    }
    const timer = setInterval(() => {
      remaining -= 1;
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        zero.current();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [answer.seconds, answer.at]);
  return left;
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface DialogProps {
  label: string;
  open: boolean;
  /** While true (a payment is confirming), Escape does nothing. */
  busy?: boolean;
  onClose: () => void;
  /** Where focus goes when the control that opened the dialog is gone. */
  fallbackFocus?: () => HTMLElement | null;
  class?: string;
  children: ComponentChildren;
}

/** A modal `<dialog>`: focus starts on its first field, Tab and Shift+Tab stay inside, Escape closes, focus returns. */
export function Dialog({ label, open, busy = false, onClose, fallbackFocus, class: className, children }: DialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef({ busy, onClose, fallbackFocus });
  latest.current = { busy, onClose, fallbackFocus };

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const back = opener.current?.isConnected ? opener.current : latest.current.fallbackFocus?.() ?? null;
      back?.focus();
    }
  }, [open]);

  const onKeyDown = (event: KeyboardEvent): void => {
    const dialog = ref.current;
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!latest.current.busy) latest.current.onClose();
    } else if (event.key === "Tab") {
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <dialog ref={ref} aria-label={label} class={className ? `dialog ${className}` : "dialog"} onKeyDown={onKeyDown}
      onCancel={(event) => event.preventDefault()}>
      {open ? children : null}
    </dialog>
  );
}

/** An error summary whose links move focus to the fields they name. */
export function ErrorSummary({ errors, fieldIds }: { errors: Record<string, string>; fieldIds: Record<string, string> }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const keys = Object.keys(errors).filter((k) => fieldIds[k]);
  useEffect(() => {
    if (keys.length) ref.current?.focus();
  }, [keys.join(",")]);
  if (keys.length === 0) return null;
  return (
    <div class="error-summary" ref={ref} tabIndex={-1}>
      <h3>Check these details</h3>
      <ul>
        {keys.map((k) => (
          <li key={k}>
            <a href={`#${fieldIds[k]}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(fieldIds[k])?.focus();
            }}>{errors[k]}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  autofocus?: boolean;
  onInput: (value: string) => void;
}

export function Field({ id, label, value, error, type = "text", autoComplete, hint, autofocus, onInput }: FieldProps): JSX.Element {
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class={error ? "field field-invalid" : "field"}>
      <label for={id}>{label}</label>
      {hint ? <p class="field-hint" id={`${id}-hint`}>{hint}</p> : null}
      <input id={id} type={type} value={value} autoComplete={autoComplete} aria-invalid={error ? "true" : undefined}
        aria-describedby={described} data-autofocus={autofocus ? "" : undefined}
        onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)} />
      {error ? <p class="field-error" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

/** A notice banner region; empty when there is nothing to say. `reserve` keeps its line while empty. */
export function NoticeRegion({ label, text, reserve = false }: { label: string; text: string; reserve?: boolean }): JSX.Element {
  const empty = reserve ? "notice notice-empty" : "notice notice-empty collapse";
  return <section aria-label={label} class={text ? "notice" : empty}><p>{text}</p></section>;
}
