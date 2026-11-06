// The cast tray: up to 12 talent kept in this browser, and its announcements.

import { useSyncExternalStore } from "react";
import { createAnnouncer } from "./ui/status.js";
import { prefersReducedMotion } from "./ui/media.js";

export interface TrayItem {
  slug: string;
  displayName: string;
  photoUrl: string | null;
}

const KEY = "rb.tray";
export const TRAY_LIMIT = 12;
export const trayAnnouncer = createAnnouncer();

function read(): TrayItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as TrayItem[]) : [];
  } catch {
    return [];
  }
}

let items = read();
const listeners = new Set<() => void>();

function write(next: TrayItem[]): void {
  items = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

window.addEventListener("storage", (event) => {
  if (event.key === KEY) {
    items = read();
    for (const listener of listeners) listener();
  }
});

export function useTray(): TrayItem[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => items);
}

/** A copy of the portrait shrinks and travels to the Tray link over the middle duration. */
function fly(from: HTMLElement | null): void {
  const target = document.querySelector<HTMLElement>("[data-tray-link]");
  if (!from || !target || prefersReducedMotion()) return;
  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  const clone = from.cloneNode(true) as HTMLElement;
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    position: "fixed", left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`,
    height: `${start.height}px`, margin: "0", zIndex: "60", pointerEvents: "none", transformOrigin: "top left",
  });
  document.body.append(clone);
  const scale = Math.max(0.08, Math.min(end.width / start.width, end.height / start.height));
  const dx = end.left + end.width / 2 - (start.left + (start.width * scale) / 2);
  const dy = end.top + end.height / 2 - (start.top + (start.height * scale) / 2);
  const animation = clone.animate(
    [{ transform: "translate(0, 0) scale(1)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 }],
    { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
  animation.onfinish = () => clone.remove();
}

function inTray(slug: string): boolean {
  return items.some((item) => item.slug === slug);
}

export function addToTray(item: TrayItem, portrait: HTMLElement | null): void {
  if (inTray(item.slug)) return;
  if (items.length >= TRAY_LIMIT) {
    trayAnnouncer.announce("Your tray holds up to 12 talent.");
    return;
  }
  fly(portrait);
  write([...items, item]);
  trayAnnouncer.announce(`Added ${item.displayName} to your tray. ${items.length} in tray.`);
}

export function removeFromTray(slug: string): void {
  const item = items.find((entry) => entry.slug === slug);
  if (!item) return;
  write(items.filter((entry) => entry.slug !== slug));
  trayAnnouncer.announce(`Removed ${item.displayName}. ${items.length} in tray.`);
}

export function moveInTray(slug: string, delta: -1 | 1): void {
  const from = items.findIndex((entry) => entry.slug === slug);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  write(next);
  trayAnnouncer.announce(`Moved ${next[to].displayName} to position ${to + 1} of ${next.length}.`);
}

export function clearTray(): void {
  write([]);
}
