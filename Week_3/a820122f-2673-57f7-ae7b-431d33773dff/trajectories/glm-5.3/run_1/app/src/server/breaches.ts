import { query } from "./db.js";
import { CrewRecord } from "./crew-record.js";
import { judgeWindow, type RuleName } from "./rest-rules.js";
import { HOUR_MS, HALF_HOUR_MS, fromUtcString, toUtcString } from "../shared/time.js";

/**
 * Breaches stay on record: whenever a write makes a fully logged window fail
 * a rule, the server stores one breach per crew member, window width, window
 * start and rule. A breach recorded once is never removed or changed.
 */
export async function recordBreaches(record: CrewRecord, changedFromMs: number, changedToMs: number): Promise<void> {
  // Every window that can include a changed cell is re-judged: a window of
  // `hours` width ending after `changedFromMs` and starting before
  // `changedToMs`.
  for (const width of [24, 168] as const) {
    const earliestStart = changedFromMs - width * HOUR_MS + HALF_HOUR_MS;
    const latestStart = changedToMs - HALF_HOUR_MS;
    // Judge every half-hour step whose window touches the change, from the
    // earliest to the latest, and store each failing rule.
    for (let start = earliestStart; start <= latestStart; start += HALF_HOUR_MS) {
      const end = start + width * HOUR_MS;
      const cells = await record.cellSampleRange(start - HOUR_MS, end + HOUR_MS);
      const windowCells = cells.filter((c) => c.startMs >= start && c.startMs < end);
      if (windowCells.some((c) => c.state === "not_logged")) continue;
      const ruleSet = record.ruleSetAt(end);
      const judgement = judgeWindow(cells, start, width, ruleSet);
      if (judgement.failedRules.length === 0) continue;
      for (const rule of judgement.failedRules) {
        await storeBreach(record, rule, width, start, ruleSet, judgement.restHours);
      }
    }
  }
}

async function storeBreach(
  record: CrewRecord,
  rule: RuleName,
  width: 24 | 168,
  startMs: number,
  ruleSet: "standard" | "flag_exception",
  restHours: number
): Promise<void> {
  await query(
    `INSERT INTO breaches (id, crew_id, rule, window_hours, window_start_utc, window_end_utc, rule_set, rest_hours, recorded_at_utc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (crew_id, rule, window_hours, window_start_utc) DO NOTHING`,
    [
      `breach-${crypto.randomUUID()}`,
      record.crewId,
      rule,
      width,
      toUtcString(startMs),
      toUtcString(startMs + width * HOUR_MS),
      ruleSet,
      restHours,
      toUtcString(Date.now()),
    ],
  );
}

/** Whether a stored breach still holds, computed at read time. */
export async function stillBreaching(record: CrewRecord, rule: string, windowHours: number, windowStartUtc: string): Promise<boolean> {
  const startMs = fromUtcString(windowStartUtc)!;
  const end = startMs + windowHours * HOUR_MS;
  const cells = await record.cellSampleRange(startMs - HOUR_MS, end + HOUR_MS);
  const windowCells = cells.filter((c) => c.startMs >= startMs && c.startMs < end);
  if (windowCells.some((c) => c.state === "not_logged")) return false;
  const judgement = judgeWindow(cells, startMs, windowHours as 24 | 168, record.ruleSetAt(end));
  return judgement.failedRules.includes(rule as RuleName);
}
