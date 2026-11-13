import type { ChipCode, EventType, GameweekStatus, Position } from "../shared/api.ts";
import { leagueTime } from "../shared/leaguetime.ts";
import { formatTenths } from "../shared/money.ts";

// Display-only formatting and the brief's copy.
export const money = (tenths: number) => `${formatTenths(tenths)}m`;
export const millions = formatTenths;

export const POSITION_WORD: Record<Position, string> = { GK: "goalkeeper", DEF: "defender", MID: "midfielder", FWD: "forward" };
export const POSITION_PLURAL: Record<Position, string> = { GK: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
export const CHIP_NAME: Record<ChipCode, string> = { wildcard: "Wildcard", free_hit: "Free Hit", bench_boost: "Bench Boost", triple_captain: "Triple Captain" };
export const CHIP_ABOUT: Record<ChipCode, string> = {
  wildcard: "Every transfer you make this gameweek is free, and the changes are permanent.",
  free_hit: "Every transfer you make this gameweek is free, and your squad returns to how it was when the gameweek closes.",
  bench_boost: "All fifteen players score this gameweek, bench included.",
  triple_captain: "Your captain's points count three times instead of twice this gameweek.",
};
export const EVENT_LABEL: Record<EventType, string> = {
  minutes: "minutes played",
  goal: "goal",
  assist: "assist",
  clean_sheet: "clean sheet",
  yellow_card: "yellow card",
  red_card: "red card",
  own_goal: "own goal",
  bonus: "bonus",
};

export const deadlineCopy = (gameweek: number) => `Deadline passed. Gameweek ${gameweek} is locked, so this change was not saved.`;
export const lockedBanner = (gameweek: number) => `Gameweek ${gameweek} is locked. Pick Team and Transfers reopen when the next gameweek opens.`;
export const STORED = "Team locked, receipt stored";
export const PENDING = "Receipt pending. Your locked team is safe; the file will be stored when storage is back.";

export function statusLine(number: number, status: GameweekStatus, deadlineLocal: string | null): string {
  if (status === "open") return `Gameweek ${number} · Open · Deadline ${deadlineLocal ?? "not set"}`;
  return `Gameweek ${number} · ${status[0]!.toUpperCase()}${status.slice(1)}`;
}

export const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

export const leagueStamp = (iso: string) => leagueTime(new Date(iso));

const dublinNumeric = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const numericPart = (date: Date, type: Intl.DateTimeFormatPartTypes) => Number(dublinNumeric.formatToParts(date).find((p) => p.type === type)?.value);

function dublinOffsetMinutes(instant: number): number {
  const date = new Date(instant);
  const asUtc = Date.UTC(numericPart(date, "year"), numericPart(date, "month") - 1, numericPart(date, "day"), numericPart(date, "hour"), numericPart(date, "minute"));
  return Math.round((asUtc - Math.floor(instant / 60000) * 60000) / 60000);
}

// "2031-11-08 15:00" in league time → "2031-11-08T15:00:00+00:00". Null when it is not a time.
export function leagueInputToIso(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive) || new Date(naive).getUTCDate() !== d || h > 23 || mi > 59) return null;
  const offset = dublinOffsetMinutes(naive - dublinOffsetMinutes(naive) * 60000);
  const sign = offset < 0 ? "-" : "+";
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

export function isoToLeagueInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${numericPart(date, "year")}-${pad(numericPart(date, "month"))}-${pad(numericPart(date, "day"))} ${pad(numericPart(date, "hour"))}:${pad(numericPart(date, "minute"))}`;
}

export function leagueToday(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${numericPart(date, "year")}-${pad(numericPart(date, "month"))}-${pad(numericPart(date, "day"))}`;
}
