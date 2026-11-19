import { useEffect, useState } from "react";
import type { SlaChange, SlaView } from "../../server/sla.js";
import { useAnnounce } from "./announce.js";
import { useTopics } from "./live.js";

export type { SlaView };

/** An SLA as the last server message carried it, with the browser's monotonic clock reading at receipt. */
export interface ReceivedSla {
  sla: SlaView;
  receivedAt: number;
}

export function received(slas: SlaView[]): ReceivedSla[] {
  const at = performance.now();
  return slas.map((sla) => ({ sla, receivedAt: at }));
}

/** Re-renders once per second so countdowns advance by the browser's monotonic delta, never by its wall clock. */
export function useSecondTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return tick;
}

/** Shown remaining seconds: the last server value minus the elapsed delta, stopped at the next change of ticking. */
function remainingNow({ sla, receivedAt }: ReceivedSla): number {
  if (!sla.ticking) return sla.remaining_seconds;
  const since = Math.floor((performance.now() - receivedAt) / 1000);
  if (sla.next_change_at === null) return sla.remaining_seconds - since;
  const untilChange = Math.max(0, Math.round((Date.parse(sla.next_change_at) - Date.parse(sla.server_time)) / 1000));
  return sla.remaining_seconds - Math.min(since, untilChange);
}

export function formatHms(seconds: number): string {
  const total = Math.abs(Math.trunc(seconds));
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The countdown copy: running, paused, breached and still running, met or missed. */
export function slaText(entry: ReceivedSla): string {
  const { sla } = entry;
  if (sla.stage === "completed") return sla.breached ? "Missed" : "Met";
  const remaining = remainingNow(entry);
  if (sla.stage === "paused") return `Paused at ${formatHms(remaining)} left`;
  if (sla.breached) return `Breached by ${formatHms(remaining)}`;
  return `${formatHms(Math.max(0, remaining))} left`;
}

/** The SLA a row or card shows: highest percent among running or paused ones, ties by name. */
export function shownOf(slas: ReceivedSla[]): ReceivedSla | null {
  const live = slas.filter((s) => s.sla.stage === "in_progress" || s.sla.stage === "paused");
  live.sort((a, b) => b.sla.percent - a.sla.percent || (a.sla.definition < b.sla.definition ? -1 : a.sla.definition > b.sla.definition ? 1 : 0));
  return live[0] ?? null;
}

/**
 * Keeps one record's SLAs current from the live channel. With `announce`, pause, resume, threshold and breach
 * changes are announced in the status region.
 */
export function useSlaFeed(number: string | null, initial: SlaView[], announceChanges: boolean): ReceivedSla[] {
  const [slas, setSlas] = useState<ReceivedSla[]>(() => received(initial));
  const announce = useAnnounce();
  useEffect(() => setSlas(received(initial)), [initial]);
  useTopics(number ? [`sla:${number}`] : [], (message) => {
    setSlas(received((message.data.slas as SlaView[]) ?? []));
    if (!announceChanges) return;
    for (const change of (message.data.changes as SlaChange[]) ?? []) {
      if (change.kind === "paused") announce("SLA paused: on hold");
      else if (change.kind === "resumed") announce("SLA resumed");
      else if (change.kind === "threshold") announce(`SLA at ${change.percent} percent: ${change.definition}`);
      else if (change.kind === "breach") announce(`SLA breached: ${change.definition}`);
    }
  });
  return slas;
}
