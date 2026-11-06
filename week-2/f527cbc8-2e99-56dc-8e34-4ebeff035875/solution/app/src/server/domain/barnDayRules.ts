// Barn day state machine and the derived full status (brief: Business rules, Barn day states).
import { DAY_EDGES, type DayAction, type DayStatus, type StoredDayStatus, dayActionAllowed } from "../../shared/transitions.js";
import { illegalTransition } from "../errors.js";

export type { DayAction, DayStatus, StoredDayStatus };

/** A published day reads full exactly when every slot is taken by a live booking. */
export function dayStatus(stored: StoredDayStatus, bookedCount: number, slotCount: number): DayStatus {
  return stored === "published" && bookedCount === slotCount ? "full" : stored;
}

/** The stored status an action leads to, or the illegal-transition 409 naming the status as the API prints it. */
export function dayTransition(current: DayStatus, action: DayAction): StoredDayStatus {
  if (!dayActionAllowed(current, action)) throw illegalTransition(current, action);
  return DAY_EDGES[action].to;
}

/** Holds and offers are accepted only while the stored status is published and the start has not come. */
export const takesBookings = (stored: StoredDayStatus, startsAt: number, at: number): boolean => stored === "published" && at < startsAt;

/** Stored statuses an owner may read, at barns where they keep a horse; a barn manager also reads closed days. */
export const OWNER_VISIBLE_STORED: readonly StoredDayStatus[] = ["published", "in_progress"];
export const MANAGER_VISIBLE_STORED: readonly StoredDayStatus[] = ["published", "in_progress", "closed"];
