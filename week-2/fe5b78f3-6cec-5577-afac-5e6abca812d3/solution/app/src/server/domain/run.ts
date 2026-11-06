// A run and class as one unit of state: every passenger, their holds and their queue places (brief: Stretches).
import type { ClassCode, Gender, Quota, StatusCode } from "../../shared/api.js";
import type { Train } from "./catalog.js";
import { QUEUE_LISTS } from "./status.js";

export interface RunPassenger {
  pnr: string;
  number: number;
  age: number;
  gender: Gender;
  quota: Quota;
  /** Stop sequence numbers: the passenger holds from boarding `from` up to alighting `to`. */
  from: number;
  to: number;
  status: StatusCode;
  position: number | null;
  coach: string | null;
  berth: number | null;
  racPlace: number | null;
  /** Queue order inside RAC or a waiting list; later joiners have larger values. */
  seq: number | null;
}

export interface RunState {
  train: Train;
  runDate: string;
  cls: ClassCode;
  coaches: string[];
  passengers: RunPassenger[];
}

interface Stretch {
  from: number;
  to: number;
}

/** Holds that only touch at a stop do not overlap. */
function overlaps(a: Stretch, b: Stretch): boolean {
  return a.from < b.to && b.from < a.to;
}

export function berthFree(passengers: RunPassenger[], coach: string, berth: number, stretch: Stretch): boolean {
  return !passengers.some((p) => p.status === "CNF" && p.coach === coach && p.berth === berth && overlaps(p, stretch));
}

export function racPlaceFree(passengers: RunPassenger[], coach: string, berth: number, place: number, stretch: Stretch): boolean {
  return !passengers.some(
    (p) => p.status === "RAC" && p.coach === coach && p.berth === berth && p.racPlace === place && overlaps(p, stretch),
  );
}

export function nextSeq(passengers: RunPassenger[]): number {
  return passengers.reduce((max, p) => Math.max(max, p.seq ?? 0), 0) + 1;
}

export function inQueueOrder(passengers: RunPassenger[], status: StatusCode): RunPassenger[] {
  return passengers.filter((p) => p.status === status).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** RAC and each waiting list numbered from 1 upward, without gaps, keeping their order (brief: DP-46). */
export function renumber(passengers: RunPassenger[]): void {
  for (const list of ["RAC", ...QUEUE_LISTS] as StatusCode[]) {
    inQueueOrder(passengers, list).forEach((p, i) => {
      p.position = i + 1;
    });
  }
  for (const p of passengers) if (p.status !== "RAC" && !(QUEUE_LISTS as StatusCode[]).includes(p.status)) p.position = null;
}

export function cloneRun(state: RunState): RunState {
  return { ...state, passengers: state.passengers.map((p) => ({ ...p })) };
}
