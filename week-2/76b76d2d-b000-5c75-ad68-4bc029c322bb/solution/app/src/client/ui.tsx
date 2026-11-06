import type { ComponentChildren, JSX, RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Check, ChevronDown, Languages, Menu, TriangleAlert, X } from "lucide";
import { formatMoney } from "../shared/domain.ts";
import type { ApiError, ApiResult } from "./api.ts";
import { leaveGhost, riseIn, useApp } from "./context.tsx";

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];
const ICONS = { menu: Menu, close: X, languages: Languages, alert: TriangleAlert, chevron: ChevronDown, check: Check } satisfies Record<string, IconNode>;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {ICONS[name].map(([tag, attrs]) => {
        const Tag = tag as "path";
        return <Tag {...(attrs as JSX.SVGAttributes<SVGPathElement>)} />;
      })}
    </svg>
  );
}

/** Numbers a patron reads like a projectionist's log are set in mono (brief: Type). */
export function Num({ children }: { children: ComponentChildren }) {
  return <span class="num">{children}</span>;
}

/** Copy with each of `parts` (dates, times, amounts) set in mono; the text itself is unchanged. */
export function withNum(text: string, parts: string[]): ComponentChildren {
  const wanted = parts.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!wanted.length) return text;
  const pattern = new RegExp(`(${wanted.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return text.split(pattern).map((piece, i) => (i % 2 === 1 ? <Num key={i}>{piece}</Num> : piece));
}

/** The status and alert pair of a page (brief: Rules for every async action). */
export function Feedback({ statusName, alertName, status, error, children }: {
  statusName: string; alertName: string; status: string; error: string; children?: ComponentChildren;
}) {
  const extra = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div class="feedback">
      <div role="status" aria-live="polite" aria-label={statusName} class="status-line">{status}</div>
      <div role="alert" aria-label={alertName} class={error || extra ? "alert-line is-shown" : "alert-line"}>
        {error ? <p>{error}</p> : null}
        {children}
      </div>
    </div>
  );
}

export type Action = {
  busy: boolean;
  status: string;
  error: string;
  fields: Record<string, string>;
  setStatus: (text: string) => void;
  setError: (text: string) => void;
  clear: () => void;
  run: <T>(call: () => Promise<ApiResult<T>>, onDone: (data: T) => string | void, onError?: (error: ApiError) => void) => Promise<boolean>;
};

/** In flight: busy and `Working…`; success: the action's copy; error: the API message verbatim plus field messages. */
export function useAction(): Action {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  return {
    busy, status, error, fields, setStatus, setError,
    clear() {
      setError("");
      setFields({});
    },
    async run(call, onDone, onError) {
      setBusy(true);
      setStatus(t.working);
      setError("");
      setFields({});
      const result = await call();
      setBusy(false);
      if (result.ok) {
        setStatus(onDone(result.data) ?? "");
        return true;
      }
      setStatus("");
      setError(result.error.message);
      setFields(result.error.fields ?? {});
      onError?.(result.error);
      return false;
    },
  };
}

let fieldSeq = 0;
function useId(prefix: string): string {
  const ref = useRef("");
  if (!ref.current) ref.current = `${prefix}-${++fieldSeq}`;
  return ref.current;
}

type FieldProps = {
  label: string; value: string; onInput: (value: string) => void; error?: string | undefined;
  type?: string; autocomplete?: string; multiline?: boolean; inputRef?: RefObject<HTMLInputElement>;
  onBlur?: () => void; inputMode?: "decimal" | "numeric" | "text"; min?: number; max?: number;
};

export function Field({ label, value, onInput, error, type = "text", autocomplete, multiline, inputRef, onBlur, inputMode, min, max }: FieldProps) {
  const id = useId("field");
  const described = error ? `${id}-error` : undefined;
  return (
    <div class={error ? "field has-error" : "field"}>
      <label for={id}>{label}</label>
      {multiline ? (
        <textarea id={id} value={value} rows={5} aria-describedby={described} aria-invalid={error ? "true" : undefined}
          onInput={(e) => onInput(e.currentTarget.value)} onBlur={onBlur} />
      ) : (
        <input id={id} ref={inputRef} type={type} value={value} autocomplete={autocomplete} inputMode={inputMode} min={min} max={max}
          aria-describedby={described} aria-invalid={error ? "true" : undefined} onInput={(e) => onInput(e.currentTarget.value)} onBlur={onBlur} />
      )}
      {error ? <p class="field-error" id={described}>{error}</p> : null}
    </div>
  );
}

export function SelectField({ label, value, onChange, options, error }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; error?: string | undefined;
}) {
  const id = useId("select");
  const described = error ? `${id}-error` : undefined;
  return (
    <div class={error ? "field has-error" : "field"}>
      <label for={id}>{label}</label>
      <select id={id} value={value} aria-describedby={described} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error ? <p class="field-error" id={described}>{error}</p> : null}
    </div>
  );
}

/** Radio cards: native radios sized as 44px+ targets (brief: Controls and contrast). */
export function RadioCards<V extends string>({ name, legend, value, onChange, options }: {
  name: string; legend: string; value: V; onChange: (value: V) => void; options: { value: V; label: string; detail?: ComponentChildren }[];
}) {
  return (
    <fieldset class="radio-cards" role="radiogroup" aria-label={legend}>
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} class={o.value === value ? "radio-card is-checked" : "radio-card"}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} aria-label={o.label} onChange={() => onChange(o.value)} />
          <span class="radio-card-label">{o.label}</span>
          {o.detail ? <span class="radio-card-detail">{o.detail}</span> : null}
          <span class="radio-card-mark"><Icon name="check" /></span>
        </label>
      ))}
    </fieldset>
  );
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/**
 * Dialog (brief: Dialogs): focus to its first field or button, Tab and Shift+Tab cycle inside,
 * Escape or Close shut it and return focus to the opener (or to `returnTo` when the caller names one).
 */
export function Dialog({ title, open, onClose, returnFocus, children }: {
  title: string; open: boolean; onClose: () => void; returnFocus?: RefObject<HTMLElement>; children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Children stay mounted through the closing render so the leave copy shows the whole dialog.
  const [mounted, setMounted] = useState(open);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMounted(true);
      dialog.showModal();
      riseIn(dialog);
      const first = dialog.querySelector<HTMLElement>("input, textarea, select") ?? focusables(dialog)[0];
      first?.focus();
    } else if (!open && dialog.open) {
      leaveGhost(dialog);
      dialog.close();
      setMounted(false);
      (returnFocus?.current ?? opener.current)?.focus();
    }
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    const dialog = ref.current;
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
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
    <dialog ref={ref} class="dialog" aria-label={title} onKeyDown={onKeyDown} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div class="dialog-head">
        <h2>{title}</h2>
      </div>
      {open || mounted ? children : null}
    </dialog>
  );
}

type MenuOption<V extends string> = { value: V; label: string };

/** Option menu (brief: Option menus): opener + listbox, focus on the selected option, arrows, Enter, Escape, Tab. */
export function OptionMenu<V extends string>({ openerLabel, listLabel, value, options, onChange, disabled }: {
  openerLabel: string; listLabel: string; value: V; options: MenuOption<V>[]; onChange: (value: V) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    riseIn(listRef.current);
    listRef.current.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [open]);
  const dismiss = () => {
    leaveGhost(listRef.current);
    setOpen(false);
  };
  const close = (focusOpener: boolean) => {
    dismiss();
    if (focusOpener) openerRef.current?.focus();
  };
  const choose = (next: V) => {
    onChange(next);
    close(true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[Math.min(items.length - 1, Math.max(0, index + step))]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[index];
      if (option) choose(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      const opener = openerRef.current;
      dismiss();
      if (!opener) return;
      if (event.shiftKey) {
        opener.focus();
        return;
      }
      const all = focusables(document.body);
      const next = all[all.indexOf(opener) + 1];
      (next ?? opener).focus();
    }
  };
  return (
    <div class="option-menu">
      <button ref={openerRef} type="button" class="menu-opener" aria-haspopup="listbox" aria-expanded={open ? "true" : "false"} disabled={disabled}
        onClick={() => (open ? dismiss() : setOpen(true))}>
        <span>{openerLabel}</span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <ul ref={listRef} role="listbox" aria-label={listLabel} class="menu-list" onKeyDown={onKeyDown}>
          {options.map((o) => (
            <li key={o.value} role="option" tabIndex={-1} aria-selected={o.value === value ? "true" : "false"} class="menu-option"
              onClick={() => choose(o.value)}>
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PriceSummary({ label, rows }: { label: string; rows: [string, number | null, boolean?][] }) {
  const { locale } = useApp();
  return (
    <table class="price-summary" aria-label={label}>
      <tbody>
        {rows.filter(([, value]) => value !== null).map(([name, value, strong]) => (
          <tr key={name} class={strong ? "is-total" : undefined}>
            <th scope="row">{name}</th>
            <td><Num>{formatMoney(value ?? 0, locale)}</Num></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
