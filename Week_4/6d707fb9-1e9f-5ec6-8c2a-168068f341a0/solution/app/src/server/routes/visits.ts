import { READING_UNITS, TOWNS, townName, townZone } from "../../shared/catalog";
import { hoursOfDay, instantText, isRealDate, isRealTime, shownDay, wallTime, wallToInstant } from "../../shared/time";
import { now, pool, transaction, type DbRow } from "../db";
import { ApiError, conflict, fieldErrors, notFound, ok, route, refused, type Answer, type Call, type Session } from "../http";
import { addSeconds, exact, fitsInteger, fullGrouped, isPlainDecimal, plain, readLocalNumber } from "../figures";
import { CLOSED_COPY, loadLiveLabel, newId, object, visitJson } from "../domain";
import type { VisitWithReadings } from "../../shared/api";

const EMPTY = "Give a value here.";
const NUMBER_COPY = "That number isn't in the form this page uses, for example 1,250.5.";

const desk = (call: Call): string => (call.session as Session).assessorId;

const VISIT_SELECT = `SELECT v.*, l.state AS label_state FROM visits v JOIN labels l ON l.id = v.label_id`;

route("GET", "/api/visits", {
  handle: async (call) => {
    const { rows } = await pool.query(`${VISIT_SELECT} WHERE v.assessor_id = $1 ORDER BY v.at`, [desk(call)]);
    return ok({ visits: rows.map(visitJson) });
  },
});

