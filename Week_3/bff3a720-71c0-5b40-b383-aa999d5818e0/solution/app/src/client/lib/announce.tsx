import { useSyncExternalStore, type ReactElement } from "react";

interface Line {
  id: number;
  text: string;
}

let lines: Line[] = [];
let next = 1;
const listeners = new Set<() => void>();

export function announce(text: string): void {
  lines = [...lines.slice(-3), { id: next++, text }];
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function AnnouncementRegion(): ReactElement {
  const current = useSyncExternalStore(subscribe, () => lines);
  return (
    <div role="status" aria-label="Announcements" className="sr-only">
      {current.map((line) => (
        <p key={line.id}>{line.text}</p>
      ))}
    </div>
  );
}
