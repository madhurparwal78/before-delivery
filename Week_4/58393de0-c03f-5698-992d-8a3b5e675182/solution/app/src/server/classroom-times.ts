import { copy } from "../shared/copy";
import { parseLocalTime, type LocalTimeParts } from "../shared/rules";
import type { ClassroomTimes } from "./classroom-state";
import { assertNoFieldErrors, validationError } from "./errors";
import { addLocalDays, instantToLocalWire, resolveLocalTime } from "./zone";

const JOIN_WINDOW_DAYS = 14;
const HAND_IN_DAYS = 70;

type TimeField = "joinOpensLocal" | "joinClosesLocal" | "handInLocal";

interface ResolvedTimes {
  joinOpensAt: Date;
  joinClosesAt: Date;
  handInAt: Date;
  joinOpensLocal: string;
  joinClosesLocal: string;
  handInLocal: string;
}

/**
 * The classroom-times rules, once, for create and edit. Fields given as local times are checked one field at a time (form,
 * daylight-saving gap, then the ordering rules), each field carrying at most one copy in `fields`. A field left out or empty
 * keeps the stored value (edit) or takes the default (create). Throws the 422 when any field in `fields` failed.
 */
export function resolveTimes(
  zone: string, input: Record<string, unknown>, now: Date, fields: Record<string, string>, stored?: ClassroomTimes,
): ResolvedTimes {
  if (fields.timeZone) throw validationError(fields);
  const given = (field: TimeField): { instant: Date; parts: LocalTimeParts } | undefined => {
    const raw = input[field];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return undefined;
    const parts = typeof raw === "string" ? parseLocalTime(raw) : null;
    if (!parts) {
      fields[field] = copy.timeFormat;
      return undefined;
    }
    const resolved = resolveLocalTime(parts, zone);
    if (resolved.inGap) {
      fields[field] = copy.dstGap(zone);
      return undefined;
    }
    return { instant: resolved.instant, parts };
  };

  const givenOpens = given("joinOpensLocal");
  const givenCloses = given("joinClosesLocal");
  const givenHandIn = given("handInLocal");

  if (fields.joinOpensLocal) throw validationError(fields);

  const opens = givenOpens?.instant ?? stored?.joinOpensAt ?? new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const sameWallTimeAfter = (days: number): Date => {
    const parts = givenOpens?.parts ?? parseLocalTime(instantToLocalWire(opens, zone));
    return parts ? resolveLocalTime(addLocalDays(parts, days), zone).instant : opens;
  };
  const closes = givenCloses?.instant ?? stored?.joinClosesAt ?? sameWallTimeAfter(JOIN_WINDOW_DAYS);
  const handIn = givenHandIn?.instant ?? stored?.handInAt ?? sameWallTimeAfter(HAND_IN_DAYS);

  if (!fields.joinClosesLocal && closes <= opens) fields.joinClosesLocal = copy.joinOrder;
  if (!fields.handInLocal) {
    const mustBeFuture = !stored || givenHandIn !== undefined;
    if (mustBeFuture && handIn <= now) fields.handInLocal = copy.handInPast;
    else if (!fields.joinClosesLocal && handIn < closes) fields.handInLocal = copy.handInBeforeClose;
  }
  assertNoFieldErrors(fields);

  const local = (instant: Date) => instantToLocalWire(instant, zone);
  return {
    joinOpensAt: opens, joinClosesAt: closes, handInAt: handIn,
    joinOpensLocal: local(opens), joinClosesLocal: local(closes), handInLocal: local(handIn),
  };
}
