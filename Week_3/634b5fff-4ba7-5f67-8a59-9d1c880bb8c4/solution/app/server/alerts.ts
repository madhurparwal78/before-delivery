import { ALERT_COPY } from "../shared/copy.js";
import { formatDkk } from "../shared/money.js";
import type { Queryable } from "./db.js";
import { enqueue } from "./jobs.js";

/** Maker push alerts: queued in Postgres with the same transaction as the change that causes them. */

export const alertCaptureFailed = (q: Queryable, key: string, number: number, totalOre: number): Promise<void> =>
  enqueue(q, "alert", key, ALERT_COPY.captureFailed(number, formatDkk(totalOre)));

export const alertAuthorisationExpired = (q: Queryable, key: string, number: number, totalOre: number): Promise<void> =>
  enqueue(q, "alert", key, ALERT_COPY.authorisationExpired(number, formatDkk(totalOre)));

export const alertDeadLettered = (q: Queryable, eventId: string, number: number): Promise<void> =>
  enqueue(q, "alert", `dead-${eventId}-${Date.now()}`, ALERT_COPY.deadLettered(eventId, number));

export const alertLowStock = (q: Queryable, key: string, remaining: number): Promise<void> =>
  enqueue(q, "alert", key, ALERT_COPY.lowStock(remaining));
