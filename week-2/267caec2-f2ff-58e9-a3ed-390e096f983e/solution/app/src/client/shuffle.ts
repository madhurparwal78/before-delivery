import type { Award, Cut } from "./api";
import { reducedMotion } from "./dialog";
import { iconMarkup, markerMarkup } from "./icons";

// The Cut Shuffle (brief: Motion and effects): score roll 0–320 ms, row travel from 320 ms over 480 ms staggered
// 40 ms in new-rank order, marker swap as a row's centre crosses the cut, then one summary line. Every graded
// motion is element.animate(); reduced motion re-orders at once with static up/down labels.

const ROLL_MS = 320;
const TRAVEL_MS = 480;
const STAGGER_MS = 40;
const ROLL_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const TRAVEL_CURVE = [0.16, 1, 0.3, 1] as const;
const TRAVEL_EASING = `cubic-bezier(${TRAVEL_CURVE.join(", ")})`;

export interface LedgerRow {
  key: string;
  rank: number;
  entryNumber: number;
  title: string;
  meta: string;
  category: string;
  score: string | null;
  cut: Cut;
  award: Award | null;
}

function ordinal(n: number): string {
  if ([11, 12, 13].includes(n % 100)) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

interface Move {
  entryNumber: number;
  from: number;
  to: number;
  crossed: boolean;
  side: Cut;
}

/** The one line announced after the rows settle. */
function summary(moves: Move[]): string {
  if (!moves.length) return "Scores updated, no change in order.";
  const crossed = moves.filter((m) => m.crossed);
  const [named] = [...(crossed.length ? crossed : moves)]
    .sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to) || a.to - b.to);
  const head = named as Move;
  const line = `Entry ${head.entryNumber} moved from ${ordinal(head.from)} to ${ordinal(head.to)}, now ${head.side} the cut.`;
  return moves.length > 1 ? `${line} ${moves.length - 1} other entries moved.` : line;
}

/** y of the travel easing curve at progress x, solved by bisection on the bezier's x. */
function travelProgress(x: number): number {
  const [x1, y1, x2, y2] = TRAVEL_CURVE;
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2, y1, y2);
}

/** The fraction of the travel at which a row's centre, gliding from `start` to `end`, passes `line`. */
function crossingAt(start: number, end: number, line: number): number {
  for (let step = 1; step <= 96; step++) {
    const x = step / 96;
    const centre = start + (end - start) * travelProgress(x);
    if (Math.sign(centre - line) !== Math.sign(start - line)) return x;
  }
  return 1;
}

function cell(row: HTMLTableRowElement, name: string): HTMLElement {
  return row.querySelector(`.${name}`) as HTMLElement;
}

