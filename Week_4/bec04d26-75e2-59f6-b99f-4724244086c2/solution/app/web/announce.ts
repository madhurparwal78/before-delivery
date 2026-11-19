/** Lines for the one announcement region; the highest-priority line of a batch is the one that stays. */
export const PRIORITY = {
  conflict: 0, fieldError: 1, extensionRefused: 2, statusSaved: 3, amountsSaved: 4, extensionGranted: 5,
  bandOpened: 6, own: 7, approvalSeen: 8, overdue: 9, packetReady: 10, reminderSent: 11, banner: 12,
} as const;

let region: HTMLElement | null = null;
let queue: { text: string; priority: number; order: number }[] = [];
let counter = 0;

export function registerRegion(element: HTMLElement | null): void {
  region = element;
}

function flush(): void {
  const batch = queue;
  queue = [];
  for (const line of batch.sort((a, b) => b.priority - a.priority || a.order - b.order)) {
    if (region) region.textContent = line.text;
  }
}

export function announce(text: string, priority: number = PRIORITY.own): void {
  if (!queue.length) queueMicrotask(flush);
  queue.push({ text, priority, order: counter++ });
}
