import { useCallback, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { ApiFail } from "../lib/api";
import { navigate, useParams, usePath, withQuery } from "../lib/router";
import type { Tone } from "../components/Panel";

// Small pieces every staff page shares: the "Staff updates" status, busy actions, fields, tables.

let staffText = "";
const staffListeners = new Set<() => void>();

function setStaffStatus(text: string): void {
  staffText = text;
  staffListeners.forEach((l) => l());
}

export function useStaffStatus(): string {
  return useSyncExternalStore(
    (listener) => {
      staffListeners.add(listener);
      return () => staffListeners.delete(listener);
    },
    () => staffText,
  );
}

const UNEXPECTED = new ApiFail(500, { error: "server_error", message: "Something went wrong on our side. Try again." });

/** Runs one write: shows `Saving`, then whatever text the write returns; keeps the failure for an alert. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const run = useCallback(async (write: () => Promise<string | void>): Promise<boolean> => {
    setPending(true);
    setError(null);
    setStaffStatus("Saving");
    try {
      const done = await write();
      setStaffStatus(done ?? "");
      return true;
    } catch (failure) {
      setStaffStatus("");
      setError(failure instanceof ApiFail ? failure : UNEXPECTED);
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { pending, error, run, clear };
}

export function ErrorAlert({ error, onReload }: { error: ApiFail | null; onReload?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="staff-alert">
      <p>{error.message}</p>
      {error.code === "stale_version" && onReload && (
        <button type="button" className="btn" onClick={onReload}>
          Reload latest
        </button>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
  type?: "text" | "number" | "search";
  inputMode?: "numeric" | "decimal" | "text";
  className?: string;
}

export function TextField({ label, value, onChange, error, hint, type = "text", inputMode, className }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ");
  return (
    <div className={`field ${className ?? ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
      />
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string | undefined;
}

export function SelectField({ label, value, onChange, options, error }: SelectProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** A status is a small colour block plus a word. */
export function StatusBlock({ word, tone }: { word: string; tone: Tone }) {
  return <span className={`block tone-${tone}`}>{word}</span>;
}

const ORDER_TONES: Record<string, Tone> = {
  placed: "blue",
  packed: "yellow",
  partially_shipped: "teal",
  shipped: "teal",
  out_for_delivery: "teal",
  delivered: "teal",
  cancelled: "red",
  requested: "yellow",
  submitted: "yellow",
  approved: "blue",
  under_review: "blue",
  in_transit: "blue",
  received: "blue",
  inspected: "blue",
  returned: "blue",
  repair: "blue",
  replacement: "blue",
  rejected: "red",
  refunded: "teal",
  exchanged: "teal",
  resolved: "teal",
  draft: "yellow",
  published: "teal",
  archived: "red",
};

export function toneOf(status: string): Tone {
  return ORDER_TONES[status] ?? "surface";
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="table-wrap" tabIndex={0}>
      {children}
    </div>
  );
}

/** Filters that live in the address: values read from the query string, writes push or replace. */
export function useFilters<K extends string>(keys: readonly K[]): [Record<K, string>, (patch: Partial<Record<K, string>>, replace?: boolean) => void] {
  const path = usePath();
  const params = useParams();
  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""])) as Record<K, string>;
  const set = (patch: Partial<Record<K, string>>, replace = true) => {
    navigate(withQuery(path, { ...values, ...patch }), { replace });
  };
  return [values, set];
}

/** Today, shifted by `days`, as YYYY-MM-DD in India Standard Time. */
export function istDay(days = 0): string {
  const shifted = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(shifted);
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="staff-title">{children}</h1>;
}
