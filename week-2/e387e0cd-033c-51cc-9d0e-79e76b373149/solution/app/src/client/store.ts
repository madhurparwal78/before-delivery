// Small observable stores shared by the screens: the desk's feedback message and the session's end.
import { useEffect, useState } from "preact/hooks";

interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function store<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(source: Store<T>): T {
  const [, setTick] = useState(0);
  useEffect(() => source.subscribe(() => setTick((n) => n + 1)), [source]);
  return source.get();
}

type Tone = "pending" | "success" | "refusal" | "info";

/** What a user's last action showed; it stays until that user's next action on the same screen. */
interface Feedback {
  text: string;
  tone: Tone;
  /** Which action it belongs to, so the copy can also sit next to that control. */
  action: string;
  /** Session copy offers a sign-in link: `again` keeps what was typed, `only` after access was removed. */
  signIn?: "again" | "only";
}

export const feedback = store<Feedback | null>(null);

export function say(action: string, text: string, tone: Tone): void {
  feedback.set({ action, text, tone });
}
