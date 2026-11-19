// Drivers' hours in real elapsed minutes, never wall-clock subtraction.
import type { Db } from "./db.js";
import { rows } from "./db.js";
import { addDays, instantToLocal, mondayOf, ukDate, type LocalDateTime } from "../shared/time.js";

export interface Block { kind: "drive" | "break" | "wait" | "rest"; minutes: number }
interface RunHours { id: string; blocks: Block[]; duty_start: number | null; telephone_folded: string | null; second_driver: boolean }
interface DutyRun extends RunHours { duty_start: number }
interface Breach { rule: "drivingBeforeBreak" | "dailyDriving" | "spread"; atMinute: number; atLocal: LocalDateTime }

const BEFORE_BREAK = 270;
const DAY_LIMIT = 540;
const LONG_DAY_LIMIT = 600;
const SPREAD_LIMIT = 780;

const drivingMinutes = (blocks: Block[]): number => blocks.filter((b) => b.kind === "drive").reduce((a, b) => a + b.minutes, 0);
export const spreadMinutes = (blocks: Block[]): number => blocks.reduce((a, b) => a + b.minutes, 0);

/** The elapsed minute at which a run's own driving reaches its `nth` minute. */
const elapsedAtDriving = (blocks: Block[], nth: number): number | null => {
  let driven = 0;
  let elapsed = 0;
  for (const block of blocks) {
    if (block.kind === "drive" && driven + block.minutes >= nth) return elapsed + (nth - driven);
    if (block.kind === "drive") driven += block.minutes;
    elapsed += block.minutes;
  }
  return null;
};

const beforeBreakBreach = (blocks: Block[]): number | null => {
  let driven = 0;
  let elapsed = 0;
  let firstPart = false;
  for (const block of blocks) {
    if (block.kind === "drive") {
      if (driven + block.minutes > BEFORE_BREAK) return elapsed + (BEFORE_BREAK - driven) + 1;
      driven += block.minutes;
    } else if (block.kind === "break") {
      if (block.minutes >= 45 || (firstPart && block.minutes >= 30)) {
        driven = 0;
        firstPart = false;
      } else if (block.minutes >= 15) firstPart = true;
    }
    elapsed += block.minutes;
  }
  return null;
};

export const hoursOf = async (db: Db, deskId: string, run: RunHours): Promise<{ drivingMinutes: number; spreadMinutes: number; breaches: Breach[] }> => {
  const answer = { drivingMinutes: drivingMinutes(run.blocks), spreadMinutes: spreadMinutes(run.blocks), breaches: [] as Breach[] };
  if (run.second_driver || run.duty_start === null) return answer;
  const start = run.duty_start;
  const self: DutyRun = { ...run, duty_start: start };
  const breach = (rule: Breach["rule"], atMinute: number): Breach => ({ rule, atMinute, atLocal: instantToLocal(start + atMinute * 60) });
  const beforeBreak = beforeBreakBreach(run.blocks);
  if (beforeBreak !== null) answer.breaches.push(breach("drivingBeforeBreak", beforeBreak));

  const day = ukDate(start);
  const monday = mondayOf(day);
  const peers = run.telephone_folded
    ? await rows<DutyRun>(db, "SELECT id,blocks,duty_start,telephone_folded,second_driver FROM runs WHERE desk_id=$1 AND telephone_folded=$2 AND duty_start IS NOT NULL AND NOT second_driver ORDER BY duty_start, id", [deskId, run.telephone_folded])
    : [self];
  const inWeek = (peers as DutyRun[]).filter((p) => { const d = ukDate(p.duty_start); return d >= monday && d <= addDays(monday, 6); });
  const totals = new Map<string, number>();
  for (const peer of inWeek) totals.set(ukDate(peer.duty_start), (totals.get(ukDate(peer.duty_start)) ?? 0) + drivingMinutes(peer.blocks));
  const earlierLongDays = [...totals.entries()].filter(([date, minutes]) => date < day && minutes > DAY_LIMIT).length;
  const limit = earlierLongDays >= 2 ? DAY_LIMIT : LONG_DAY_LIMIT;
  let before = 0;
  for (const peer of inWeek.filter((p) => ukDate(p.duty_start) === day)) {
    const own = drivingMinutes(peer.blocks);
    if (before + own > limit) {
      if (peer.id === run.id) answer.breaches.push(breach("dailyDriving", elapsedAtDriving(run.blocks, limit - before + 1) as number));
      break;
    }
    before += own;
  }
  if (answer.spreadMinutes > SPREAD_LIMIT) answer.breaches.push(breach("spread", SPREAD_LIMIT + 1));
  return answer;
};
