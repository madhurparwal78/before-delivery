import { ComponentChildren, createContext } from 'preact';
import { useContext, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { artDataUri, Aspect } from '../../shared/art';
import { CrossMark } from './Icons';

/* ---------- drawn pictures ---------- */

export function Art(props: {
  seed: string;
  title: string;
  aspect?: Aspect;
  className?: string;
  decorative?: boolean;
}) {
  const src = artDataUri({ seed: props.seed, title: props.title, aspect: props.aspect ?? '16:9', animated: false });
  return (
    <img
      src={src}
      alt={props.decorative ? '' : props.title}
      aria-hidden={props.decorative ? 'true' : undefined}
      class={props.className}
      loading="lazy"
    />
  );
}

/* ---------- toasts ---------- */

interface Toast {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div class="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} class="toast">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------- dialog ---------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the open overlay and closes it on Escape. */
function useModalKeys(holder: { current: HTMLDivElement | null }, onClose: () => void) {
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    holder.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  return (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(holder.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  const holder = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalKeys(holder, props.onClose);

  return (
    <div class="overlay" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={holder}
        onKeyDown={onKeyDown}
      >
        <div class="dialog-head">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" class="icon-button" onClick={props.onClose} aria-label="Close">
            <CrossMark />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/* ---------- drawer ---------- */

export function Drawer(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  const holder = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalKeys(holder, props.onClose);

  return (
    <>
      <div class="drawer-overlay" onClick={props.onClose} />
      <div
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={holder}
        onKeyDown={onKeyDown}
      >
        <div class="row-between">
          <span id={titleId} class="wordmark">
            {props.title}
          </span>
          <button type="button" class="icon-button" onClick={props.onClose} aria-label="Close">
            <CrossMark />
          </button>
        </div>
        {props.children}
      </div>
    </>
  );
}

/* ---------- tabs ---------- */

export interface TabItem {
  id: string;
  label: string;
}

export function TabRow(props: {
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  idPrefix: string;
  segmented?: boolean;
}) {
  const move = (step: number) => {
    const index = props.tabs.findIndex((tab) => tab.id === props.value);
    const next = props.tabs[(index + step + props.tabs.length) % props.tabs.length];
    props.onChange(next.id);
    document.getElementById(`${props.idPrefix}-tab-${next.id}`)?.focus();
  };

  return (
    <div class={props.segmented ? 'segmented' : 'tab-row'} role="tablist" aria-label={props.label}>
      {props.tabs.map((tab) => {
        const selected = tab.id === props.value;
        return (
          <button
            key={tab.id}
            type="button"
            class="tab"
            role="tab"
            id={`${props.idPrefix}-tab-${tab.id}`}
            aria-selected={selected ? 'true' : 'false'}
            aria-controls={`${props.idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel(props: { idPrefix: string; id: string; children: ComponentChildren }) {
  return (
    <div
      role="tabpanel"
      id={`${props.idPrefix}-panel-${props.id}`}
      aria-labelledby={`${props.idPrefix}-tab-${props.id}`}
      tabIndex={0}
    >
      {props.children}
    </div>
  );
}

/* ---------- switch ---------- */

export function Switch(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      class="switch"
      role="switch"
      aria-checked={props.checked ? 'true' : 'false'}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="switch-knob" />
    </button>
  );
}

/* ---------- form fields ---------- */

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span class="field-error" id={id} role="alert">
      {message}
    </span>
  );
}

export function TextField(props: {
  label: string;
  name: string;
  value: string;
  onInput: (value: string) => void;
  error?: string;
  type?: string;
  required?: boolean;
  autocomplete?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = `field-${props.name}`;
  const errorId = `${id}-error`;
  return (
    <div class={`field ${props.className ?? ''}`}>
      <label for={id}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <input
        class="input"
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        autocomplete={props.autocomplete}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onInput={(event) => props.onInput((event.target as HTMLInputElement).value)}
      />
      <FieldError id={errorId} message={props.error} />
    </div>
  );
}

export function SelectField(props: {
  label: string;
  name: string;
  value: string;
  options: string[];
  prompt?: string;
  onInput: (value: string) => void;
  error?: string;
  required?: boolean;
  className?: string;
}) {
  const id = `field-${props.name}`;
  const errorId = `${id}-error`;
  return (
    <div class={`field ${props.className ?? ''}`}>
      <label for={id}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <select
        class="select"
        id={id}
        name={props.name}
        value={props.value}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onChange={(event) => props.onInput((event.target as HTMLSelectElement).value)}
      >
        {props.prompt ? <option value="">{props.prompt}</option> : null}
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={props.error} />
    </div>
  );
}

export function TextAreaField(props: {
  label: string;
  name: string;
  value: string;
  onInput: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const id = `field-${props.name}`;
  const errorId = `${id}-error`;
  return (
    <div class={`field ${props.className ?? ''}`}>
      <label for={id}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <textarea
        class="textarea"
        id={id}
        name={props.name}
        value={props.value}
        placeholder={props.placeholder}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onInput={(event) => props.onInput((event.target as HTMLTextAreaElement).value)}
      />
      <FieldError id={errorId} message={props.error} />
    </div>
  );
}

export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}
