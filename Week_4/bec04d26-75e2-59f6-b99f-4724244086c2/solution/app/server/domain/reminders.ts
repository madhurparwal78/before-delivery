import { addDays } from "../../shared/calendar";
import { PRACTICE_ZONE, zonedInstant } from "./zone";

export const DEFAULT_REMINDER_HOUR = 9;

export const LEADS = [7, 1] as const;
export type Lead = (typeof LEADS)[number];

/** The state-local due date minus the lead, read at the reminder hour on the practice's Central clock. */
export function reminderAt(dueDate: string, lead: Lead, hour: number): number {
  return zonedInstant(addDays(dueDate, -lead), hour, 0, 0, 0, PRACTICE_ZONE);
}
