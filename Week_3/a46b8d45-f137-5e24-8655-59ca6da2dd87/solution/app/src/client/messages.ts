import { OPS_TEXT } from "../shared/copy";
import { createStore, useStore } from "./store";

/** The page's one status region and one alert region. */
interface Messages {
  success: string;
  pending: { id: number; text: string } | null;
  waiting: number;
  alert: string;
}

const empty: Messages = { success: "", pending: null, waiting: 0, alert: "" };

const messages = createStore<Messages>(empty);
export const useMessages = (): Messages => useStore(messages);

let counter = 0;

const patch = (change: Partial<Messages>): void => messages.set({ ...messages.get(), ...change });

export const resetMessages = (): void => messages.set(empty);

/** Shows pending copy; the returned function ends it only if no newer pending copy replaced it. */
export function startPending(text: string): () => void {
  counter += 1;
  const id = counter;
  patch({ pending: { id, text } });
  return () => {
    if (messages.get().pending?.id === id) patch({ pending: null });
  };
}

export const showSuccess = (text: string): void => patch({ success: text, alert: "", pending: null });
export const showAlert = (text: string): void => patch({ alert: text, pending: null });
export const clearAlert = (): void => patch({ alert: "" });
export const setWaiting = (count: number): void => patch({ waiting: count });

export function statusText(state: Messages): string {
  if (state.pending) return state.pending.text;
  const waiting = state.waiting > 0 ? OPS_TEXT.waiting(state.waiting) : "";
  return [state.success, waiting].filter((part) => part !== "").join(" ");
}
