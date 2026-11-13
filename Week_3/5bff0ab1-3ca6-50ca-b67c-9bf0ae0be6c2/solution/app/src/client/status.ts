/**
 * The one polite status region. Strings falling due together are shown in turn for at least 700 ms in the order
 * session, rider's lock result, hub staleness, price, then the rest in arrival order; a string equal to the current text
 * empties the region first so it is announced again.
 */
export const RANK = { session: 0, lock: 1, stale: 2, price: 3, other: 4 } as const;
const MIN_SHOW_MS = 700;
const COLLECT_MS = 60;

type Item = { text: string; rank: number; order: number; tag?: string };
const pending: Item[] = [];
let order = 0;
let holding = false;
let current = "";
let currentTag: string | undefined;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

const region = (): HTMLElement | null => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>('[role="status"][aria-label="Showroom status"]'));

async function show(text: string, tag?: string): Promise<void> {
  const el = region();
  if (!el) return;
  if (el.textContent !== "") {
    el.textContent = "";
    await Promise.resolve();
    await Promise.resolve();
  }
  el.textContent = text;
  current = text;
  currentTag = tag;
}

function pump(): void {
  pumpTimer = null;
  if (holding) return;
  pending.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const next = pending.shift();
  if (!next) return;
  holding = true;
  void show(next.text, next.tag);
  setTimeout(() => {
    holding = false;
    if (pending.length > 0) pump();
  }, MIN_SHOW_MS);
}

/** Holds a string to be shown; `tag` lets a later call drop it again (a stale string that stopped being true). */
export function announce(text: string, rank: number = RANK.other, tag?: string): void {
  pending.push({ text, rank, order: order++, tag });
  if (!holding && pumpTimer === null) pumpTimer = setTimeout(pump, COLLECT_MS);
}

/** Empties the region and drops waiting strings with this tag. */
export function clearStatus(tag?: string): void {
  for (let i = pending.length - 1; i >= 0; i--) if (!tag || pending[i]?.tag === tag) pending.splice(i, 1);
  const el = region();
  if (el && current !== "" && (!tag || currentTag === tag)) {
    el.textContent = "";
    current = "";
  }
}
