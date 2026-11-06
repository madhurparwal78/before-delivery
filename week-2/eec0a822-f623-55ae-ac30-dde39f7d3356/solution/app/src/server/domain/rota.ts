// Rota weeks and the rest rules (brief: Rota and rest rules), counted on real elapsed time.
import { addDays, isoInstant, localClock, localDate, startOfLocalDay, type Base } from "../../shared/zones";

const SLOT_MS = 30 * 60 * 1000;
const DAY_SLOTS = 48;
const WEEK_SLOTS = 336;

interface Slot {
  startsAt: string;
  ms: number;
  date: string;
  label: string;
}

/** The half-hour slots of a rota week as they really occur (a day has 46, 48 or 50). */
export function weekSlots(weekStart: string, base: Base): Slot[] {
  const start = startOfLocalDay(weekStart, base);
  const end = startOfLocalDay(addDays(weekStart, 7), base);
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (let ms = start; ms < end; ms += SLOT_MS) {
    const date = localDate(ms, base);
    const clock = localClock(ms, base);
    const key = `${date} ${clock}`;
    slots.push({ startsAt: isoInstant(ms), ms, date, label: seen.has(key) ? `${clock} (repeat)` : clock });
    seen.add(key);
  }
  return slots;
}

type RestRule = "max_gap_14h" | "min_rest_24h" | "min_rest_168h" | "rest_periods_24h";

interface Breach {
  rule: RestRule;
  windowStartMs: number;
  windowEndMs: number;
}

/** Work flags for the week's slots; time outside the week counts as rest. */
function workAt(work: boolean[], index: number): boolean {
  return index >= 0 && index < work.length && work[index];
}

function restIn(work: boolean[], from: number, length: number): number {
  let rest = 0;
  for (let i = from; i < from + length; i += 1) if (!workAt(work, i)) rest += 1;
  return rest;
}

const RULES: Record<RestRule, (work: boolean[], startMs: number) => Breach | null> = {
  max_gap_14h(work, startMs) {
    for (let i = 0; i < work.length; ) {
      if (!work[i]) {
        i += 1;
        continue;
      }
      let end = i;
      while (end < work.length && work[end]) end += 1;
      if (end - i > 28) return { rule: "max_gap_14h", windowStartMs: startMs + i * SLOT_MS, windowEndMs: startMs + end * SLOT_MS };
      i = end;
    }
    return null;
  },
  min_rest_24h(work, startMs) {
    for (let i = 0; i < work.length; i += 1) {
      if (restIn(work, i, DAY_SLOTS) < 20) return { rule: "min_rest_24h", windowStartMs: startMs + i * SLOT_MS, windowEndMs: startMs + (i + DAY_SLOTS) * SLOT_MS };
    }
    return null;
  },
  min_rest_168h(work, startMs) {
    for (let i = 0; i < work.length; i += 1) {
      if (restIn(work, i, WEEK_SLOTS) < 154) return { rule: "min_rest_168h", windowStartMs: startMs + i * SLOT_MS, windowEndMs: startMs + (i + WEEK_SLOTS) * SLOT_MS };
    }
    return null;
  },
  rest_periods_24h(work, startMs) {
    for (let i = 0; i < work.length; i += 1) {
      let runs = 0;
      let longest = 0;
      let current = 0;
      for (let j = i; j < i + DAY_SLOTS; j += 1) {
        if (workAt(work, j)) {
          current = 0;
        } else {
          if (current === 0) runs += 1;
          current += 1;
          longest = Math.max(longest, current);
        }
      }
      if (runs > 2 || longest < 12) {
        return { rule: "rest_periods_24h", windowStartMs: startMs + i * SLOT_MS, windowEndMs: startMs + (i + DAY_SLOTS) * SLOT_MS };
      }
    }
    return null;
  },
};

const ORDER: RestRule[] = ["max_gap_14h", "min_rest_24h", "min_rest_168h", "rest_periods_24h"];

/** The first rule a crew member's week breaks, in the brief's order, with its earliest window. */
export function firstBreach(slots: Slot[], workSlots: ReadonlySet<number>): Breach | null {
  const work = slots.map((s) => workSlots.has(s.ms));
  for (const rule of ORDER) {
    const breach = RULES[rule](work, slots[0].ms);
    if (breach) return breach;
  }
  return null;
}
