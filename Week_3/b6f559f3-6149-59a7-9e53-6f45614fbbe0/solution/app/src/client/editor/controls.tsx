import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MESSAGES, mustBeBetween } from '../../shared/messages';
import { roundTo } from '../../shared/format';

/** The one description every unavailable edit control carries for viewers. */
const VIEWER_HINT_ID = 'viewer-hint';

export function ViewerHint() {
  return (
    <span id={VIEWER_HINT_ID} className="sr-only">
      {MESSAGES.viewerRefusal}
    </span>
  );
}

/** Props that mark an edit control unavailable for viewers, with the refusal copy as description and tooltip. */
export function editGate(canEdit: boolean): { disabled?: true; 'aria-describedby'?: string; title?: string } {
  return canEdit ? {} : { disabled: true, 'aria-describedby': VIEWER_HINT_ID, title: MESSAGES.viewerRefusal };
}

export function Notice({ message }: { message: string | undefined }) {
  return message ? (
    <div role="alert" className="notice">
      {message}
    </div>
  ) : null;
}

export interface MenuItemDef {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

const FOCUSABLE_ITEM = '[role="menuitem"]:not([disabled])';

function Menu({
  label,
  anchor,
  items,
  align,
  onClose,
}: {
  label: string;
  anchor: HTMLElement;
  items: MenuItemDef[];
  align: 'start' | 'end';
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = ref.current as HTMLDivElement;
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = align === 'end' ? rect.right - width : rect.left;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    if (below < 220 && above > below) {
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      menu.style.maxHeight = `${above}px`;
    } else {
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.maxHeight = `${below}px`;
    }
    menu.querySelector<HTMLElement>(FOCUSABLE_ITEM)?.focus();
  }, [anchor, align]);

  useEffect(() => {
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [anchor, onClose]);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM)];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const go = (index: number): void => {
      event.preventDefault();
      entries[(index + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(entries.length - 1);
    else if (event.key === 'Tab') go(event.shiftKey ? at - 1 : at + 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} className="menu" onKeyDown={move}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          onClick={() => {
            onClose(true);
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface MenuButtonProps {
  menuLabel: string;
  items: MenuItemDef[];
  /** The button's accessible name when it differs from its content. */
  label?: string;
  align?: 'start' | 'end';
  className?: string;
  disabled?: boolean;
  describedBy?: string;
  title?: string;
  children: ReactNode;
}

export function MenuButton({ menuLabel, items, label, align = 'start', className, disabled, describedBy, title, children }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = (restore: boolean): void => {
    setOpen(false);
    if (restore) ref.current?.focus();
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        aria-describedby={describedBy}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open && ref.current && <Menu label={menuLabel} anchor={ref.current} items={items} align={align} onClose={close} />}
    </>
  );
}

/** A switch: a button with `role="switch"`. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  describedBy,
  title,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedBy}
      title={title}
      disabled={disabled}
      className={`switch ${className ?? ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
      <span>{label}</span>
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  shiftStep?: number;
  disabled?: boolean;
  gate?: ReturnType<typeof editGate>;
  /** Called with a valid number. `nudge` is true for arrow-key steps. */
  onCommit: (value: number, nudge: boolean) => void;
  onInvalid?: (message: string) => void;
  className?: string;
}

/** A spinbutton: Enter or Tab commits, arrows step by `step`, Shift+arrows by `shiftStep`. */
export function NumberField({ label, value, min, max, step, shiftStep, disabled, gate, onCommit, onInvalid, className }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();

  const commit = (text: string, nudge: boolean): void => {
    setDraft(null);
    const parsed = Number(text);
    if (text.trim() === '' || !Number.isFinite(parsed)) {
      onInvalid?.(MESSAGES.invalidValue);
      return;
    }
    if (parsed < min || parsed > max) {
      onInvalid?.(mustBeBetween(min, max));
      return;
    }
    if (parsed !== value) onCommit(roundTo(parsed, 3), nudge);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      if (draft !== null) commit(draft, false);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = draft !== null && Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : value;
      const size = event.shiftKey ? (shiftStep ?? step * 10) : step;
      const next = roundTo(Math.min(max, Math.max(min, base + (event.key === 'ArrowUp' ? size : -size))), 3);
      setDraft(null);
      if (next !== value) onCommit(next, true);
    }
  };

  return (
    <input
      id={id}
      type="number"
      className={className}
      aria-label={label}
      value={draft ?? String(roundTo(value, 3))}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      {...gate}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (draft !== null) commit(draft, false);
      }}
    />
  );
}
