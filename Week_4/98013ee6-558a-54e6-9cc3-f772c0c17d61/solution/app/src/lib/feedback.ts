import { useSyncExternalStore } from "react";

/** Announcements (polite), notices (toasts) and alerts. Anything can call these; one region of each is mounted. */

interface UndoInfo {
  operationId: number;
  deadline: string;
}

interface Toast {
  id: number;
  text: string;
  undo: UndoInfo | null;
  leaving: boolean;
}

interface AlertItem {
  id: number;
  text: string;
}

interface State {
  announcements: { id: number; text: string }[];
  toasts: Toast[];
  alerts: AlertItem[];
}

let state: State = { announcements: [], toasts: [], alerts: [] };
let nextId = 1;
const listeners = new Set<() => void>();

function update(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

const PLAIN_TOAST_MS = 6000;
const LEAVE_MS = 420;
const ALERT_MS = 9000;
const reduced = (): boolean => document.documentElement.dataset["motion"] === "reduced";

export function announce(text: string): void {
  update({ ...state, announcements: [...state.announcements.slice(-3), { id: nextId++, text }] });
}

function removeToast(id: number): void {
  update({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) });
}

export function dismissToast(id: number): void {
  if (reduced()) return removeToast(id);
  update({ ...state, toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)) });
  setTimeout(() => removeToast(id), LEAVE_MS);
}

export function toast(text: string, undo: UndoInfo | null = null): number {
  const id = nextId++;
  update({ ...state, toasts: [...state.toasts, { id, text, undo, leaving: false }] });
  if (undo === null) setTimeout(() => dismissToast(id), PLAIN_TOAST_MS);
  return id;
}

export function dropUndoToast(operationId: number): void {
  const found = state.toasts.find((item) => item.undo?.operationId === operationId);
  if (found) dismissToast(found.id);
}

/** A message that is both spoken and shown. */
export function notify(text: string): void {
  announce(text);
  toast(text);
}

export function showAlert(text: string): void {
  const id = nextId++;
  update({ ...state, alerts: [...state.alerts.filter((item) => item.text !== text), { id, text }].slice(-3) });
  setTimeout(() => dismissAlert(id), ALERT_MS);
}

export function dismissAlert(id: number): void {
  update({ ...state, alerts: state.alerts.filter((item) => item.id !== id) });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useFeedback = (): State => useSyncExternalStore(subscribe, () => state);
