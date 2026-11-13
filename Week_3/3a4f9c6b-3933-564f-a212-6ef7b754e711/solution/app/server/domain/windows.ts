// The window check and the openings list, both judged in the cluster's IANA zone
// (brief: Window check, Clock changes). The clock-change rule itself is `localToInstant`.
import { DAYS, type Day, type Freeze, type Opening, type SyncWindow, type WindowDecision } from "../../shared/api.js";
import { addDays, localMinute, localParts, localToInstant } from "../../shared/zone.js";

const weekdayOf = (date: string) => DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] as Day;

export interface PinnedPolicy { version: number; freezes: Freeze[] }

/** Freeze first (from the pinned policy version), then the cluster's weekly windows. */
export function checkWindow(at: number, stage: string, zone: string, windows: SyncWindow[], policy: PinnedPolicy): WindowDecision {
  const decision = { evaluated_at: new Date(at).toISOString(), local_time: localMinute(at, zone), policy_version: policy.version };
  const freeze = policy.freezes.find((f) => f.stages.includes(stage) && Date.parse(f.starts_at) <= at && at < Date.parse(f.ends_at));
  if (freeze) return { ...decision, open: false, reason: "freeze", window: null, freeze: { name: freeze.name } };
  if (windows.length === 0) return { ...decision, open: true, reason: "open", window: null, freeze: null };
  // Each window's opening and closing instants for the local day of `at` and the day before, by the clock-change rule.
  const today = localParts(at, zone).date;
  const open = windows.find((w) => [today, addDays(today, -1)].some((date) =>
    w.days.includes(weekdayOf(date)) && localToInstant(date, w.start, zone) <= at && at < localToInstant(date, w.end, zone)));
  if (open) return { ...decision, open: true, reason: "open", window: { id: open.id, label: open.label }, freeze: null };
  return { ...decision, open: false, reason: "outside_window", window: null, freeze: null };
}

/** The next `count` openings whose opening instant is at or after `from`, in order. */
export function openings(windows: SyncWindow[], zone: string, from: number, count: number): Opening[] {
  if (windows.length === 0) return [];
  const firstDay = addDays(localParts(from, zone).date, -1);
  const found: Opening[] = [];
  for (let offset = 0; offset <= count * 7 + 8; offset += 1) {
    const date = addDays(firstDay, offset);
    for (const w of windows.filter((x) => x.days.includes(weekdayOf(date)))) {
      const opensAt = localToInstant(date, w.start, zone);
      if (opensAt < from) continue;
      const closesAt = localToInstant(date, w.end, zone);
      found.push({
        window_id: w.id, label: w.label,
        opens_at: new Date(opensAt).toISOString(), closes_at: new Date(closesAt).toISOString(),
        local_opens: localMinute(opensAt, zone), local_closes: localMinute(closesAt, zone),
      });
    }
  }
  return found.sort((a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at)).slice(0, count);
}
