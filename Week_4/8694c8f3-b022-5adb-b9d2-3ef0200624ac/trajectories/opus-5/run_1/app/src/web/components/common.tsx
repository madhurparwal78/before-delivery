import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { roundBpm } from '../../shared/domain.js';
import { store, type StoreState } from '../store.js';

export function useStoreState(): StoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  alert?: boolean;
  plain?: boolean;
}

/** Every dialog traps Tab, closes on Escape and returns focus to its opener. */
export function Dialog({ title, onClose, children, alert = false, plain = false }: DialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (nodes.length === 0) return;
    const first = nodes[0] as HTMLElement;
    const last = nodes[nodes.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay" onKeyDown={onKeyDown}>
      <div
        className="dialog"
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        {plain ? null : <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

interface MenuProps {
  label: string;
  items: { label: string; action: () => void; disabled?: boolean }[];
  /** An accessible name when the visible text is something else, such as a display name. */
  name?: string;
}

export function Menu({ label, items, name }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu-root" ref={root}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open ? (
        <div className="menu-pop" role="menu" aria-label={name ?? label}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              onClick={() => {
                setOpen(false);
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface ScrubFieldProps {
  label: string;
  value: number;
  decimals?: number;
  bpm?: boolean;
  min: number;
  max: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}

/** Scrub fields change by 0.1 per pixel or arrow press, and by 0.01 with Shift. */
export function ScrubField({
  label,
  value,
  decimals = 3,
  bpm = false,
  min,
  max,
  onPreview,
  onCommit,
}: ScrubFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const entry = useRef(value);
  const live = useRef(value);
  live.current = value;

  const clamp = useCallback((next: number): number => Math.min(max, Math.max(min, next)), [max, min]);

  const onPointerDown = (event: React.PointerEvent<HTMLInputElement>): void => {
    const element = event.currentTarget;
    const startX = event.clientX;
    const startValue = live.current;
    let moved = false;
    entry.current = startValue;
    store.beginInteraction();
    const move = (pointer: PointerEvent): void => {
      const dx = pointer.clientX - startX;
      if (Math.abs(dx) > 1) moved = true;
      if (!moved) return;
      const step = bpm ? 0.1 : pointer.shiftKey ? 0.01 : 0.1;
      const next = clamp(startValue + dx * step);
      setScrubbing(true);
      setDraft(null);
      onPreview(next);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.endInteraction();
      setScrubbing(false);
      if (moved) onCommit(live.current);
      else element.focus();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const step = bpm ? 0.1 : event.shiftKey ? 0.01 : 0.1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = clamp(live.current + step);
      setDraft(null);
      onPreview(next);
      onCommit(next);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = clamp(live.current - step);
      setDraft(null);
      onPreview(next);
      onCommit(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      onPreview(entry.current);
    }
  };

  const commitDraft = (): void => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (!Number.isFinite(parsed)) {
      onPreview(entry.current);
      return;
    }
    const rounded = bpm ? roundBpm(parsed) : parsed;
    const next = clamp(rounded);
    onPreview(next);
    onCommit(next);
  };

  const shown = draft ?? value.toFixed(decimals);
  return (
    <input
      type="text"
      role="spinbutton"
      className={scrubbing ? 'scrub scrubbing' : 'scrub'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      value={shown}
      onFocus={() => {
        entry.current = live.current;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onBlur={commitDraft}
    />
  );
}

export function KeyDot({ label, pressed, onKey }: { label: string; pressed: boolean; onKey: () => void }) {
  return (
    <button
      type="button"
      className="keydot"
      aria-label={`Keyframe ${label}`}
      aria-pressed={pressed}
      onClick={onKey}
    />
  );
}

export function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return <div className="field-error">{message}</div>;
}

export function Drawer({
  name,
  children,
  openByDefault = true,
}: {
  name: string;
  children: ReactNode;
  openByDefault?: boolean;
}) {
  const key = `afterglass.drawer.${name}`;
  const [open, setOpen] = useState(() => {
    const stored = window.localStorage.getItem(key);
    return stored === null ? openByDefault : stored === 'open';
  });
  return (
    <section>
      <button
        type="button"
        className="drawer-head"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          window.localStorage.setItem(key, open ? 'closed' : 'open');
        }}
      >
        {name}
      </button>
      {open ? <div className="drawer-body">{children}</div> : null}
    </section>
  );
}

export function LiveRegions({
  regions,
  inBanner = false,
}: {
  regions: StoreState['regions'];
  inBanner?: boolean;
}) {
  return (
    <div className="live-regions">
      <div role="status" aria-live="polite" aria-label="Autosave">
        {regions.autosave}
      </div>
      <div role="status" aria-live="polite" aria-label="Shader compile">
        {regions.shaderCompile}
      </div>
      <div role="status" aria-live="polite" aria-label="Asset upload">
        {regions.assetUpload}
      </div>
      <div role="status" aria-live="polite" aria-label="Show status">
        {regions.showStatus}
      </div>
      <div role="status" aria-live="polite" aria-label="Script status">
        {regions.scriptStatus}
      </div>
      <div role="status" aria-live="polite" aria-label="Export status">
        {regions.exportStatus}
      </div>
      <div role="status" aria-live="polite" aria-label="Notifications">
        {regions.notifications}
      </div>
      {inBanner ? null : (
        <>
          <div role="status" aria-live="polite" aria-label="Connection">
            {regions.connection}
          </div>
          <div role="status" aria-live="polite" aria-label="Service status">
            {regions.serviceStatus}
          </div>
        </>
      )}
    </div>
  );
}

export function Emblem() {
  return (
    <svg className="emblem" width="54" height="54" viewBox="0 0 54 54" aria-hidden="true" focusable="false">
      <path d="M27 4l20 11.5v23L27 50 7 38.5v-23z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M27 13l12 7v14l-12 7-12-7V20z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M27 22l5 3v6l-5 3-5-3v-6z" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
