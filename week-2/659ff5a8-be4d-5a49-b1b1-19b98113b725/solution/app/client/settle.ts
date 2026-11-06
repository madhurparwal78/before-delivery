import type { RunView, StandingRow, View } from "../shared/api.js";
import { formatMs, parseRawTime, penaltyReadout } from "../shared/rules.js";

/** Cone-to-rank settle timeline, in milliseconds from the moment the update arrives. */
const ROLL_MS = 200;
const CHIP_GAP_MS = 125;
const DNF_HOLD_MS = 300;
export const SLIDE_MS = 500;
export const SLIDE_HOLD_MS = 300;

export interface Settle {
  registrationId: number;
  carLabel: string;
  outcome: "time" | "dnf";
  cones: number;
  /** Raw time digits roll from `fromMs` to `toMs`. */
  fromMs: number;
  toMs: number;
  /** For a DNF, the time that is struck through. */
  struck: string;
  /** When the indexed (or adjusted) time appears and the row starts to move. */
  revealAt: number;
  after: StandingRow[];
}

/** The run a change was about, in the rows after the change. */
function changedRun(row: StandingRow): RunView | undefined {
  return row.runs.find((run) => run.runNumber === row.lastChange?.runNumber);
}

/** A granted rerun records no time or cones, so there is nothing to settle; only its badge changes. */
export const isRerunGrant = (row: StandingRow): boolean => changedRun(row)?.outcome === "rerun";

const parseMs =(text: string | null): number => (text === null ? 0 : (parseRawTime(text) ?? 0));

/** The entry whose newest change is not in the rows already shown, if any. */
export function changedEntry(shown: StandingRow[], next: StandingRow[]): StandingRow | null {
  let found: StandingRow | null = null;
  for (const row of next) {
    const before = shown.find((s) => s.registrationId === row.registrationId);
    const fresh = row.lastChange !== null && row.lastChange.at !== before?.lastChange?.at;
    if (fresh && (found === null || (row.lastChange?.at ?? "") > (found.lastChange?.at ?? ""))) found = row;
  }
  return found;
}

export function planSettle(shown: StandingRow[], next: StandingRow[], subject: StandingRow): Settle {
  const before = shown.find((s) => s.registrationId === subject.registrationId);
  const run = changedRun(subject);
  const previous = before?.runs.find((r) => r.runNumber === run?.runNumber);
  const outcome = run?.outcome === "dnf" ? "dnf" : "time";
  const cones = outcome === "dnf" ? 0 : (run?.cones ?? 0);
  return {
    registrationId: subject.registrationId,
    carLabel: `${subject.carNumber} ${subject.classCode}`,
    outcome,
    cones,
    fromMs: parseMs(previous?.rawTime ?? null),
    toMs: parseMs(run?.rawTime ?? null),
    struck: previous?.rawTime ?? before?.bestAdjusted ?? "—",
    revealAt: outcome === "dnf" ? DNF_HOLD_MS : ROLL_MS + CHIP_GAP_MS * cones,
    after: next,
  };
}

interface Frame {
  roll: string;
  chips: number;
  penalty: string | null;
  /** 0 to 1 per chip: how far each chip has dropped. */
  drops: number[];
}

/** Everything the row shows `elapsed` milliseconds into the settle. */
export function frameAt(settle: Settle, elapsed: number): Frame {
  const rolled = Math.min(1, elapsed / ROLL_MS);
  const roll = formatMs(Math.round(settle.fromMs + (settle.toMs - settle.fromMs) * rolled));
  const dropped = elapsed < ROLL_MS ? 0 : Math.min(settle.cones, Math.floor((elapsed - ROLL_MS) / CHIP_GAP_MS) + 1);
  const drops = Array.from({ length: dropped }, (_, index) =>
    Math.min(1, (elapsed - ROLL_MS - index * CHIP_GAP_MS) / CHIP_GAP_MS),
  );
  return { roll, chips: dropped, penalty: dropped > 0 ? penaltyReadout(dropped) : null, drops };
}

/** A CSS-style cubic-bezier easing, solved for x by bisection. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const axis = (a: number, b: number, s: number): number => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  return (t) => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 24; step += 1) {
      const mid = (low + high) / 2;
      if (axis(x1, x2, mid) < t) low = mid;
      else high = mid;
    }
    return axis(y1, y2, (low + high) / 2);
  };
}

export const slideEase = bezier(0.2, 0.9, 0.25, 1);

export const positionOf = (row: StandingRow, view: View): number | null =>
  view === "indexed" ? row.position : view === "class" ? row.classPosition : row.rawPosition;

