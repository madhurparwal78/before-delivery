import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../engine/ids.js";
import {
  dayHours,
  instantOf,
  isValidLocalDate,
  isValidLocalTime,
  LISBON,
  localDateOf,
  shownDateTime,
  shownDate,
  shownTime,
  TOWNS,
  wallToInstant,
  addSeconds,
  type TownId,
} from "../engine/time.js";
import { fromZonedTime } from "date-fns-tz";
import { requireDesk } from "../app.js";
import { errConflict, errKeyReused, errLowerReading, errNotFound, errValidation } from "./errors.js";
import { COPY } from "../engine/copy.js";
import { one, rows } from "../db/pool.js";
import { isDecimal } from "../engine/decimal.js";
import { groupInt } from "../engine/display.js";
import { labelOfDesk, townName } from "./labels.js";

export interface VisitRow {
  id: string;
  desk_id: string;
  label_id: string;
  factory_name: string;
  town: string;
  local_date: string;
  local_time: string;
  at: string;
}

export function visitOut(v: VisitRow): Record<string, unknown> {
  const zone = TOWNS[v.town as TownId].zone;
  const at = new Date(v.at);
  const lisbon = localDateOf(at, LISBON);
  return {
    id: v.id,
    labelId: v.label_id,
    factoryName: v.factory_name,
    town: v.town,
    townName: townName(v.town),
    localDate: v.local_date,
    localTime: v.local_time,
    at: v.at,
    lisbonDate: lisbon,
    lisbonDayHours: dayHours(LISBON, lisbon),
    shown: `${shownDate(at, zone)}, ${v.local_time} ${townName(v.town)} time \u00B7 ${shownDateTime(at, LISBON, "Lisbon").replace(/^.+, /, "")}`,
  };
}

async function visitOfDesk(deskId: string, visitId: string): Promise<VisitRow> {
  const v = await one<VisitRow>(`SELECT * FROM visits WHERE id = $1`, [visitId]);
  if (!v || v.desk_id !== deskId) throw errNotFound();
  return v;
}