route("POST", "/api/visits", {
  input: "json",
  handle: async (call) => {
    const body = object(call.body);
    if (typeof body.labelId !== "string" || !body.labelId) throw fieldErrors({ labelId: EMPTY });
    const label = await loadLiveLabel(pool, desk(call), body.labelId);
    const fields: Record<string, string> = {};
    if (typeof body.factoryName !== "string" || !body.factoryName.trim()) fields.factoryName = EMPTY;
    const townKnown = TOWNS.some((town) => town.id === body.town);
    if (!townKnown) fields.town = EMPTY;
    const dateGood = typeof body.localDate === "string" && isRealDate(body.localDate);
    if (!dateGood) fields.localDate = "Give the date as YYYY-MM-DD.";
    const timeGood = typeof body.localTime === "string" && isRealTime(body.localTime);
    if (!timeGood) fields.localTime = "Give the time as HH:MM.";
    let at: Date | null = null;
    if (townKnown && dateGood && timeGood) {
      const town = body.town as string;
      at = wallToInstant(body.localDate as string, body.localTime as string, townZone(town));
      if (!at) {
        fields.localTime = `That time doesn't exist in ${townName(town)} on ${shownDay(body.localDate as string)} because the clocks change.`;
      }
    }
    if (Object.keys(fields).length) throw fieldErrors(fields);
    if (label.state !== "open") throw conflict(CLOSED_COPY);
    const { rows } = await pool.query(
      `INSERT INTO visits (id, assessor_id, label_id, factory_name, town, local_date, local_time, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [newId(), desk(call), label.id, body.factoryName, body.town, body.localDate, body.localTime, at],
    );
    return ok(visitJson(rows[0]), 201);
  },
});

const theVisit = async (call: Call): Promise<DbRow> => {
  const { rows } = await pool.query(`${VISIT_SELECT} WHERE v.id = $1 AND v.assessor_id = $2`, [call.params[0], desk(call)]);
  if (!rows[0]) throw notFound();
  return rows[0];
};

function readingJson(row: DbRow): { id: string; meter: number; value: string; unit: string; takenAt: string } {
  return { id: row.id, meter: row.meter, value: row.value, unit: row.unit, takenAt: instantText(row.taken_at) };
}

async function withReadings(visit: DbRow): Promise<VisitWithReadings> {
  const { rows } = await pool.query(`SELECT * FROM readings WHERE visit_id = $1 ORDER BY seq`, [visit.id]);
  return { ...visitJson(visit), readings: rows.map(readingJson) };
}

route("GET", "/api/visits/:id", {
  resource: theVisit,
  handle: async (_call, visit) => ok(await withReadings(visit)),
});

/** The visit a document carries, so its page can take readings even if the network drops right after load. */
export async function visitForDocument(assessorId: string, id: string): Promise<VisitWithReadings | null> {
  const { rows } = await pool.query(`${VISIT_SELECT} WHERE v.id = $1 AND v.assessor_id = $2`, [id, assessorId]);
  return rows[0] ? withReadings(rows[0]) : null;
}

route("GET", "/api/calendar/:date", {
  handle: async (call) => {
    const date = call.params[0] as string;
    if (!isRealDate(date)) throw refused("Give the date as YYYY-MM-DD.");
    const { rows } = await pool.query(`${VISIT_SELECT} WHERE v.assessor_id = $1 ORDER BY v.at`, [desk(call)]);
    return ok({
      date,
      shown: shownDay(date),
      hours: hoursOfDay(date),
      visits: rows.map(visitJson).filter((visit) => visit.lisbonDate === date),
    });
  },
});

/** The body a Request-Key is compared on: a retry recomputes secondsAgo and must still replay. */
function keyedBody(raw: Buffer): string {
  try {
    const { secondsAgo: _ignored, ...rest } = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))));
  } catch {
    return raw.toString("utf8");
  }
}

function requestKey(call: Call): string | null {
  const header = call.request.headers["request-key"];
  return typeof header === "string" && header ? header : null;
}

route("POST", "/api/visits/:id/readings", {
  input: "json",
  resource: theVisit,
  replay: async (call, visit): Promise<Answer | null> => {
    const key = requestKey(call);
    if (!key) return null;
    const { rows } = await pool.query(`SELECT * FROM reading_keys WHERE visit_id = $1 AND request_key = $2`, [visit.id, key]);
    const stored = rows[0];
    if (!stored) return null;
    if (stored.body !== keyedBody(call.raw)) {
      throw new ApiError(409, "key_reused", "That request key was used for another reading.");
    }
    return { status: stored.status, json: stored.response };
  },
  handle: async (call, visit) => {
    const body = object(call.body);
    const fields: Record<string, string> = {};
    const key = requestKey(call);
    if (!key) fields["Request-Key"] = EMPTY;
    if (!(fitsInteger(body.meter) && (body.meter as number) >= 1)) fields.meter = EMPTY;
    const unitKnown = READING_UNITS.some((unit) => unit.id === body.unit);
    if (!unitKnown) fields.unit = EMPTY;
    const typed = typeof body.value === "string" ? body.value.trim() : "";
    const value = typed ? (isPlainDecimal(typed) ? exact(typed) : readLocalNumber(typed, "en")) : null;
    if (!typed) fields.value = EMPTY;
    else if (!value) fields.value = NUMBER_COPY;
    const secondsAgo = body.secondsAgo ?? 0;
    if (!(fitsInteger(secondsAgo) && (secondsAgo as number) >= 0)) fields.secondsAgo = EMPTY;
    if (Object.keys(fields).length) throw fieldErrors(fields);
    if (visit.label_state !== "open") throw conflict(CLOSED_COPY);

    return transaction(async (tx) => {
      await tx.query(`SELECT id FROM visits WHERE id = $1 FOR UPDATE`, [visit.id]);
      const racing = await tx.query(`SELECT status, response FROM reading_keys WHERE visit_id = $1 AND request_key = $2`, [visit.id, key]);
      if (racing.rows[0]) return { status: racing.rows[0].status, json: racing.rows[0].response };
      const meter = body.meter as number;
      const previous = await tx.query(`SELECT * FROM readings WHERE visit_id = $1 AND meter = $2 ORDER BY seq`, [visit.id, meter]);
      const first = previous.rows[0];
      if (first && first.unit !== body.unit) throw fieldErrors({ unit: `Meter ${meter} reads in ${first.unit}.` });
      const last = previous.rows[previous.rows.length - 1];
      const reading = value as NonNullable<typeof value>;
      if (last && reading.lessThan(last.value) && body.keepMine !== true) {
        const message = `Meter ${meter} reads lower than ${fullGrouped(exact(last.value))} ${last.unit} recorded at ${wallTime(last.taken_at, townZone(visit.town))} ${townName(visit.town)} time. Keep which?`;
        throw new ApiError(409, "lower_reading", message, undefined, { lastValue: last.value, lastAt: instantText(last.taken_at) });
      }
      const inserted = await tx.query(
        `INSERT INTO readings (id, visit_id, meter, value, unit, taken_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [newId(), visit.id, meter, plain(reading), body.unit, addSeconds(now(), -(secondsAgo as number))],
      );
      const response = readingJson(inserted.rows[0]);
      await tx.query(
        `INSERT INTO reading_keys (visit_id, request_key, body, status, response) VALUES ($1, $2, $3, 201, $4)`,
        [visit.id, key, keyedBody(call.raw), JSON.stringify(response)],
      );
      return ok(response, 201);
    });
  },
});
