// The booking shape: the one place that judges a claim or move body against the brief's shape rules.
// Each field fails with the sentence of the first rule it breaks; every failing field is reported at once.

import { CLOSES_MINUTE, HALF_HOUR, localDate, localMinute, localParts, MINUTE_MS, OPENS_MINUTE } from "../shared/clock.js";
import { SPAN_HINT_TEXT } from "../shared/format.js";
import type { StationKind } from "../shared/api.js";
import type { FieldErrors } from "./errors.js";
import { parseInstant } from "./fields.js";
import { MINIMUM_BOOKING_MINUTES, spanStatus, zone, type KitchenTime } from "./kitchen.js";

export interface BookingShape {
  stationId: string;
  shelfId: string | null;
  start: number;
  end: number;
}

const SENTENCE = {
  station: "Pick a station on the floor plan.",
  shelf: "Pick a walk-in shelf to pair with a range, prep table or mixer.",
  iso: "Use an ISO 8601 time with a UTC offset.",
  halfHour: "Use a time on the hour or half hour.",
  length: "Bookings last at least 2 h.",
  hours: "Book between 05:00 and 23:00 on one day.",
  different: "Pick a different station or span.",
} as const;

const onHalfHour = (instant: number): boolean => localParts(instant, zone).second === 0 && instant % 1000 === 0 && localMinute(instant, zone) % HALF_HOUR === 0;

/** `current` is the booking being moved, whose own occupancy a move may not simply repeat (rule 9). */
export function bookingShape(json: Readonly<Record<string, unknown>>, errors: FieldErrors,
  stations: readonly { id: string; kind: StationKind }[], time: KitchenTime, current: BookingShape | null): BookingShape {
  const stationId = typeof json.stationId === "string" ? json.stationId : "";
  const station = stations.find((s) => s.id === stationId);
  if (!station) errors.stationId = SENTENCE.station;

  let shelfId: string | null = null;
  if (json.shelfId !== undefined && json.shelfId !== null) {
    const shelf = stations.find((s) => s.id === json.shelfId && s.kind === "cooler_shelf");
    if (!shelf || station?.kind === "cooler_shelf") errors.shelfId = SENTENCE.shelf;
    else shelfId = shelf.id;
  }

  const start = parseInstant(json.start);
  const end = parseInstant(json.end);
  if (start === null) errors.start = SENTENCE.iso;
  if (end === null) errors.end = SENTENCE.iso;
  if (start !== null && !onHalfHour(start)) errors.start = SENTENCE.halfHour;
  if (end !== null && !onHalfHour(end)) errors.end = SENTENCE.halfHour;
  if (start !== null && end !== null && !errors.end && end - start < MINIMUM_BOOKING_MINUTES * MINUTE_MS) errors.end = SENTENCE.length;
  if (start !== null && !errors.start && (localMinute(start, zone) < OPENS_MINUTE || localMinute(start, zone) >= CLOSES_MINUTE)) {
    errors.start = SENTENCE.hours;
  }
  if (end !== null && !errors.end
    && ((start !== null && localDate(end, zone) !== localDate(start, zone)) || localMinute(end, zone) > CLOSES_MINUTE)) {
    errors.end = SENTENCE.hours;
  }
  if (start !== null && !errors.start) {
    const status = spanStatus(start, time);
    if (status !== "open") errors.start = SPAN_HINT_TEXT[status];
    else if (current && current.stationId === stationId && current.shelfId === shelfId && current.start === start && current.end === end) {
      errors.start = SENTENCE.different;
    }
  }
  return { stationId, shelfId, start: start ?? 0, end: end ?? 0 };
}
