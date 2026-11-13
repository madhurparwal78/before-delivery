import { useSyncExternalStore } from "react";

let message = "";
const listeners = new Set<() => void>();

/** The Notices live region keeps the latest message until the next action replaces it. */
export function notify(text: string): void {
  message = text;
  listeners.forEach((l) => l());
}

function clearNotice(): void {
  notify("");
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function NoticesRegion(): JSX.Element {
  const text = useSyncExternalStore(subscribe, () => message);
  return (
    <div role="status" aria-label="Notices" aria-live="polite" className={`notices${text ? "" : " empty"}`}>
      {text}
    </div>
  );
}
