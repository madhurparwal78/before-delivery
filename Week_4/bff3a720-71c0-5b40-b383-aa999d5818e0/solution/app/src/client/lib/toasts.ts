import { useSyncExternalStore } from "react";
import { pageConfig } from "./config";

interface Toast {
  id: number;
  text: string;
  actionLabel: string;
  onAction: () => void;
  onExpire: () => void;
}

let current: Toast | null = null;
let timer = 0;
let next = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function clear(): void {
  window.clearTimeout(timer);
  current = null;
  emit();
}

export function showToast(toast: Omit<Toast, "id">): void {
  if (current) current.onExpire();
  window.clearTimeout(timer);
  current = { ...toast, id: next++ };
  const shown = current;
  timer = window.setTimeout(() => {
    if (current === shown) {
      shown.onExpire();
      clear();
    }
  }, pageConfig.toastSeconds * 1000);
  emit();
}

export function undoToast(): void {
  const shown = current;
  if (!shown) return;
  clear();
  shown.onAction();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