export class Ledger {
  private rows: LedgerRow[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly elements = new Map<string, HTMLTableRowElement>();
  private readonly cutRow: HTMLTableRowElement;

  constructor(private readonly body: HTMLTableSectionElement, cutLabel: string, private readonly cutCount: number,
    private readonly announce: (line: string) => void) {
    this.cutRow = document.createElement("tr");
    this.cutRow.className = "cut-row";
    const holder = document.createElement("td");
    holder.colSpan = 5;
    const rule = document.createElement("div");
    rule.className = "cut-rule";
    rule.setAttribute("role", "separator");
    rule.setAttribute("aria-label", cutLabel);
    holder.append(rule);
    this.cutRow.append(holder);
  }

  /** Renders `rows` at once; `deltas` adds the reduced-motion "up k" / "down k" labels. */
  show(rows: LedgerRow[], deltas = new Map<string, number>()): void {
    for (const row of rows) this.fill(this.element(row.key), row, deltas.get(row.key) ?? 0);
    for (const [key, element] of this.elements) {
      if (!rows.some((r) => r.key === key)) {
        element.remove();
        this.elements.delete(key);
      }
    }
    this.place(rows.map((r) => r.key));
    this.rows = rows;
  }

  /** Moves from what is shown to `rows`, after any shuffle still running has settled. */
  update(rows: LedgerRow[]): Promise<void> {
    this.queue = this.queue.then(() => this.change(this.rows, rows));
    return this.queue;
  }

  /** Shows `from` at once, then shuffles to `to` (a reveal, or its replay). */
  replay(from: LedgerRow[], to: LedgerRow[]): Promise<void> {
    this.queue = this.queue.then(() => {
      this.show(from);
      return this.change(from, to);
    });
    return this.queue;
  }

  private element(key: string): HTMLTableRowElement {
    let row = this.elements.get(key);
    if (!row) {
      row = document.createElement("tr");
      row.innerHTML = `<td class="rank num"></td><td class="entry"><span class="entry__title"></span>`
        + `<span class="entry__meta"></span><span class="entry__fold"></span></td><td class="category"></td>`
        + `<td class="score num"></td><td><div class="status"></div></td>`;
      this.elements.set(key, row);
    }
    return row;
  }

  private fill(element: HTMLTableRowElement, row: LedgerRow, delta: number): void {
    cell(element, "rank").textContent = String(row.rank);
    cell(element, "entry__title").textContent = row.title;
    cell(element, "entry__meta").textContent = row.meta;
    cell(element, "entry__fold").textContent = row.category;
    cell(element, "category").textContent = row.category;
    cell(element, "score").textContent = row.score ?? "—";
    const status = cell(element, "status");
    status.innerHTML = markerMarkup(row.cut) + (row.award ? markerMarkup(row.award) : "");
    if (delta) {
      const label = document.createElement("span");
      label.className = "delta";
      label.innerHTML = iconMarkup(delta > 0 ? "arrow-up" : "arrow-down");
      label.append(`${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`);
      status.append(label);
    }
  }

  /** Orders the rows in the page with the cut rule after the last above-cut slot. */
  private place(keys: string[]): void {
    const ordered = keys.map((k) => this.elements.get(k) as HTMLTableRowElement);
    ordered.splice(Math.min(this.cutCount, ordered.length), 0, this.cutRow);
    ordered.forEach((row, i) => {
      if (this.body.children[i] !== row) this.body.insertBefore(row, this.body.children[i] ?? null);
    });
  }

  private async change(prev: LedgerRow[], next: LedgerRow[]): Promise<void> {
    const before = new Map(prev.map((r) => [r.key, r]));
    if (prev.length !== next.length || next.some((r) => !before.has(r.key))) {
      this.show(next);
      return;
    }
    const moves: Move[] = [];
    const rescored: LedgerRow[] = [];
    for (const row of next) {
      const old = before.get(row.key) as LedgerRow;
      if (old.rank !== row.rank) {
        moves.push({ entryNumber: row.entryNumber, from: old.rank, to: row.rank, crossed: old.cut !== row.cut, side: row.cut });
      }
      if (old.score !== row.score) rescored.push(row);
    }
    if (!moves.length && !rescored.length) {
      this.show(next);
      return;
    }
    const line = summary(moves);
    if (reducedMotion()) {
      this.show(next, new Map(next.map((r) => [r.key, (before.get(r.key) as LedgerRow).rank - r.rank])));
      this.announce(line);
      return;
    }

    const firstTop = new Map(next.map((r) => [r.key, (this.elements.get(r.key) as HTMLTableRowElement).getBoundingClientRect().top]));
    const animations: Animation[] = [];
    for (const row of rescored) {
      animations.push(...this.roll(this.elements.get(row.key) as HTMLTableRowElement, (before.get(row.key) as LedgerRow).score, row.score));
    }
    this.place(next.map((r) => r.key));
    const rule = this.cutRow.getBoundingClientRect();
    const cutLine = rule.top + rule.height / 2;
    const swaps: number[] = [];
    let moved = 0;
    for (const row of next) {
      const old = before.get(row.key) as LedgerRow;
      if (old.rank === row.rank) continue;
      const element = this.elements.get(row.key) as HTMLTableRowElement;
      const box = element.getBoundingClientRect();
      const shift = (firstTop.get(row.key) ?? box.top) - box.top;
      const delay = ROLL_MS + STAGGER_MS * moved++;
      animations.push(element.animate([{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }],
        { duration: TRAVEL_MS, delay, easing: TRAVEL_EASING, fill: "backwards" }));
      if (old.cut !== row.cut) {
        const centre = box.top + box.height / 2;
        const at = crossingAt(centre + shift, centre, cutLine);
        swaps.push(window.setTimeout(() => {
          const status = cell(element, "status");
          status.firstElementChild?.remove();
          status.insertAdjacentHTML("afterbegin", markerMarkup(row.cut));
        }, delay + at * TRAVEL_MS));
      }
    }
    await Promise.all(animations.map((a) => a.finished.catch(() => undefined)));
    swaps.forEach((timer) => clearTimeout(timer));
    this.show(next);
    this.announce(line);
  }

  /** Odometer roll of each changed character from the old two-decimal value to the new one. */
  private roll(element: HTMLTableRowElement, from: string | null, to: string | null): Animation[] {
    const before = from ?? "—";
    const after = to ?? "—";
    const width = Math.max(before.length, after.length);
    const a = before.padStart(width, " ");
    const b = after.padStart(width, " ");
    const score = cell(element, "score");
    score.textContent = "";
    const reels = document.createElement("span");
    reels.className = "reels";
    reels.setAttribute("aria-hidden", "true");
    const hidden = document.createElement("span");
    hidden.className = "sr-only";
    hidden.textContent = after;
    const animations: Animation[] = [];
    for (let i = 0; i < width; i++) {
      const was = a[i] ?? " ";
      const now = b[i] ?? " ";
      if (was === now) {
        reels.append(was);
        continue;
      }
      const slot = document.createElement("span");
      slot.className = "reel";
      const strip = document.createElement("span");
      strip.className = "reel__strip";
      const rising = !(Number(now) < Number(was));
      strip.append(...(rising ? [was, now] : [now, was]).map((ch) => {
        const glyph = document.createElement("span");
        glyph.textContent = ch;
        return glyph;
      }));
      slot.append(strip);
      reels.append(slot);
      animations.push(strip.animate(rising
        ? [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }]
        : [{ transform: "translateY(-50%)" }, { transform: "translateY(0)" }],
      { duration: ROLL_MS, easing: ROLL_EASING, fill: "forwards" }));
    }
    score.append(reels, hidden);
    return animations;
  }
}
