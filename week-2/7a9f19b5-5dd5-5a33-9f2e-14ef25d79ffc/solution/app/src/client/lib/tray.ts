// The comparison tray: up to four variants, kept in the browser across pages.
import { useSyncExternalStore } from "react";

const TRAY_LIMIT = 4;
const STORAGE_KEY = "lf-compare";

interface TrayItem {
  code: string;
  product_slug: string;
  product_name: string;
}

const listeners = new Set<() => void>();
let items: TrayItem[] = (() => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as TrayItem[]).slice(0, TRAY_LIMIT) : [];
  } catch {
    return [];
  }
})();
let snapshot = { items, message: "" };

function save(next: TrayItem[], message: string): void {
  items = next;
  snapshot = { items, message };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  for (const listener of listeners) listener();
}

/** Adds a variant; a fifth fitting changes nothing in the tray and reports the full-tray copy. */
export function addToTray(item: TrayItem): boolean {
  if (items.some((existing) => existing.code === item.code)) return true;
  if (items.length >= TRAY_LIMIT) {
    save(items, "You can compare up to four fittings.");
    return false;
  }
  save([...items, item], "Added to comparison.");
  return true;
}

export function removeFromTray(code: string): void {
  save(items.filter((item) => item.code !== code), "");
}

export function useTray(): { items: TrayItem[]; message: string } {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
