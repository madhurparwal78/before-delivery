/** Shared building blocks: dialogs, fields, chips, tables, loading and submitting. */
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type FormEvent, type ReactNode,
} from "react";
import { ApiError, getJson } from "./api.js";
import { useLive } from "./live.js";
import { PENDING } from "../shared/copy.js";

// ---- loading --------------------------------------------------------------------------------

interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True once the first request has answered (data or refusal); never false again, so refetching leaves the content mounted. */
  settled: boolean;
  /** Fetches again; resolves with the answer, or null when a newer request has taken over. */
  reload: () => Promise<T | null>;
  set: (value: T) => void;
}

/** Runs `fetcher` on mount and when `deps` change; an answer to a superseded request is dropped. */
export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const latest = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<T | null> => {
    const ticket = ++latest.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const value = await fetchRef.current(abort.signal);
      if (ticket !== latest.current) return null;
      setData(value);
      setError(null);
      return value;
    } catch (failure) {
      if (ticket !== latest.current || abort.signal.aborted) return null;
      if (failure instanceof ApiError) setError(failure);
      else throw failure;
      return null;
    } finally {
      if (ticket === latest.current) {
        setLoading(false);
        setSettled(true);
      }
    }
  }, []);

  useLayoutEffect(() => {
    setLoading(true);
    void load();
    return () => {
      latest.current++;
      controller.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, settled, reload: load, set: setData };
}

/**
 * True once every first load of a screen has answered. Screens show their field and heading at once and add the
 * sections below in one step, so a section filling in never pushes a painted one down (no layout shift).
 */
export function answered(...loads: { settled?: boolean; ready?: boolean }[]): boolean {
  return loads.every((load) => load.settled ?? load.ready ?? true);
}

/** Calls `tick` every `seconds` while mounted (the page clock drives it). */
export function usePoll(tick: () => void, seconds: number, active = true): void {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => ref.current(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [seconds, active]);
}

export interface Collection<T> {
  items: T[];
  /** True once the first `eager` pages (or the whole collection) have arrived. */
  ready: boolean;
  reload: () => void;
}

/** Walks a collection page by page; later pages keep arriving after `ready`, so option lists can open at once. */
export function useCollection<T>(path: string, eager = 2): Collection<T> {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let live = true;
    (async () => {
      const found: T[] = [];
      let cursor: string | null = null;
      const joiner = path.includes("?") ? "&" : "?";
      for (let page = 1; page <= 200 && live; page++) {
        const answer: { items: T[]; next_cursor: string | null } = await getJson(`${path}${joiner}limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, abort.signal);
        found.push(...answer.items);
        cursor = answer.next_cursor;
        if (!live) return;
        setItems([...found]);
        if (!cursor || page >= eager) setReady(true);
        if (!cursor) break;
      }
    })().catch((failure: unknown) => {
      if (abort.signal.aborted) return;
      if (failure instanceof ApiError) setReady(true);
      else throw failure;
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [path, eager, round]);
  return { items, ready, reload: () => setRound((value) => value + 1) };
}

// ---- submitting -----------------------------------------------------------------------------

/** A form's submit state; `run` shows the pending copy, then the success copy or the refusal, and says whether it succeeded. */
export function useSubmitter() {
  const { say, refuse } = useLive();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const gate = useRef(false);
  const run = useCallback(
    async (action: () => Promise<void>, pending: string = PENDING.save) => {
      if (gate.current) return false;
      gate.current = true;
      setBusy(true);
      setErrors({});
      refuse(null);
      say(pending);
      try {
        await action();
        return true;
      } catch (failure) {
        if (!(failure instanceof ApiError)) throw failure;
        if (failure.status === 422 && failure.body.fields) setErrors(failure.body.fields);
        else if (failure.code !== "unauthenticated") refuse(failure.body.message);
        return false;
      } finally {
        gate.current = false;
        setBusy(false);
      }
    },
    [say, refuse],
  );
  const clear = useCallback(() => setErrors({}), []);
  return { busy, errors, run, clear };
}

// ---- dialogs --------------------------------------------------------------------------------

/** Closes the open dialog; focus returns to the control that opened it unless a landing route moves it. */
const DialogContext = createContext<((restoreFocus?: boolean) => void) | null>(null);
export const useDialog = () => {
  const close = useContext(DialogContext);
  if (!close) throw new Error("Dialog is missing");
  return { close };
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const restore = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current!;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea") ?? dialog.querySelector<HTMLElement>("button");
    first?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (restore.current) opener.current?.focus();
    };
  }, []);

  const close = (restoreFocus = true) => {
    restore.current = restoreFocus;
    closeRef.current();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <DialogContext.Provider value={close}>
      <dialog ref={ref} aria-labelledby={titleId} className="dialog" onKeyDown={onKeyDown} onCancel={(event) => event.preventDefault()}>
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        {children}
      </dialog>
    </DialogContext.Provider>
  );
}

export function DialogForm({ onSubmit, children, submit, busy, disabled }: { onSubmit: () => void; children: ReactNode; submit: string; busy: boolean; disabled?: boolean }) {
  const { close } = useDialog();
  const handle = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={handle} noValidate className="dialog-form">
      {children}
      <div className="dialog-actions">
        <button type="submit" className="button primary" aria-busy={busy || undefined} disabled={disabled}>
          {submit}
        </button>
        <button type="button" className="button" onClick={() => close(true)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---- fields ---------------------------------------------------------------------------------

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function FieldShell({ label, error, hint, children }: FieldShellProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy: error ? errorId : undefined, invalid: Boolean(error) })}
      {hint ? <p className="field-hint">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({ label, value, onChange, error, type = "text", hint, autoComplete, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; error?: string | undefined; type?: string; hint?: string; autoComplete?: string; inputMode?: "numeric" | "text";
}) {
  return (
    <FieldShell label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} autoComplete={autoComplete ?? "off"} inputMode={inputMode} spellCheck={false} />
      )}
    </FieldShell>
  );
}

export function TextArea({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string | undefined }) {
  return (
    <FieldShell label={label} error={error}>
      {({ id, describedBy, invalid }) => <textarea id={id} value={value} rows={3} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
    </FieldShell>
  );
}

interface Option {
  value: string;
  label: string;
}

export function SelectField({ label, value, onChange, options, error, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; options: Option[]; error?: string | undefined; placeholder?: string;
}) {
  return (
    <FieldShell label={label} error={error}>
      {({ id, describedBy, invalid }) => (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

// ---- chips, tables, states --------------------------------------------------------------------

export function Chip({ children, tone }: { children: ReactNode; tone?: "ink" | "cobalt" | "plain" }) {
  return <span className={`chip chip-${tone ?? "plain"}`}>{children}</span>;
}

interface TableRow {
  key: string;
  cells: ReactNode[];
  style?: React.CSSProperties;
  /** Marks the first row of a group; groups are separated by spacing alone. */
  groupStart?: boolean;
}

export function DataTable({ label, headers, rows }: { label: string; headers: string[]; rows: TableRow[] }) {
  return (
    <div className="table-wrap">
      <table aria-label={label} role="table" className="data-table">
        <thead role="rowgroup">
          <tr role="row">
            {headers.map((header) => (
              <th key={header} role="columnheader" scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.key} role="row" style={row.style} data-group={row.groupStart ? "start" : undefined}>
              {row.cells.map((cell, index) => (
                <td key={headers[index] ?? index} role="cell" data-label={headers[index]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 96 96" width="72" height="72" aria-hidden="true" focusable="false">
        <path d="M12 84 V12 L84 84 Z" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M12 60 H36 M12 36 H60" stroke="currentColor" strokeWidth="2" />
      </svg>
      <p>{children}</p>
    </div>
  );
}


/** One figure and its unit; the unit keeps its own case (m², ft², mm, in) inside uppercase display type. */
function Measure({ text }: { text: string }) {
  const space = text.lastIndexOf(" ");
  return (
    <>
      {text.slice(0, space)}
      <span className="unit">{text.slice(space)}</span>
    </>
  );
}

/**
 * A figure in two units: `24.68 m²` then `(265.70 ft²)`, each kept whole on one line. `stacked` sets the two
 * on lines of their own (poster and card figures), so every figure in a row reads the same.
 */
export function UnitPair({ parts, stacked = false }: { parts: [string, string]; stacked?: boolean }) {
  if (stacked) {
    return (
      <>
        <span className="figure-line">
          <Measure text={parts[0]} />
        </span>{" "}
        <span className="figure-line figure-second">
          <Measure text={parts[1]} />
        </span>
      </>
    );
  }
  return (
    <>
      <span className="nowrap">
        <Measure text={parts[0]} />
      </span>{" "}
      <span className="nowrap">
        (<Measure text={parts[1]} />)
      </span>
    </>
  );
}
