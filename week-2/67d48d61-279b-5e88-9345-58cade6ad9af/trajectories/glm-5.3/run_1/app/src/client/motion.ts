/** The cue-line cascade and its reverse (DP-12, DP-13, DP-16).
 * Everything finishes within 600ms of the server's reply. */
import type { CascadeEntry } from "./domain.js";

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Stepper { cancel(): void }

/** Runs the cascade; `onFreed` fires per freed row in order with its entry. */
export function playCascade(
  entries: CascadeEntry[],
  changedRow: HTMLElement | null,
  onFreed: (id: string, entry: CascadeEntry) => void,
  onBlockedCountStep: () => void,
  onProgressMove: () => void,
): void {
  if (entries.length === 0) return;
  if (reducedMotion()) {
    for (const e of entries) onFreed(e.id, e);
    onProgressMove();
    return;
  }
  const line = document.getElementById("cue-line");
  drawLine(line, changedRow, entries);
  const byDepth = new Map<number, CascadeEntry[]>();
  for (const e of entries) {
    if (!byDepth.has(e.depth)) byDepth.set(e.depth, []);
    byDepth.get(e.depth)!.push(e);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  depths.forEach((depth, i) => {
    setTimeout(() => {
      for (const e of byDepth.get(depth)!) {
        onFreed(e.id, e);
        onBlockedCountStep();
      }
    }, i * 60);
  });
  setTimeout(() => onProgressMove(), depths.length * 60 + 100);
  setTimeout(() => line?.classList.remove("cue-line-drawn"), depths.length * 60 + 160);
}

/** Reverse cascade on undo (DP-16). */
export function playReverseCascade(
  reblocked: { id: string; order: number }[],
  onRow: (id: string) => void,
  onBlockedCountStep: () => void,
  onProgressMove: () => void,
): void {
  if (reblocked.length === 0) return;
  if (reducedMotion()) {
    for (const r of reblocked) onRow(r.id);
    onProgressMove();
    return;
  }
  const line = document.getElementById("cue-line");
  line?.classList.add("cue-line-drawn");
  reblocked.forEach((r, i) => {
    setTimeout(() => {
      onRow(r.id);
      onBlockedCountStep();
    }, i * 60);
  });
  setTimeout(() => onProgressMove(), reblocked.length * 60 + 100);
  setTimeout(() => line?.classList.remove("cue-line-drawn"), reblocked.length * 60 + 160);
}

function drawLine(line: HTMLElement | null, changedRow: HTMLElement | null, entries: CascadeEntry[]): void {
  if (!line) return;
  const grid = document.getElementById("task-grid");
  if (!grid) return;
  const gridRect = grid.getBoundingClientRect();
  const startY = changedRow ? Math.max(changedRow.getBoundingClientRect().top - gridRect.top, 0) : 0;
  let endY = startY;
  for (const e of entries) {
    const el = document.querySelector(`[data-task-id="${e.id}"]`);
    if (el) endY = Math.max(endY, el.getBoundingClientRect().top - gridRect.top);
  }
  const height = Math.abs(endY - startY);
  line.style.top = `${Math.min(startY, endY)}px`;
  line.style.height = `${height}px`;
  line.classList.add("cue-line-drawn");
}

/** Digits roll one step per freed task as it is reached. */
export function rollDigits(el: HTMLElement, from: number, to: number, stepMs: number): void {
  if (reducedMotion()) { el.textContent = String(to); return }
  const direction = to < from ? -1 : 1;
  let current = from;
  const interval = setInterval(() => {
    current += direction;
    el.textContent = String(current);
    if (current === to) clearInterval(interval);
  }, stepMs);
}
