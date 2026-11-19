import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { signal, useSignal } from './signal';

/** The latest notice for the Notices status, and the alerts for refusals. */
export const noticeSignal = signal('');
export const alertSignal = signal<string[]>([]);

export const notify = (text: string): void => noticeSignal.set(text);
export const raise = (text: string): void => alertSignal.set([text]);
export const clearAlerts = (): void => alertSignal.set([]);

export function Notices(): JSX.Element {
  const text = useSignal(noticeSignal);
  const alerts = useSignal(alertSignal);
  return (
    <div class="toasts">
      <div role="status" aria-label="Notices" class="notice">
        {text}
      </div>
      {alerts.map((message) => (
        <div role="alert" class="alert" key={message}>
          <span>{message}</span>
          <button type="button" class="pill small" onClick={clearAlerts}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  label: string;
  onClose: () => void;
  children: ComponentChildren;
  class?: string;
}

/** A modal dialog: Tab wraps inside, Escape closes, and focus returns to the opener. */
export function Dialog({ label, onClose, children, class: className }: DialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => item.offsetParent !== null || item === document.activeElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <dialog ref={ref} aria-label={label} class={`modal ${className ?? ''}`} onKeyDown={onKeyDown} onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}>
      {children}
    </dialog>
  );
}

const STICKERS: readonly string[][] = [
  ['..####..', '.######.', '##.##.##', '########', '##.##.##', '#.####.#', '.######.', '..#..#..'],
  ['...##...', '..####..', '.######.', '########', '.######.', '..####..', '...##...', '..#..#..'],
  ['.#....#.', '.##..##.', '.######.', '##.##.##', '########', '.######.', '..####..', '.#....#.'],
];

/** Empty states show one tilted pixel sticker and one line of copy. */
export function EmptyState({ text, variant = 0 }: { text: string; variant?: number }): JSX.Element {
  const rows = STICKERS[variant % STICKERS.length] ?? [];
  const path = rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === '#' ? [`M${x} ${y}h1v1h-1z`] : []))).join('');
  return (
    <div class="empty">
      <svg class="sticker" width="48" height="48" viewBox="-1 -1 10 10" aria-hidden="true" shape-rendering="crispEdges" style={{ transform: `rotate(${variant % 2 === 0 ? -8 : 7}deg)` }}>
        <path d={path} fill="#ffe66b" stroke="#fff" stroke-width="1.4" paint-order="stroke" />
      </svg>
      <p>{text}</p>
    </div>
  );
}

/** Controls that reflect the person's choice of reduced motion. */
export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
