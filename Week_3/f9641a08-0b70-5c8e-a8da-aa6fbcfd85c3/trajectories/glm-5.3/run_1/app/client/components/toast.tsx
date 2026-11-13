import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { CONFIG } from '../lib/format.js';

type ToastState = { text: string; undo?: () => void } | null;

let current: ToastState = null;
const listeners = new Set<() => void>();

/** The visual toast mirrors the cart-updates live region. */
export function showToast(text: string, undo?: () => void): void {
  current = { text, undo };
  for (const fn of listeners) fn();
  if (undo === undefined) {
    setTimeout(() => { current = null; for (const fn of listeners) fn(); }, CONFIG.toast_seconds * 1000);
  } else {
    setTimeout(() => { current = null; for (const fn of listeners) fn(); }, CONFIG.cart_undo_seconds * 1000);
  }
}

export function Toast(): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = (): void => setTick((t) => t + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  if (current === null) return <></>;
  return (
    <div class="toast" role="presentation" data-motion-ms={document.documentElement.dataset.motion === 'reduced' ? '0' : '200'} data-state="open">
      <p>{current.text}</p>
      {current.undo !== undefined ? <button onClick={current.undo}>Undo</button> : null}
    </div>
  );
}
