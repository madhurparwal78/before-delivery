import type { VNode } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { Config, Me } from "./types";

/** A tiny observable value for state shared between the shell and pages. */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((l) => l(next));
    },
    use(): T {
      const [state, setState] = useState(value);
      useLayoutEffect(() => {
        listeners.add(setState);
        setState(value);
        return () => void listeners.delete(setState);
      }, []);
      return state;
    },
  };
}

export const session = createStore<Me | null>(null);
export const configStore = createStore<Config>({ moveMs: 320, progressMs: 400, toastMs: 4000, holdTimeoutMs: 30000 });
export const unreadStore = createStore(0);
export const outageStore = createStore(false);

/* ------------------------------------------------------------------ live regions */

export type StatusName =
  | "List status" | "Board status" | "Timeline status" | "Rules status" | "Workload status" | "Approval status" | "Inbox status"
  | "Account status" | "Download status";

const statuses = createStore<Partial<Record<StatusName, string>>>({});

export function announce(name: StatusName, text: string): void {
  statuses.set({ ...statuses.get(), [name]: text });
}

export const useStatuses = () => statuses.use();

/* ------------------------------------------------------------------ toasts */

interface Toast { id: number; text: string }
const toasts = createStore<Toast[]>([]);
let toastId = 0;

export function toast(text: string): void {
  toastId += 1;
  const id = toastId;
  toasts.set([...toasts.get(), { id, text }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), configStore.get().toastMs);
}

export const useToasts = () => toasts.use();

/* ------------------------------------------------------------------ modal host */

interface ModalEntry { id: number; render: (close: () => void) => VNode }
const modals = createStore<ModalEntry[]>([]);
let modalId = 0;

export function closeModal(id: number): void {
  modals.set(modals.get().filter((m) => m.id !== id));
}

export function openModal(render: ModalEntry["render"]): () => void {
  modalId += 1;
  const id = modalId;
  modals.set([...modals.get(), { id, render }]);
  return () => closeModal(id);
}

export const useModals = () => modals.use();
