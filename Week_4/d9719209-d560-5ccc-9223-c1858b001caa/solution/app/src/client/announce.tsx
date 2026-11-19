import { useSyncExternalStore } from 'react';

interface Toast { id: number; text: string; alert: boolean }

const TOAST_MS = 5000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const publish = (): void => listeners.forEach((l) => l());

function region(alert: boolean): HTMLElement | null {
  return document.getElementById(alert ? 'live-alert' : 'live-status');
}

/** Says `text` in the polite status region (or the assertive alert region) and in a visible toast. Never moves focus. */
export function announce(text: string, alert = false): void {
  const target = region(alert);
  if (target) target.textContent = text;
  const toast: Toast = { id: nextId++, text, alert };
  toasts = [...toasts.slice(-3), toast];
  publish();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== toast.id);
    publish();
  }, TOAST_MS);
}

export function Toasts(): React.JSX.Element {
  const list = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => toasts);
  return (
    <div className="toasts">
      {list.map((t) => <p key={t.id} className={t.alert ? 'toast toast-alert' : 'toast'}>{t.text}</p>)}
    </div>
  );
}
