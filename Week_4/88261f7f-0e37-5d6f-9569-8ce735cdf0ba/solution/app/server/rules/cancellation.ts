import { addDays, type IsoDate } from "../../shared/dates";
import type { Cancellation, StayStatus } from "../../shared/api";
import { cancellationText } from "../../shared/notices";
import { FREE_CANCELLATION_HOUR, instantAt } from "../clock";

/** Free until 18:00:00 hotel time on the date before arrival; from that instant the first night is due. */
export function cancellationTerms(
  status: StayStatus, arrival: IsoDate, now: Date, timeZone: string, firstNightCents: number,
): Cancellation | null {
  if (status !== "booked") return null;
  const freeUntil = addDays(arrival, -1);
  const free = now.getTime() < instantAt(freeUntil, FREE_CANCELLATION_HOUR, timeZone).getTime();
  const terms = { state: free ? ("free" as const) : ("late" as const), feeCents: free ? 0 : firstNightCents };
  return { ...terms, text: cancellationText(terms, freeUntil) };
}
