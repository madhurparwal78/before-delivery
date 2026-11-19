const FLASH_MS = 400;

const lastSeen = new Map<string, string>();

/** A chip whose status has changed since the last repaint flashes its new tone once. */
export function flashOnStatusChange(roomId: string, status: string, chip: HTMLElement): void {
  const previous = lastSeen.get(roomId);
  lastSeen.set(roomId, status);
  if (previous === undefined || previous === status) return;
  chip.classList.add('flash');
  window.setTimeout(() => chip.classList.remove('flash'), FLASH_MS);
}
