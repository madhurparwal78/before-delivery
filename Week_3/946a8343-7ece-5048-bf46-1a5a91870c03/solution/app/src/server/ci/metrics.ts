// Delivery metrics over production deployments (DP-32). Pure: facts in, four numbers out.
export interface DeploymentFact {
  readonly environmentId: number;
  readonly number: number;
  readonly status: string;
  readonly finishedAt: number;
  /** For each merged request this deployment was the first to ship: deployment finish minus its earliest commit author time. */
  readonly leadTimesMs: readonly number[];
}

export interface Metrics {
  readonly deployment_frequency: number | null;
  readonly lead_time_hours: number | null;
  readonly change_failure_rate: number | null;
  readonly recovery_time_hours: number | null;
}

const HOUR_MS = 3_600_000;

interface LocalDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function localParts(ms: number, zone: string): { day: LocalDay; asUtc: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const day = { year: get("year"), month: get("month"), day: get("day") };
  return { day, asUtc: Date.UTC(day.year, day.month - 1, day.day, get("hour"), get("minute"), get("second")) };
}

/** The instant the given local calendar day starts in `zone`. */
export function startOfLocalDay(day: LocalDay, zone: string): number {
  const guess = Date.UTC(day.year, day.month - 1, day.day);
  const offsetAt = (instant: number): number => localParts(instant, zone).asUtc - Math.floor(instant / 1000) * 1000;
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

function localDayOf(ms: number, zone: string): LocalDay {
  return localParts(ms, zone).day;
}

function shiftDays(day: LocalDay, delta: number): LocalDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + delta));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** [start, end) of the last `days` local days ending with today's. */
export function metricsWindow(now: number, zone: string, days: number): { start: number; end: number } {
  const today = localDayOf(now, zone);
  return { start: startOfLocalDay(shiftDays(today, -(days - 1)), zone), end: startOfLocalDay(shiftDays(today, 1), zone) };
}

/** The lower middle of an even count. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const SHIPPED = new Set(["success", "rolled_back"]);

export function computeMetrics(facts: readonly DeploymentFact[], now: number, zone: string, days: number): Metrics {
  const { start, end } = metricsWindow(now, zone, days);
  const inWindow = (fact: DeploymentFact): boolean => fact.finishedAt >= start && fact.finishedAt < end;
  const byEnvironment = new Map<number, DeploymentFact[]>();
  for (const fact of facts) {
    if (!SHIPPED.has(fact.status) && fact.status !== "failed") continue;
    byEnvironment.set(fact.environmentId, [...(byEnvironment.get(fact.environmentId) ?? []), fact]);
  }
  let shipped = 0;
  let changeFailures = 0;
  const leadTimes: number[] = [];
  const recoveries: number[] = [];
  for (const sequence of byEnvironment.values()) {
    sequence.sort((a, b) => a.number - b.number);
    sequence.forEach((fact, index) => {
      if (!inWindow(fact)) return;
      const next = sequence[index + 1];
      if (SHIPPED.has(fact.status)) {
        shipped += 1;
        leadTimes.push(...fact.leadTimesMs);
        if (fact.status === "rolled_back" || next?.status === "failed") changeFailures += 1;
        return;
      }
      const recovered = sequence.slice(index + 1).find((later) => SHIPPED.has(later.status));
      if (recovered !== undefined) recoveries.push(recovered.finishedAt - fact.finishedAt);
    });
  }
  const lead = median(leadTimes);
  const recovery = median(recoveries);
  return {
    deployment_frequency: round(shipped / days, 2),
    lead_time_hours: lead === null ? null : round(lead / HOUR_MS, 2),
    change_failure_rate: shipped === 0 ? null : round((changeFailures / shipped) * 100, 1),
    recovery_time_hours: recovery === null ? null : round(recovery / HOUR_MS, 2),
  };
}
