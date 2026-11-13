import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { countdown, groupDigits } from "../shared/format.js";
import { prefersReducedMotion } from "./hooks.js";
import { useServerTime } from "./live.js";

/** A whole black or red band with one sentence at display size. */
export function Band({ tone, children, role, className = "" }: { tone: "black" | "red"; children: ReactNode; role?: "alert"; className?: string }) {
  return (
    <div className={`band band-${tone} ${className}`} role={role}>
      {tone === "red" && <TriangleAlert className="band-icon" size={40} strokeWidth={2.25} aria-hidden="true" />}
      <p className="band-sentence">{children}</p>
    </div>
  );
}

export function LabelledValue({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <div className="figure" id={id}>
      <span className="figure-label">{label}</span>
      <span className="figure-value">{children}</span>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  onValue: (value: string) => void;
};

/** One labelled text field in a form column; an error sits right under it, prefixed "Error:" so colour is never the only signal. */
export function TextField({ label, error, hint, onValue, id: given, ...input }: FieldProps) {
  const generated = useId();
  const id = given ?? generated;
  const note = `${id}-note`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? note : undefined}
        onChange={(event) => onValue(event.target.value)}
        {...input}
      />
      {hint && !error && (
        <p className="field-hint" id={note}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={note}>
          Error: {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  value,
  onValue,
  children,
  disabled,
}: {
  label: string;
  error?: string;
  value: string;
  onValue: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} aria-invalid={error ? true : undefined} onChange={(event) => onValue(event.target.value)}>
        {children}
      </select>
      {error && <p className="field-error">Error: {error}</p>}
    </div>
  );
}

const scaled = (plain: string): bigint => BigInt(plain.replace(".", ""));

function plainOf(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString();
  const digits = units.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

const COUNT_MS = 300;
const THOUSAND = 1000n;

/** A figure that counts from its old value to the server's new one, ending exactly on it; shown at once under reduced motion. */
export function CountedNumber({
  value,
  decimals = 0,
  render,
  fromZero = false,
}: {
  value: string;
  decimals?: number;
  render: (plain: string) => string;
  fromZero?: boolean;
}) {
  const target = scaled(value);
  const [shown, setShown] = useState(() => (fromZero && !prefersReducedMotion() ? 0n : target));
  const shownRef = useRef(target);
  shownRef.current = shown;

  useEffect(() => {
    if (shownRef.current === target) return;
    if (prefersReducedMotion()) {
      setShown(target);
      return;
    }
    const origin = shownRef.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const elapsed = Math.min(COUNT_MS, Math.floor(now - started));
      const left = COUNT_MS - elapsed;
      // Cubic ease-out in whole thousandths, so the money digits never pass through a float.
      const eased = BigInt(1000 - Math.floor((left ** 3 * 1000) / COUNT_MS ** 3));
      setShown(elapsed >= COUNT_MS ? target : origin + ((target - origin) * eased) / THOUSAND);
      if (elapsed < COUNT_MS) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <>{render(plainOf(shown, decimals))}</>;
}

/** A sideways-scrolling area the keyboard can reach and scroll. */
export function ScrollRegion({ label, className = "table-region", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function SealedMark() {
  return <Lock size={18} strokeWidth={2.25} aria-hidden="true" className="seal-icon" />;
}

export const groupedCount = (plain: string): string => groupDigits(plain);

/** A countdown to a server instant, ticking only as the server's clock events arrive. */
export function Countdown({ to, label, suffix = "", done, className }: { to: string; label: string; suffix?: string; done: string; className?: string }) {
  const now = Date.parse(useServerTime());
  const seconds = (Date.parse(to) - now) / 1000;
  return (
    <span role="timer" aria-label={label} className={className}>
      {seconds <= 0 ? done : `${countdown(seconds)}${suffix}`}
    </span>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** A modal dialog that keeps Tab inside, closes on Escape and returns focus to what opened it, even after a live redraw. */
export function Dialog({ title, onClose, children, returnSelector }: { title: string; onClose: () => void; children: ReactNode; returnSelector?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const opener = useRef<Element | null>(document.activeElement);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const origin = opener.current;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      dialog.close();
      const target = origin instanceof HTMLElement && origin.isConnected ? origin : returnSelector ? document.querySelector<HTMLElement>(returnSelector) : null;
      target?.focus();
    };
  }, [returnSelector]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close.current();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (!firstItem || !lastItem) return;
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onKeyDown={onKeyDown} onCancel={(event) => event.preventDefault()}>
      <div className="dialog-body">
        <h2 id={headingId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
