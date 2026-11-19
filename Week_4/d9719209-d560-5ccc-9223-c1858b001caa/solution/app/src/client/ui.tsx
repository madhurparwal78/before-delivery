import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject,
} from 'react';

/* ---------- icons (drawn for the app, decorative: the control carries the name) ---------- */

type IconProps = { size?: number; filled?: boolean };

const svg = (size: number): { width: number; height: number; viewBox: string; 'aria-hidden': true; focusable: false } =>
  ({ width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false });

export function VoteArrow({ direction, filled = false, size = 22 }: IconProps & { direction: 'up' | 'down' }): React.JSX.Element {
  const d = direction === 'up' ? 'M12 3 L21 14 H15 V21 H9 V14 H3 Z' : 'M12 21 L3 10 H9 V3 H15 V10 H21 Z';
  return (
    <svg {...svg(size)}>
      <path d={d} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export const MoreIcon = ({ size = 22 }: IconProps): React.JSX.Element => (
  <svg {...svg(size)} fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
);

export const MenuIcon = ({ size = 22 }: IconProps): React.JSX.Element => (
  <svg {...svg(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);

export const TriangleRight = ({ size = 14 }: IconProps): React.JSX.Element => (
  <svg {...svg(size)} fill="currentColor"><path d="M7 4 L19 12 L7 20 Z" /></svg>
);

export const ChevronIcon = ({ size = 22, direction }: IconProps & { direction: 'left' | 'right' }): React.JSX.Element => (
  <svg {...svg(size)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={direction === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'} />
  </svg>
);

export const SheetIcon = ({ size = 56 }: IconProps): React.JSX.Element => (
  <svg {...svg(size)} fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="4" y="3" width="16" height="18" /><path d="M7 7h10M7 10h10M7 13h6M7 16h8" strokeLinecap="round" />
  </svg>
);

/* ---------- buttons ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'plain' | 'danger'; busy?: boolean };

export function Button({ variant = 'plain', busy = false, className, type = 'button', ...rest }: ButtonProps): React.JSX.Element {
  return <button type={type} aria-busy={busy || undefined} className={`btn btn-${variant}${className ? ` ${className}` : ''}`} {...rest} />;
}

/* ---------- menu button pattern ---------- */

export interface MenuItem { label: string; onSelect: () => void }

interface MenuButtonProps {
  label: string;
  items: MenuItem[];
  /** Runs before the menu opens; return false to keep it closed (for example after redirecting to two-factor setup). */
  beforeOpen?: () => Promise<boolean>;
  className?: string;
  children?: ReactNode;
}

export function MenuButton({ label, items, beforeOpen, className, children }: MenuButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const itemButtons = (): HTMLButtonElement[] => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  useLayoutEffect(() => {
    if (open) itemButtons()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const show = useCallback(async () => {
    if (beforeOpen && !(await beforeOpen())) return;
    setOpen(true);
  }, [beforeOpen]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void show();
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const all = itemButtons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => { event.preventDefault(); all[(to + all.length) % all.length]?.focus(); };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') setOpen(false);
  };

  if (items.length === 0) return <></>;
  return (
    <div className="menu-wrap">
      <button
        ref={button} type="button" className={`btn btn-plain menu-button${className ? ` ${className}` : ''}`}
        aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { if (open) close(); else void show(); }} onKeyDown={onButtonKey}
      >
        {children ?? <MoreIcon />}
      </button>
      {open && (
        <div id={menuId} ref={menu} role="menu" aria-label={label} className="menu" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label} type="button" role="menuitem" tabIndex={-1} className="menu-item"
              onClick={() => { close(); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- modal dialog (native <dialog>: focus trap, inert page, Escape) ---------- */

interface ModalProps {
  title: string;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}

/** Mount it to open it. Focus moves to its first field; closing returns focus to the control that held it. */
export function Modal({ title, onClose, role = 'dialog', children }: ModalProps): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closer = useRef(onClose);
  closer.current = onClose;

  useLayoutEffect(() => {
    const node = dialog.current as HTMLDialogElement;
    const before = document.activeElement as HTMLElement | null;
    node.showModal();
    const cancel = (event: Event): void => { event.preventDefault(); closer.current(); };
    node.addEventListener('cancel', cancel);
    return () => {
      node.removeEventListener('cancel', cancel);
      if (node.open) node.close();
      before?.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} className="modal" role={role} aria-labelledby={titleId}>
      <h2 id={titleId} className="modal-title">{title}</h2>
      {children}
    </dialog>
  );
}

/* ---------- tabs with automatic activation ---------- */

export interface TabOption<V extends string> { value: V; label: string }

interface TabsProps<V extends string> {
  label: string;
  value: V;
  options: TabOption<V>[];
  onChange: (value: V) => void;
  className?: string;
  panelId?: string;
}

export function Tabs<V extends string>({ label, value, options, onChange, className, panelId }: TabsProps<V>): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = options.findIndex((o) => o.value === value);
    let to = at;
    if (event.key === 'ArrowRight') to = (at + 1) % options.length;
    else if (event.key === 'ArrowLeft') to = (at - 1 + options.length) % options.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = options.length - 1;
    else return;
    event.preventDefault();
    const next = options[to] as TabOption<V>;
    onChange(next.value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label={label} className={`tabs${className ? ` ${className}` : ''}`} onKeyDown={key}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="tab" aria-selected={o.value === value} tabIndex={o.value === value ? 0 : -1}
          aria-controls={panelId} className="tab" onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- form fields ---------- */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (props: { id: string; 'aria-invalid': true | undefined; 'aria-describedby': string | undefined }) => ReactNode;
  className?: string;
}

/** A labelled control with its error message tied by aria-describedby. */
export function Field({ label, error, hint, children, className }: FieldProps): React.JSX.Element {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described })}
      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>
  );
}

/** Moves focus to the first invalid control inside `scope` each time `trigger` changes (and is above zero). */
export function useFocusFirstInvalid(scope: RefObject<HTMLElement | null>, trigger: number): void {
  useEffect(() => {
    if (trigger > 0) scope.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [scope, trigger]);
}

/* ---------- states ---------- */

export function Banner({ children, tone = 'note', ...rest }: { children: ReactNode; tone?: 'note' | 'warn' } & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={`banner banner-${tone}`} {...rest}>{children}</div>;
}

export function Empty({ children, title }: { children?: ReactNode; title: string }): React.JSX.Element {
  return (
    <div className="empty">
      <SheetIcon />
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row"><span /><span /><span /></div>)}
    </div>
  );
}

/** Sanitised HTML from the server (post and comment bodies). Inline spoilers reveal on click or Enter. */
export function Html({ html, className }: { html: string; className?: string }): React.JSX.Element {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const spoiler of node.current?.querySelectorAll<HTMLElement>('.spoiler:not([data-ready])') ?? []) {
      spoiler.dataset.ready = 'true';
      spoiler.tabIndex = 0;
      spoiler.setAttribute('role', 'button');
      spoiler.setAttribute('aria-expanded', 'false');
    }
  }, [html]);
  const reveal = (target: EventTarget): void => {
    const spoiler = (target as HTMLElement).closest<HTMLElement>('.spoiler');
    if (spoiler && !spoiler.classList.contains('revealed')) {
      spoiler.classList.add('revealed');
      spoiler.setAttribute('aria-expanded', 'true');
    }
  };
  return (
    <div
      ref={node} className={`prose${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => reveal(event.target)}
      onKeyDown={(event) => { if (event.key === 'Enter') reveal(event.target); }}
    />
  );
}

export const pageTitle = (title: string): void => { document.title = title === '' ? 'Moothall' : `${title} — Moothall`; };

/* ---------- radio group (native radios: arrow keys move and select) ---------- */

export interface RadioOption { value: string; label: string }

interface RadioGroupProps {
  label: string;
  name: string;
  options: RadioOption[];
  value: string | null;
  onChange: (value: string) => void;
  error?: string | undefined;
}

export function RadioGroup({ label, name, options, value, onChange, error }: RadioGroupProps): React.JSX.Element {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <div id={`${id}-label`} className="field-label">{label}</div>
      <div
        role="radiogroup" aria-labelledby={`${id}-label`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        className="radio-group"
      >
        {options.map((o) => (
          <label key={o.value} className="radio-row">
            <input type="radio" name={`${name}-${id}`} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && <p id={errorId} className="field-error">{error}</p>}
    </div>
  );
}
