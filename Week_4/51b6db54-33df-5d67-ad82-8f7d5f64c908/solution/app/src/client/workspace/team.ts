import type { Model } from './model';

const WINDOW_MS = 2000;
const KEPT = 20;

interface Window {
  sum: number;
  timer: ReturnType<typeof setTimeout>;
}

const windows = new Map<string, Window>();

export function say(m: Model, line: string): void {
  m.team = [...m.team, line].slice(-KEPT);
  m.changed();
}

/** A person's first stroke is announced at once; strokes in the next 2000 ms are summed into one line when the window ends. */
export function teamStroke(m: Model, name: string, pixels: number): void {
  const open = windows.get(name);
  if (open) {
    open.sum += pixels;
    return;
  }
  say(m, `${name} painted ${m.plural(pixels, 'pixel')}`);
  const created: Window = {
    sum: 0,
    timer: setTimeout(() => {
      windows.delete(name);
      if (created.sum > 0) say(m, `${name} painted ${m.plural(created.sum, 'pixel')}`);
    }, WINDOW_MS),
  };
  windows.set(name, created);
}

export function clearTeamWindows(): void {
  for (const open of windows.values()) clearTimeout(open.timer);
  windows.clear();
}
