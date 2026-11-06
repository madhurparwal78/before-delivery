// The Chart drop (brief: Motion and effects): which steps a status change plays, and the moving chip itself.
import type { PassengerStatus, StatusCode } from "../../shared/api";
import { announcementLine } from "../../shared/format";

const COUNT_MS = 330;
export const LANE_MS = 320;
export const MORPH_MS = 420;
export const STAGGER_MS = 120;
const EASE_POINTS = [0.45, 0, 0.25, 1] as const;
const EASE = `cubic-bezier(${EASE_POINTS.join(", ")})`;

/** The eased progress (0 to 1) at linear time fraction `x`, on the same curve as the other Chart drop steps. */
function eased(x: number): number {
  const [x1, y1, x2, y2] = EASE_POINTS;
  const bezier = (t: number, p1: number, p2: number): number => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, y1, y2);
}

/** The time fraction at which the eased progress reaches `y`. */
function easedTimeFor(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (eased(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface Change {
  number: number;
  from: PassengerStatus;
  to: PassengerStatus;
}

const LISTS: StatusCode[] = ["GNWL", "RLWL", "PQWL", "TQWL", "RAC"];

export function changesBetween(before: PassengerStatus[], after: PassengerStatus[]): Change[] {
  return after.flatMap((to, i) => {
    const from = before[i];
    return from && from.label !== to.label ? [{ number: i + 1, from, to }] : [];
  });
}

/** Changes held back while a dialog is open merge per passenger: the first old status, the newest new one. */
export function mergeChanges(held: Change[], next: Change[]): Change[] {
  const merged = new Map(held.map((c) => [c.number, c]));
  for (const c of next) {
    const earlier = merged.get(c.number);
    merged.set(c.number, earlier ? { ...earlier, to: c.to } : c);
  }
  return [...merged.values()].filter((c) => c.from.label !== c.to.label).sort((a, b) => a.number - b.number);
}

export function batchMessage(changes: Change[]): string {
  return changes.map((c) => announcementLine(c.number, c.from, c.to)).join("\n");
}

/** The numbers the chip counts through: from the old number down to the new one, or to 1 when it leaves the list. */
export function countSteps(change: Change): string[] {
  const { from, to } = change;
  if (!LISTS.includes(from.status) || from.position === null) return [];
  const target = to.status === from.status && to.position !== null ? to.position : 1;
  const steps: string[] = [];
  for (let n = from.position - 1; n >= target; n--) steps.push(`${from.status} ${n}`);
  return steps;
}

/**
 * The wait before each count step, so the count starts slowly and settles gently on the eased curve while the
 * whole count still takes COUNT_MS: step i of n shows when the eased progress reaches i / n.
 */
export function countDelays(stepCount: number): number[] {
  const at = Array.from({ length: stepCount }, (_, i) => (i + 1 === stepCount ? 1 : easedTimeFor((i + 1) / stepCount)) * COUNT_MS);
  return at.map((t, i) => t - (at[i - 1] ?? 0));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** A chip's box and a copy of it, taken before the page moves the chip to its new place. */
interface Snapshot {
  box: DOMRect;
  copy: HTMLElement;
}

export function snapshot(element: Element | null): Snapshot | null {
  return element ? { box: element.getBoundingClientRect(), copy: element.cloneNode(true) as HTMLElement } : null;
}

/**
 * Carries a copy of the chip from where it was onto `target`'s box. The page already shows the final state
 * underneath; the copy only carries the eye from the old place to the new one and is removed when it lands.
 */
export function travel(from: Snapshot | null, target: Element | null, ms: number, narrow: boolean): void {
  if (!from || !target) return;
  const a = from.box;
  const b = target.getBoundingClientRect();
  const flyer = from.copy;
  flyer.classList.add("drop-flyer");
  flyer.setAttribute("aria-hidden", "true");
  flyer.removeAttribute("data-chip");
  Object.assign(flyer.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.append(flyer);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const scale = narrow ? 0.5 : Math.min(1, b.width / Math.max(1, a.width));
  const animation = flyer.animate(
    [{ transform: "translate(0, 0) scaleX(1)" }, { transform: `translate(${dx}px, ${dy}px) scaleX(${scale})` }],
    { duration: ms, easing: EASE, fill: "forwards" },
  );
  window.setTimeout(() => {
    animation.cancel();
    flyer.remove();
  }, ms);
}
