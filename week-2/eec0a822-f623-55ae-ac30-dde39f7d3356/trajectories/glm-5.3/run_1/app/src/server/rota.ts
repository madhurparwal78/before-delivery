import type { RotaRule } from './types.js';
import { ROTA_RULE_TEXT } from './types.js';

export interface Slot {
  startsAtMs: number;
  endsAtMs: number;
  label: string;
  date: string;
  repeated: boolean;
}

export interface RestViolation {
  crewId: string;
  crewName: string;
  rule: RotaRule;
  windowStart: string;
  windowEnd: string;
}

export interface CrewWork {
  id: string;
  name: string;
  slotStarts: Set<number>;
}

const HALF_HOUR = 1800000;

/**
 * The rota rest rules, checked on rolling windows of real elapsed time.
 * Time outside the week counts as rest. Returns the first violation.
 */
export function checkRestRules(weekStartSlots: Slot[], crew: CrewWork[]): RestViolation | null {
  for (const member of crew) {
    const work = [...member.slotStarts].sort((a, b) => a - b);
    // Merge work into runs of contiguous half-hour slots by elapsed time.
    const workRuns: Array<[number, number]> = [];
    for (const start of work) {
      const last = workRuns[workRuns.length - 1];
      if (last && start - last[1] < HALF_HOUR) {
        last[1] = start + HALF_HOUR;
      } else {
        workRuns.push([start, start + HALF_HOUR]);
      }
    }

    // 1. max_gap_14h: no work run longer than 14 hours.
    for (const [ws, we] of workRuns) {
      if (we - ws > 14 * 3600000) {
        return { crewId: member.id, crewName: member.name, rule: 'max_gap_14h', windowStart: iso(ws), windowEnd: iso(we) };
      }
    }

    // Rest inside a window is the window minus the work inside it; time
    // outside the week counts as rest, so the window is fully rest beyond the week.
    const workInside = (from: number, to: number): number => {
      let total = 0;
      for (const [rs, re] of workRuns) {
        const s = Math.max(rs, from);
        const e = Math.min(re, to);
        if (e > s) total += e - s;
      }
      return total;
    };
    const restInside = (from: number, to: number): number => to - from - workInside(from, to);

    // Rest runs inside the window: the complement of the work runs.
    const restRunsInside = (from: number, to: number): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      let cursor = from;
      for (const [rs, re] of workRuns) {
        if (re <= from || rs >= to) continue;
        if (rs > cursor) out.push([cursor, Math.min(rs, to)]);
        cursor = Math.max(cursor, Math.min(re, to));
      }
      if (to > cursor) out.push([cursor, to]);
      return out;
    };

    const starts: number[] = weekStartSlots.map((s) => s.startsAtMs);

    // 2. min_rest_24h: at least 10 hours of rest in every 24-hour window.
    for (const start of starts) {
      const end = start + 24 * 3600000;
      if (restInside(start, end) < 10 * 3600000) {
        return { crewId: member.id, crewName: member.name, rule: 'min_rest_24h', windowStart: iso(start), windowEnd: iso(end) };
      }
    }

    // 3. min_rest_168h: at least 77 hours of rest in every 168-hour window.
    for (const start of starts) {
      const end = start + 168 * 3600000;
      if (restInside(start, end) < 77 * 3600000) {
        return { crewId: member.id, crewName: member.name, rule: 'min_rest_168h', windowStart: iso(start), windowEnd: iso(end) };
      }
    }

    // 4. rest_periods_24h: in every 24-hour window, rest falls into at most
    //    two runs, one of them at least 6 hours long.
    for (const start of starts) {
      const end = start + 24 * 3600000;
      const inside = restRunsInside(start, end);
      const longest = inside.reduce((m, [s, e]) => Math.max(m, e - s), 0);
      if (inside.length > 2 || longest < 6 * 3600000) {
        return { crewId: member.id, crewName: member.name, rule: 'rest_periods_24h', windowStart: iso(start), windowEnd: iso(end) };
      }
    }
  }
  return null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function rotaRuleText(rule: RotaRule): string {
  return ROTA_RULE_TEXT[rule];
}
