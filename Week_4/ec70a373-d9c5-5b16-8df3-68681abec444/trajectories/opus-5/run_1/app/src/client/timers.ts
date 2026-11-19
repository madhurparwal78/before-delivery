interface Registered {
  run: () => void;
  intervalMs: number;
  handle: number | null;
}

const registered: Registered[] = [];
let paused = false;

/** A periodic reload that pauses while Sign in again is open and stops on navigation. */
export function every(intervalMs: number, run: () => void): () => void {
  const entry: Registered = { run, intervalMs, handle: null };
  if (!paused) entry.handle = window.setInterval(run, intervalMs);
  registered.push(entry);
  return () => {
    if (entry.handle !== null) window.clearInterval(entry.handle);
    const index = registered.indexOf(entry);
    if (index !== -1) registered.splice(index, 1);
  };
}

export function pauseAll(): void {
  paused = true;
  for (const entry of registered) {
    if (entry.handle !== null) {
      window.clearInterval(entry.handle);
      entry.handle = null;
    }
  }
}

export function resumeAll(): void {
  paused = false;
  for (const entry of registered) {
    if (entry.handle === null) entry.handle = window.setInterval(entry.run, entry.intervalMs);
  }
}

export function clearAll(): void {
  while (registered.length > 0) {
    const entry = registered.pop() as Registered;
    if (entry.handle !== null) window.clearInterval(entry.handle);
  }
}
