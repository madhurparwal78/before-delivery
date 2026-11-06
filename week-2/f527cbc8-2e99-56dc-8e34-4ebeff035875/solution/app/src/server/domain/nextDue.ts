// Next-due date and status (brief: Business rules, Next due).
import { addDays } from "../practiceTime.js";

/** SQL for the business date of a horse's last visit in any state other than open (the next-due input). */
export const lastVisitDateSql = (horseColumn: string): string =>
  `(SELECT max(v.business_date) FROM visits v WHERE v.horse_id = ${horseColumn} AND v.status <> 'open')`;

type DueStatus = "current" | "due" | "overdue" | "unknown";

interface NextDue {
  last_worked_date: string | null;
  next_due_date: string | null;
  due_status: DueStatus;
}

/** `lastVisitDate` is the business date of the horse's last visit in any state other than open. */
export function nextDue(lastVisitDate: string | null, cycleWeeks: number, today: string): NextDue {
  if (lastVisitDate === null) return { last_worked_date: null, next_due_date: null, due_status: "unknown" };
  const due = addDays(lastVisitDate, 7 * cycleWeeks);
  const status: DueStatus = today < addDays(due, -7) ? "current" : today <= due ? "due" : "overdue";
  return { last_worked_date: lastVisitDate, next_due_date: due, due_status: status };
}