export function registerVisitRoutes(app: FastifyInstance): void {
  app.get("/api/visits", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const list = await rows<VisitRow>(`SELECT * FROM visits WHERE desk_id = $1 ORDER BY at ASC`, [deskId]);
    return { visits: list.map(visitOut) };
  });

  app.post("/api/visits", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const body = req.body as Record<string, unknown>;
    const labelId = typeof body?.labelId === "string" ? body.labelId : "";
    const factoryName = typeof body?.factoryName === "string" ? body.factoryName : "";
    const town = typeof body?.town === "string" ? body.town : "";
    const localDate = typeof body?.localDate === "string" ? body.localDate : "";
    const localTime = typeof body?.localTime === "string" ? body.localTime : "";
    await labelOfDesk(deskId, labelId);
    const fields: Record<string, string> = {};
    if (factoryName.length === 0 || factoryName.length > 120) fields.factoryName = COPY.emptyField;
    if (!["porto", "izmir", "hoChiMinhCity", "cairo"].includes(town)) fields.town = COPY.emptyField;
    if (!isValidLocalDate(localDate)) fields.localDate = COPY.dateForm;
    if (!isValidLocalTime(localTime)) fields.localTime = COPY.timeForm;
    if (Object.keys(fields).length === 0 && isValidLocalDate(localDate) && isValidLocalTime(localTime)) {
      const zone = TOWNS[town as TownId].zone;
      const res = wallToInstant(localDate, localTime, zone);
      if ("skipped" in res) {
        fields.localTime = COPY.skippedTime(townName(town), shownDateLocal(localDate));
      }
    }
    if (Object.keys(fields).length > 0) throw errValidation(fields);
    const zone = TOWNS[town as TownId].zone;
    const at = wallToInstant(localDate, localTime, zone);
    if ("skipped" in at) throw errConflict(COPY.skippedTime(townName(town), shownDateLocal(localDate)));
    const id = newId();
    await rows(
      `INSERT INTO visits (id, desk_id, label_id, factory_name, town, local_date, local_time, at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, deskId, labelId, factoryName, town, localDate, localTime, instantOf(at.at), instantOf(new Date())],
    );
    reply.status(201);
    const v = await visitOfDesk(deskId, id);
    return visitOut(v);
  });

  app.get("/api/visits/:id", async (req: FastifyRequest) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const v = await visitOfDesk(deskId, id);
    const readings = await rows<{ id: string; meter: number; value: string; unit: string; taken_at: string }>(
      `SELECT id, meter, value, unit, taken_at FROM readings WHERE visit_id = $1 ORDER BY taken_at ASC, id ASC`,
      [id],
    );
    return { ...visitOut(v), readings: readings.map((r) => ({ id: r.id, meter: r.meter, value: r.value, unit: r.unit, takenAt: r.taken_at })) };
  });

  app.get("/api/calendar/:date", async (req: FastifyRequest) => {
    await requireDesk(req);
    const { date } = req.params as { date: string };
    if (!isValidLocalDate(date)) throw errValidation({ date: COPY.dateForm });
    const hours = dayHours(LISBON, date);
    const all = await rows<VisitRow>(`SELECT * FROM visits`);
    const inDay = all.filter((v) => localDateOf(new Date(v.at), LISBON) === date);
    return {
      date,
      shown: shownDateLocal(date),
      hours,
      visits: inDay.map(visitOut),
    };
  });

  app.post("/api/visits/:id/readings", async (req: FastifyRequest, reply: FastifyReply) => {
    const { deskId } = await requireDesk(req);
    const { id } = req.params as { id: string };
    const v = await visitOfDesk(deskId, id);
    const body = req.body as Record<string, unknown>;
    const requestKey = req.headers["request-key"];
    if (typeof requestKey !== "string" || requestKey.length === 0) {
      throw errValidation({ requestKey: COPY.emptyField });
    }
    const meter = typeof body?.meter === "number" ? body.meter : Number.parseInt(String(body?.meter ?? ""), 10);
    const value = typeof body?.value === "string" ? body.value : String(body?.value ?? "");
    const unit = typeof body?.unit === "string" ? body.unit : "";
    const secondsAgo = typeof body?.secondsAgo === "number" ? body.secondsAgo : null;
    const keepMine = body?.keepMine === true;

    // A repeated Request-Key answers the first response and changes nothing.
    const prior = await one<{ status: number; body: string }>(`SELECT status, body FROM reading_keys WHERE request_key = $1`, [requestKey]);
    if (prior) {
      if (!keepMine) {
        reply.status(prior.status);
        reply.header("Content-Type", "application/json");
        return reply.send(prior.body);
      }
      const sameBody = await sameReadingBody(requestKey, { meter, value, unit });
      if (!sameBody) throw errKeyReused();
      reply.status(prior.status);
      reply.header("Content-Type", "application/json");
      return reply.send(prior.body);
    }

    const fields: Record<string, string> = {};
    if (!Number.isInteger(meter) || (meter as number) < 1) fields.meter = COPY.emptyField;
    if (!isDecimal(value) || value.startsWith("-")) fields.value = COPY.emptyField;
    if (!["kWh", "MJ", "m3"].includes(unit)) fields.unit = COPY.emptyField;
    if (secondsAgo === null || !Number.isInteger(secondsAgo) || secondsAgo < 0) fields.secondsAgo = COPY.emptyField;
    if (Object.keys(fields).length > 0) throw errValidation(fields);

    // A meter keeps the unit of its first reading.
    const firstOfMeter = await one<{ unit: string }>(
      `SELECT unit FROM readings WHERE visit_id = $1 AND meter = $2 ORDER BY taken_at ASC LIMIT 1`,
      [id, meter],
    );
    if (firstOfMeter && firstOfMeter.unit !== unit) {
      throw errValidation({ unit: COPY.meterUnitDiffers(meter, firstOfMeter.unit) });
    }

    // A lower reading answers 409 with lastValue and lastAt, unless keepMine.
    const last = await one<{ value: string; unit: string; taken_at: string }>(
      `SELECT value, unit, taken_at FROM readings WHERE visit_id = $1 AND meter = $2 ORDER BY taken_at DESC, id DESC LIMIT 1`,
      [id, meter],
    );
    if (last && !keepMine) {
      const { cmp } = await import("../engine/decimal.js");
      if (cmp(value, last.value) < 0) {
            const lastAt = new Date(last.taken_at);
        const timeText = shownTime(lastAt, TOWNS[v.town as TownId].zone);
        const message = COPY.lowerReading(meter, groupInt(last.value), last.unit, timeText, townName(v.town));
        throw errLowerReading(last.value, last.taken_at, message);
      }
    }

    // takenAt is the server's receipt time minus secondsAgo, in whole seconds.
    const takenAt = instantOf(addSeconds(new Date(), -secondsAgo!));
    const readingId = newId();
    await rows(
      `INSERT INTO readings (id, visit_id, meter, value, unit, taken_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [readingId, id, meter, value, unit, takenAt],
    );
    const responseBody: string = JSON.stringify({
      id: readingId,
      meter,
      value,
      unit,
      takenAt,
    });
    await rows(`INSERT INTO reading_keys (request_key, status, body) VALUES ($1, 201, $2)`, [requestKey, responseBody]);
    reply.status(201);
    return { id: readingId, meter, value, unit, takenAt };
  });
}

async function sameReadingBody(requestKey: string, incoming: { meter: number; value: string; unit: string }): Promise<boolean> {
  const stored = await one<{ body: string }>(`SELECT body FROM reading_keys WHERE request_key = $1`, [requestKey]);
  if (!stored) return true;
  try {
    const parsed = JSON.parse(stored.body) as { meter: number; value: string; unit: string };
    return parsed.meter === incoming.meter && parsed.value === incoming.value && parsed.unit === incoming.unit;
  } catch {
    return false;
  }
}

function shownDateLocal(date: string): string {
  return shownDate(fromZonedTime(`${date}T12:00:00`, LISBON), LISBON);
}
