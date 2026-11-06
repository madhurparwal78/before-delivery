// Offices, closure dates, business days and the automatic release instant.

import { exec, lockKey, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, publicRoute, json } from "../http.js";
import { FieldErrors, notFound } from "../errors.js";
import { OFFICES, OFFICE_IDS, addDays, isIsoDate, isOfficeId, localToInstant, parseIsoDate, weekday,
  type OfficeId } from "../../shared/zones.js";
import { asObject, str } from "../util.js";
import { recomputeAutoRelease } from "./options.js";

export async function closuresOf(db: Db, office: OfficeId): Promise<Set<string>> {
  const found = await rows<{ day: string }>(db, "SELECT day FROM office_closures WHERE office_id = $1 ORDER BY day", [office]);
  return new Set(found.map((row) => row.day));
}

export function isBusinessDay(iso: string, closures: Set<string>): boolean {
  const day = weekday(iso);
  return day !== 0 && day !== 6 && !closures.has(iso);
}

/** 12:00 office time on the latest business day strictly before the job day. */
export function autoReleaseAt(jobDate: string, office: OfficeId, closures: Set<string>): number {
  let day = addDays(jobDate, -1);
  while (!isBusinessDay(day, closures)) day = addDays(day, -1);
  const { year, month, day: date } = parseIsoDate(day);
  const resolved = localToInstant({ year, month, day: date, hour: 12, minute: 0, second: 0 }, OFFICES[office].timeZone);
  if (resolved.kind === "gap") throw new RangeError(`noon is skipped on ${day}`);
  return resolved.ms;
}

async function officeBody(db: Db, office: OfficeId): Promise<Record<string, unknown>> {
  return {
    id: office,
    city: OFFICES[office].city,
    timeZone: OFFICES[office].timeZone,
    closures: [...(await closuresOf(db, office))],
  };
}

publicRoute("GET", "/api/offices", async () =>
  json(200, { offices: await Promise.all(OFFICE_IDS.map((office) => officeBody(pool, office))) }));

memberRoute("POST", "/api/offices/:office/closures", async (ctx) => {
  const office = ctx.params.office;
  if (!isOfficeId(office)) throw notFound();
  ctx.allow("agency_director");
  const body = asObject(await ctx.json());
  const date = str(body, "date");
  return tx(async (client) => {
    await lockKey(client, `closures:${office}`);
    const errors: FieldErrors = new FieldErrors();
    if (!isIsoDate(date) || !["2026", "2027"].includes(date.slice(0, 4))) {
      errors.add("date", "Choose a date in 2026 or 2027.");
    } else if ((await closuresOf(client, office)).has(date)) {
      errors.add("date", "That date is already a closure date.");
    }
    errors.throwIfAny();
    await exec(client, "INSERT INTO office_closures (office_id, day) VALUES ($1, $2)", [office, date]);
    await recomputeAutoRelease(client, office, ctx.now, ctx.member.name);
    const { closures } = await officeBody(client, office);
    return json(201, { office, closures });
  });
});
