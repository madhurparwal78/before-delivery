// Shared interface pieces: fields, the error summary, live regions, bar marks, dialogs and the cadence menu.
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CADENCE_LABELS, CADENCES, type Cadence, pick, PROVINCES, TAX_LABELS } from '../shared/catalog.js';
import { formatMoney, formatRate, type Money, type TaxLine } from '../shared/money.js';
import { reducedMotion, useCopy } from './state';
import type { BarStatus } from './types';

/** A polite live region named for the brief. Its text is always exactly the latest message. */
export function Live({ name, text, class: className }: { name: string; text: string; class?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={name} class={`live ${className ?? ''}`}>
      {text}
    </div>
  );
}

export interface FieldError {
  id: string;
  message: string;
}

/** The "Check these fields" alert: one link per invalid field, in form order; takes focus on each submit. */
export function ErrorSummary({ errors, attempt }: { errors: FieldError[]; attempt: number }) {
  const { m } = useCopy();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [attempt]);
  if (!errors.length) return null;
  return (
    <div role="alert" aria-labelledby="summary-title" tabIndex={-1} class="summary" ref={ref}>
      <h2 id="summary-title" class="summary-title">
        {m.checkFieldsName}
      </h2>
      <ul>
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(e.id)?.focus();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Orders server field errors by the form's own field order. */
export function orderedErrors(fields: Record<string, string> | undefined, order: [string, string][]): FieldError[] {
  if (!fields) return [];
  return order.filter(([key]) => fields[key]).map(([key, id]) => ({ id, message: fields[key] as string }));
}

type InputProps = Omit<JSX.IntrinsicElements['input'], 'label' | 'error' | 'ref'>;

export function Field({
  id,
  label,
  error,
  inputRef,
  ...input
}: InputProps & { id: string; label: string; error?: string | undefined; inputRef?: RefObject<HTMLInputElement> }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} ref={inputRef} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} {...input} />
      {error && (
        <p id={`${id}-error`} class="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProvinceSelect({ value, onChange, error }: { value: string; onChange: (code: string) => void; error?: string | undefined }) {
  const { m, l } = useCopy();
  return (
    <div class="field">
      <label for="f-province">{m.province}</label>
      <select
        id="f-province"
        value={value}
        aria-invalid={error ? 'true' : undefined}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {PROVINCES.map((p) => (
          <option key={p.code} value={p.code}>
            {pick(p.name, l)}
          </option>
        ))}
      </select>
      {error && <p class="field-error">{error}</p>}
    </div>
  );
}

export interface Address {
  name: string;
  line1: string;
  city: string;
  postal_code: string;
}

export const ADDRESS_ORDER: [string, string][] = [
  ['shipping.province', 'f-province'],
  ['shipping.name', 'f-name'],
  ['shipping.line1', 'f-line1'],
  ['shipping.city', 'f-city'],
  ['shipping.postal_code', 'f-postal'],
];

export function AddressFields({
  value,
  onChange,
  errors,
  nameRef,
}: {
  value: Address;
  onChange: (next: Address) => void;
  errors: Record<string, string>;
  nameRef?: RefObject<HTMLInputElement>;
}) {
  const { m } = useCopy();
  const set = (key: keyof Address) => (e: Event) => onChange({ ...value, [key]: (e.target as HTMLInputElement).value });
  return (
    <fieldset class="group">
      <legend>{m.addressStep}</legend>
      <Field id="f-name" label={m.fullName} value={value.name} onInput={set('name')} autocomplete="name" error={errors['shipping.name']} inputRef={nameRef} />
      <Field id="f-line1" label={m.street} value={value.line1} onInput={set('line1')} autocomplete="address-line1" error={errors['shipping.line1']} />
      <div class="field-row">
        <Field id="f-city" label={m.city} value={value.city} onInput={set('city')} autocomplete="address-level2" error={errors['shipping.city']} />
        <Field id="f-postal" label={m.postalCode} value={value.postal_code} onInput={set('postal_code')} autocomplete="postal-code" error={errors['shipping.postal_code']} />
      </div>
    </fieldset>
  );
}

/** Labelled money rows: subtotal, optional extra rows, one per tax, total. */
export function PriceRows({ rows, taxes, total }: { rows: [string, Money, boolean?][]; taxes: TaxLine[]; total: [string, Money] }) {
  const { l } = useCopy();
  return (
    <dl class="price-rows">
      {rows.map(([label, money, negative]) => (
        <div class="price-row" key={label}>
          <dt>{label}</dt>
          <dd class="num">{formatMoney(negative ? -money.cents : money.cents, l)}</dd>
        </div>
      ))}
      {taxes.map((t) => (
        <div class="price-row" key={t.code}>
          <dt>
            {pick(TAX_LABELS[t.code], l)} ({formatRate(t.rate, l)})
          </dt>
          <dd class="num">{formatMoney(t.amount.cents, l)}</dd>
        </div>
      ))}
      <div class="price-row total">
        <dt>{total[0]}</dt>
        <dd class="num">{formatMoney(total[1].cents, l)}</dd>
      </div>
    </dl>
  );
}

/** The drawn state of a bar: solid block, kraft wrap with fold and tag, or dashed outline. */
function BarMark({ status }: { status: BarStatus }) {
  return (
    <svg class={`bar-mark bar-${status}`} viewBox="0 0 28 36" width="28" height="36" aria-hidden="true" focusable="false">
      {status === 'available' && <rect x="3" y="4" width="22" height="30" rx="1.5" class="mark-solid" />}
      {status === 'held' && (
        <>
          <rect x="3" y="4" width="22" height="30" rx="1.5" class="mark-kraft" />
          <path d="M17 4 H25 V12 Z" class="mark-fold" />
          <path d="M17 4 L25 12" class="mark-fold-line" />
          <rect x="7" y="18" width="10" height="7" rx="1" class="mark-tag" />
        </>
      )}
      {status === 'sold' && <rect x="3.5" y="4.5" width="21" height="29" rx="1.5" class="mark-dashed" />}
    </svg>
  );
}

export function BarItem({ k, status }: { k: number; status: BarStatus }) {
  const { m } = useCopy();
  const word = m.barWord[status];
  const text = m.barItem(k, word);
  const colon = text.lastIndexOf(word);
  return (
    <li class={`bar-item is-${status}`}>
      <BarMark status={status} />
      <span>
        {text.slice(0, colon)}
        <span class="bar-word">{word}</span>
      </span>
    </li>
  );
}

export function EmptyState({ children }: { children: ComponentChildren }) {
  return (
    <p class="empty">
      <svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true" focusable="false">
        <rect x="3.5" y="4.5" width="21" height="29" rx="1.5" class="mark-dashed" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal dialog: focus moves in, Tab stays inside, Escape or dismissal returns focus to the opener. */
export function Dialog({
  title,
  open,
  opener,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  opener: RefObject<HTMLElement>;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      if (!reducedMotion.get()) {
        dialog.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  const dismiss = () => {
    onClose();
    opener.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey ? (index <= 0 ? last : items[index - 1]) : index === items.length - 1 || index < 0 ? first : items[index + 1];
    next?.focus();
  };
  return (
    <dialog ref={ref} aria-labelledby="dialog-title" class="dialog" onKeyDown={onKeyDown} onCancel={(e) => { e.preventDefault(); dismiss(); }}>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

/** The cadence opener and its listbox popup. */
export function CadenceMenu({
  value,
  onChoose,
  error,
  busy,
}: {
  value: Cadence | null;
  onChoose: (cadence: Cadence) => void;
  error?: string | undefined;
  busy?: boolean;
}) {
  const { m, l } = useCopy();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  const show = () => {
    setActive(value ? CADENCES.indexOf(value) : 0);
    setOpen(true);
  };
  const close = (choice?: Cadence) => {
    setOpen(false);
    button.current?.focus();
    if (choice && choice !== value) onChoose(choice);
  };
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(CADENCES.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      close(CADENCES[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };
  const shown = busy ? m.saving : value ? pick(CADENCE_LABELS[value], l) : m.choose;
  return (
    <div class="field cadence">
      <span class="label" id="cadence-label">
        {m.cadence}
      </span>
      <button
        type="button"
        id="f-cadence"
        ref={button}
        class="menu-button"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="cadence-list"
        aria-label={m.cadence}
        aria-describedby="cadence-value"
        aria-invalid={error ? 'true' : undefined}
        aria-busy={busy ? 'true' : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        {/* The name is the field's label ("Cadence"); the chosen value is read out as the button's description
            and drawn from data-value, so the label stays the button's only on-screen text (WCAG 2.5.3). */}
        <span id="cadence-value" class="visually-hidden" aria-hidden="true">
          {shown}
        </span>
        <span class="menu-value" data-value={shown} aria-hidden="true" />
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
      <ul
        id="cadence-list"
        role="listbox"
        aria-label={m.cadence}
        tabIndex={-1}
        ref={list}
        hidden={!open}
        class="listbox"
        aria-activedescendant={open ? `cadence-${CADENCES[active]}` : undefined}
        onKeyDown={onListKey}
        onBlur={(e) => {
          if (!list.current?.contains(e.relatedTarget as Node) && e.relatedTarget !== button.current) setOpen(false);
        }}
      >
        {CADENCES.map((c, i) => (
          <li
            key={c}
            id={`cadence-${c}`}
            role="option"
            aria-selected={value === c ? 'true' : 'false'}
            class={i === active ? 'is-active' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => close(c)}
          >
            {pick(CADENCE_LABELS[c], l)}
          </li>
        ))}
      </ul>
      {error && <p class="field-error">{error}</p>}
    </div>
  );
}
