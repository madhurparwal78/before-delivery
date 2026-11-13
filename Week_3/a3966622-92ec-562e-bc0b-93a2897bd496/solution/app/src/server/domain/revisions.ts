// Publishing tide revisions (dispatchers) and tariff revisions (the accounts clerk).
import { instantOfLocal, isPortDate, minuteOfDay, readPortMinute } from "../../shared/portTime.js";
import type { TonnageBand } from "../../shared/types.js";
import type { App } from "../app.js";
import { ApiError, invalid } from "../errors.js";
import type { TariffRevisionRecord, TideEvent, UserRecord } from "../store.js";
import { objectBody } from "../validate.js";
import { recheckCommitted } from "./moves.js";

const LABEL_MESSAGE = "Label must be one line of 1 to 40 characters";

function tideEvents(date: string, raw: unknown): TideEvent[] | string {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) return "Give 2 to 6 alternating high and low waters";
  const events: TideEvent[] = [];
  let previous = -1;
  for (const item of raw as unknown[]) {
    const event = (item ?? {}) as Record<string, unknown>;
    const minutes = typeof event.at === "string" ? minuteOfDay(event.at) : null;
    if (minutes === null || minutes <= previous) return "Event times are HH:MM, in rising order";
    if (instantOfLocal(date, minutes) === null) return "An event time falls in the hour skipped on this date";
    if (event.type !== "high" && event.type !== "low") return "Each event is a high or a low water";
    if (events.length && events[events.length - 1]?.type === event.type) return "High and low waters must alternate";
    if (typeof event.height_mm !== "number" || !Number.isInteger(event.height_mm) || Math.abs(event.height_mm) > 30_000) {
      return "Heights are whole millimetres";
    }
    events.push({ at: event.at as string, type: event.type, height_mm: event.height_mm });
    previous = minutes;
  }
  return events;
}

/** Replaces a date's events, raises the station tide version by one and re-checks committed moves. */
export function publishTideRevision(app: App, user: UserRecord, raw: unknown, now: number) {
  const body = objectBody(raw);
  const date = typeof body.date === "string" && isPortDate(body.date) ? body.date : null;
  if (!date) throw invalid({ date: "Give the date as YYYY-MM-DD" });
  const events = tideEvents(date, body.events);
  if (typeof events === "string") throw invalid({ events });
  return app.store.transaction(() => {
    const version = app.store.tideVersion() + 1;
    app.store.setMeta("tide_version", String(version));
    app.store.tideRevisions.put({ date, version, events });
    return { version, returned_to_ordered: recheckCommitted(app, user, now) };
  });
}

const wholeAtLeastZero = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function tonnageBands(raw: unknown): TonnageBand[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bands: TonnageBand[] = [];
  for (const [index, item] of (raw as unknown[]).entries()) {
    const band = (item ?? {}) as Record<string, unknown>;
    const last = index === raw.length - 1;
    const expectedFrom = index === 0 ? 0 : (bands[index - 1]?.to_gt ?? -1) + 1;
    if (band.from_gt !== expectedFrom || !wholeAtLeastZero(band.cents)) return null;
    if (last ? band.to_gt !== null : !wholeAtLeastZero(band.to_gt) || (band.to_gt as number) < expectedFrom) return null;
    bands.push({ from_gt: expectedFrom, to_gt: last ? null : (band.to_gt as number), cents: band.cents as number });
  }
  return bands;
}

export function publishTariffRevision(app: App, raw: unknown, now: number): TariffRevisionRecord {
  const body = objectBody(raw);
  const errors: Record<string, string> = {};
  const effective = typeof body.effective_at === "string" ? readPortMinute(body.effective_at) : null;
  if (effective?.kind === "ok" && app.store.tariffRevisions.by("effective_instant", effective.instant).length) {
    throw new ApiError(409, "effective_time_taken", "A revision already takes effect at that time");
  }
  const label = body.label;
  if (typeof label !== "string" || label.length < 1 || label.length > 40 || /[\r\n]/.test(label)) errors.label = LABEL_MESSAGE;
  if (effective?.kind !== "ok") errors.effective_at = "Give the effective time as YYYY-MM-DDTHH:MM port time";
  else if (effective.instant <= now) errors.effective_at = "The effective time must be later than now";
  const money = ["draft_foot_cents", "minimum_cents", "detention_half_hour_cents", "cancellation_cents", "detention_allowance_half_hours"] as const;
  for (const name of money) if (!wholeAtLeastZero(body[name])) errors[name] = "Use a whole number, 0 or more";
  if (!wholeAtLeastZero(body.night_percent) || (body.night_percent as number) > 100) {
    errors.night_percent = "Night surcharge is a whole percent from 0 to 100";
  }
  const bands = tonnageBands(body.tonnage_bands);
  if (!bands) errors.tonnage_bands = "Bands start at 0 GT, follow on without gaps, and only the last is open-ended";
  if (Object.keys(errors).length || effective?.kind !== "ok" || !bands) throw invalid(errors);
  const seq = app.store.next("tariff");
  return app.store.tariffRevisions.put({
    id: `TR-${seq}`,
    label: label as string,
    effective_at: body.effective_at as string,
    effective_instant: effective.instant,
    draft_foot_cents: body.draft_foot_cents as number,
    minimum_cents: body.minimum_cents as number,
    tonnage_bands: bands,
    night_percent: body.night_percent as number,
    detention_half_hour_cents: body.detention_half_hour_cents as number,
    detention_allowance_half_hours: body.detention_allowance_half_hours as number,
    cancellation_cents: body.cancellation_cents as number,
  });
}
