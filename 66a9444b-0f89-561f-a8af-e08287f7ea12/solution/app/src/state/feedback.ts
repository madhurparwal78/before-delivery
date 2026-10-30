// The checkout feedback regions ("Checkout status" and "Checkout problem") are one pair for the whole app:
// inside the checkout dialog while it is open, otherwise in the dock at the foot of the page.
import { useSyncExternalStore } from "react";

type Feedback = { status: string; problem: string };
let state: Feedback = { status: "", problem: "" };
const listeners = new Set<() => void>();

function set(next: Feedback): void {
  state = next;
  listeners.forEach((l) => l());
}

export const checkoutFeedback = {
  status: (text: string) => set({ status: text, problem: "" }),
  problem: (text: string) => set({ status: "", problem: text }),
  clear: () => set({ status: "", problem: "" }),
};

export function useCheckoutFeedback(): Feedback {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
