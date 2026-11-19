import { useSyncExternalStore } from "react";

interface Messages {
  status: string;
  statusNonce: number;
  alert: string;
  alertNonce: number;
}

const ALERT_SECONDS = 10;
let messages: Messages = { status: "", statusNonce: 0, alert: "", alertNonce: 0 };
let alertTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Messages): void {
  messages = next;
  for (const listener of listeners) listener();
}

/** Polite result messages go to `status "Announcements"`. */
export const announce = (text: string): void => set({ ...messages, status: text, statusNonce: messages.statusNonce + 1 });

/** Every refusal, conflict and outage notice goes to `alert "Problems"`. */
export function refuse(text: string): void {
  clearTimeout(alertTimer);
  set({ ...messages, alert: text, alertNonce: messages.alertNonce + 1 });
  alertTimer = setTimeout(() => set({ ...messages, alert: "" }), ALERT_SECONDS * 1000);
}

export function useMessages(): Messages {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => messages,
  );
}
