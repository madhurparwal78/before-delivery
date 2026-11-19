// The guest's choices live in the address bar: party, date and (once chosen) time.
import { addDays } from "../../shared/calendar.js";
import { queryString } from "../router.js";

export interface Choice {
  party: number;
  date: string;
  time: string | null;
}

export function choiceKey(choice: Choice): string {
  return `${choice.date}|${choice.party}|${choice.time ?? ""}`;
}

export function bookUrl(choice: Choice): string {
  return `/book${queryString({ date: choice.date, party: String(choice.party), time: choice.time })}`;
}

/**
 * The choice an address stands for. A missing or invalid party becomes 2, a missing, invalid or out-of-range date
 * becomes today, and a time that is not a slot time is dropped. Availability drops a time that is not bookable.
 */
export function readChoice(search: string, today: string, horizonDays: number, slotTimes: string[]): Choice {
  const params = new URLSearchParams(search);
  const party = Number(params.get("party"));
  const date = params.get("date") ?? "";
  const time = params.get("time");
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today && date <= addDays(today, horizonDays);
  return {
    party: Number.isInteger(party) && party >= 1 && party <= 8 ? party : 2,
    date: dateOk ? date : today,
    time: time !== null && slotTimes.includes(time) ? time : null,
  };
}
