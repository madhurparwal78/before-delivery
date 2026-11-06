import { randomUUID } from "node:crypto";
import { pool, rows, transaction } from "../db";
import { readUpload, type Json } from "../http";
import { route } from "../router";
import { Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { isoInstant, localDate, type Base } from "../../shared/zones";
import { putObject } from "../storage";
import { visibleYacht } from "../domain/yachts";

const LOG_LIMIT = 2_000_000;

interface Entry {
  lineNo: number;
  atMs: number;
  day: string;
  chargePct: number;
  solarWh: number;
}

/** Parses a daily log; returns the entries or the field message for the first bad line. */
function parseLog(data: Buffer, base: Base): Entry[] | string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const lines = data.toString("latin1").split("\n");
  const entries: Entry[] = [];
  let offset = 0;
  for (const [index, latin] of lines.entries()) {
    const bytes = data.subarray(offset, offset + latin.length);
    offset += latin.length + 1;
    let text: string;
    try {
      text = decoder.decode(bytes).replace(/\r$/, "");
    } catch {
      return FIELD.logLine(index + 1);
    }
    if (text.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return FIELD.logLine(index + 1);
    }
    const record = value as Record<string, unknown>;
    const at = record?.at;
    const valid =
      value !== null && typeof value === "object" && !Array.isArray(value)
      && typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) && !Number.isNaN(Date.parse(at))
      && new Date(Date.parse(at)).toISOString().replace(".000Z", "Z") === at
      && typeof record.chargePct === "number" && record.chargePct >= 0 && record.chargePct <= 100
      && typeof record.solarWh === "number" && Number.isInteger(record.solarWh) && record.solarWh >= 0
      && typeof record.packKw === "number" && Number.isFinite(record.packKw);
    if (!valid) return FIELD.logLine(index + 1);
    const atMs = Date.parse(at as string);
    entries.push({ lineNo: index + 1, atMs, day: localDate(atMs, base), chargePct: record.chargePct as number, solarWh: record.solarWh as number });
  }
  return entries.length ? entries : FIELD.emptyLog;
}

interface LogRow {
  id: string;
  file_name: string;
  size_bytes: number;
  uploaded_at: Date;
  uploaded_by: string;
  object_key: string;
  day_count: number;
}

function logJson(l: LogRow): Json {
  return {
    id: l.id,
    fileName: l.file_name,
    sizeBytes: l.size_bytes,
    uploadedAt: isoInstant(l.uploaded_at.getTime()),
    uploadedBy: l.uploaded_by,
    objectKey: l.object_key,
    dayCount: l.day_count,
  };
}

route("POST", "/api/w/:ws/yachts/:slug/energy-logs", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow(["captain"]);
    const upload = await readUpload(ctx.req, "log", LOG_LIMIT);
    const fields = new Fields();
    const parsed = upload ? parseLog(upload.data, yacht.base) : FIELD.required;
    if (typeof parsed === "string") fields.fail("log", parsed);
    fields.check();
    const entries = parsed as Entry[];
    const id = randomUUID();
    const key = `energy-logs/${yacht.slug}/${id}.jsonl`;
    const log = await transaction(async (db) => {
      const days = new Set(entries.map((e) => e.day));
      const [row] = await rows<LogRow>(db,
        `INSERT INTO energy_logs (id, yacht_id, file_name, size_bytes, uploaded_at, uploaded_by, object_key, day_count)
         VALUES ($1,$2,$3,$4, now(), $5, $6, $7) RETURNING *`,
        [id, yacht.id, upload!.fileName || "log.jsonl", upload!.data.length, ctx.member.name, key, days.size]);
      await db.query(
        `INSERT INTO energy_entries (log_id, line_no, day, at, charge_pct, solar_wh)
         SELECT $1, * FROM unnest($2::int[], $3::date[], $4::timestamptz[], $5::numeric[], $6::bigint[])`,
        [id, entries.map((e) => e.lineNo), entries.map((e) => e.day), entries.map((e) => new Date(e.atMs)), entries.map((e) => e.chargePct),
          entries.map((e) => e.solarWh)],
      );
      await putObject(key, upload!.data, "application/x-ndjson");
      return row;
    });
    return { status: 201, body: { log: logJson(log) } };
  },
});

route("GET", "/api/w/:ws/yachts/:slug/energy-logs", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow(["captain"]);
    const logs = await rows<LogRow>(pool, "SELECT * FROM energy_logs WHERE yacht_id = $1 ORDER BY uploaded_at DESC, seq DESC", [yacht.id]);
    return { status: 200, body: { logs: logs.map(logJson) } };
  },
});

route("GET", "/api/w/:ws/yachts/:slug/energy-days", {
  staff: true,
  handle: async (ctx) => {
    const yacht = await visibleYacht(pool, ctx.member, ctx.params.slug);
    ctx.allow(["captain"]);
    // For each day, the latest upload that covers it decides it.
    const days = await rows<{ day: string; start: string; end: string; lowest: string; solar_wh: number }>(pool,
      `WITH latest AS (
         SELECT DISTINCT ON (e.day) e.day, e.log_id FROM energy_entries e JOIN energy_logs l ON l.id = e.log_id
          WHERE l.yacht_id = $1 ORDER BY e.day, l.seq DESC)
       SELECT d.day,
              (SELECT charge_pct FROM energy_entries WHERE log_id = d.log_id AND day = d.day ORDER BY at, line_no LIMIT 1) AS start,
              (SELECT charge_pct FROM energy_entries WHERE log_id = d.log_id AND day = d.day ORDER BY at DESC, line_no DESC LIMIT 1) AS end,
              (SELECT min(charge_pct) FROM energy_entries WHERE log_id = d.log_id AND day = d.day) AS lowest,
              (SELECT sum(solar_wh) FROM energy_entries WHERE log_id = d.log_id AND day = d.day)::bigint AS solar_wh
         FROM latest d ORDER BY d.day`,
      [yacht.id]);
    return {
      status: 200,
      body: {
        base: yacht.base,
        days: days.map((d) => ({
          date: d.day,
          startChargePct: Number(d.start),
          endChargePct: Number(d.end),
          lowestChargePct: Number(d.lowest),
          solarKwh: d.solar_wh / 1000,
        })),
      },
    };
  },
});
