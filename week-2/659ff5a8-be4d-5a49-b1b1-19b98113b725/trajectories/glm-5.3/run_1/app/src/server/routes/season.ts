import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { errConflict, errNotFound, errValidation } from "../errors.js";
import { requireUser, requireRole } from "../session.js";
import { getEvent } from "../domain/repo.js";
import { loadEntries } from "../domain/standings.js";
import { seasonPoints, fmtFactor, decimal } from "../domain/times.js";
import { Decimal } from "decimal.js";
import { safeParse } from "./auth.js";
import { localParts } from "../time.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLASS_RE = /^[A-Z0-9]{1,6}$/;

export function registerSeasonRoutes(app: FastifyInstance, db: Db): void {
  // --- Index tables ---
  app.get("/api/index-tables", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const rows = await db.query(
      `SELECT t.*, u.name AS created_by_name FROM index_tables t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.club_id = $1 ORDER BY t.effective_date`,
      [user.clubId],
    );
    reply.send({
      tables: rows.map((r) => ({
        id: r.id as string,
        effectiveDate: String(r.effective_date),
        factors: mapFactors(r.factors as Record<string, string>),
        createdAt: new Date(r.created_at as string).toISOString(),
        createdBy: r.created_by ? { id: r.created_by as string, name: r.created_by_name as string } : null,
      })),
    });
  });

  app.post("/api/index-tables", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const schema = z.object({
      effectiveDate: z.string().regex(DATE_RE, "Use YYYY-MM-DD."),
      factors: z.record(z.string(), z.string()),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const fields: Record<string, string> = {};
    const entries = Object.entries(parsed.value.factors);
    if (entries.length === 0) fields.factors = "At least one class is needed.";
    for (const [cls, factor] of entries) {
      if (!CLASS_RE.test(cls)) fields[`factors.${cls}`] = "Class codes are 1 to 6 uppercase letters or digits.";
      const value = new Decimal(factor);
      if (!/^\d\.\d{4}$/.test(factor) || value.lt(new Decimal("0.4000")) || value.gt(new Decimal("1.2000"))) {
        fields[`factors.${cls}`] = "Factors run from 0.4000 to 1.2000.";
      }
    }
    if (Object.keys(fields).length > 0) throw errValidation(fields, "Fix these fields.");
    const clubId = user.clubId as string;

    const taken = await db.query(
      `SELECT id FROM index_tables WHERE club_id = $1 AND effective_date = $2`,
      [clubId, parsed.value.effectiveDate],
    );
    if (taken[0]) throw errConflict("effective_date_taken", `A table already starts on ${parsed.value.effectiveDate}.`);

    // Refuse if any event dated on or after the effective date already has timed runs.
    const runsExist = await db.query(
      `SELECT 1 FROM runs ru
       JOIN registrations r ON r.id = ru.registration_id
       JOIN events e ON e.id = r.event_id
       WHERE e.club_id = $1 AND e.date >= $2::date AND ru.status IN ('committed','corrected')
       LIMIT 1`,
      [clubId, parsed.value.effectiveDate],
    );
    if (runsExist[0]) {
      throw errConflict("effective_date_conflict", `An event on or after ${parsed.value.effectiveDate} already has timed runs.`);
    }

    // Refuse if a later event uses a class missing from the new table.
    const laterEvents = await db.query(
      `SELECT heat_classes FROM events WHERE club_id = $1 AND date >= $2::date`,
      [clubId, parsed.value.effectiveDate],
    );
    const missing = new Set<string>();
    for (const e of laterEvents) {
      for (const classes of Object.values(e.heat_classes as Record<string, string[]>)) {
        for (const cls of classes) {
          if (!(cls in parsed.value.factors)) missing.add(cls);
        }
      }
    }
    if (missing.size > 0) {
      throw errConflict("classes_in_use", `Missing classes used by later events: ${[...missing].sort().join(", ")}.`);
    }

    const id = newIdOp();
    await db.query(
      `INSERT INTO index_tables (id, club_id, effective_date, factors, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, clubId, parsed.value.effectiveDate, JSON.stringify(parsed.value.factors), user.id],
    );
    const row = (await db.query(
      `SELECT t.*, u.name AS created_by_name FROM index_tables t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
      [id],
    ))[0];
    reply.status(201).send({
      table: {
        id: row.id as string,
        effectiveDate: String(row.effective_date),
        factors: mapFactors(row.factors as Record<string, string>),
        createdAt: new Date(row.created_at as string).toISOString(),
        createdBy: { id: row.created_by as string, name: row.created_by_name as string },
      },
    });
  });

  // --- Season ---
  app.get("/api/season", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const query = request.query as { year?: string };
    const tz = await clubTimeZone(db, user.clubId);
    const year = query.year !== undefined ? Number(query.year) : localParts(new Date(), tz).y;
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw errValidation({ year: "Unknown year." });
    const rows = await seasonRows(db, user.clubId, year, tz);
    reply.send(rows);
  });

  app.get("/api/season.csv", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const query = request.query as { year?: string };
    const tz = await clubTimeZone(db, user.clubId);
    const year = query.year !== undefined ? Number(query.year) : localParts(new Date(), tz).y;
    if (!Number.isInteger(year) || year < 1000 || year > 9999) throw errValidation({ year: "Unknown year." });
    const data = await seasonRows(db, user.clubId, year, tz);
    const csv = seasonCsv(data.rows);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="season-standings-${year}.csv"`);
    reply.send(csv);
  });
}

function newIdOp(): string {
  return `idxt_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

function mapFactors(factors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, fmtFactor(v)]));
}

async function clubTimeZone(db: Db, clubId: string): Promise<string> {
  const rows = await db.query(`SELECT time_zone FROM clubs WHERE id = $1`, [clubId]);
  return rows[0]?.time_zone as string;
}

interface SeasonRow {
  position: number;
  driverId: string;
  driverName: string;
  carDescription: string;
  classCode: string;
  events: number;
  points: string;
}

async function seasonRows(db: Db, clubId: string, year: number, tz: string) {
  const events = await db.query(
    `SELECT e.id, e.name, e.date FROM events e WHERE e.club_id = $1 AND e.status = 'published' ORDER BY e.date`,
    [clubId],
  );
  const counted = events.filter((e) => {
    const date = new Date(e.date as string);
    return localYear(date, tz) === year;
  });
  const rows: SeasonRow[] = [];
  for (const e of counted) {
    const event = await getEvent(db, e.id as string, clubId);
    if (!event) continue;
    const entries = await loadEntries(db, event);
    const ranked = entries.filter((x) => x.bestIndexed !== null && x.checked_in);
    if (ranked.length === 0) continue;
    const fastest = ranked.reduce((min, x) => ((x.bestIndexed as string) < (min.bestIndexed as string) ? x : min)).bestIndexed as string;
    for (const entry of entries) {
      if (!entry.checked_in) continue;
      let row = rows.find((r) => r.driverId === entry.driver_id);
      if (!row) {
        row = {
          position: 0, driverId: entry.driver_id, driverName: entry.driverName,
          carDescription: entry.carDescription, classCode: entry.classCode,
          events: 0, points: "0.000",
        };
        rows.push(row);
      }
      row.events += 1;
      const points = entry.bestIndexed !== null ? seasonPoints(fastest, entry.bestIndexed) : "0.000";
      row.points = new Decimal(row.points).plus(new Decimal(points)).toFixed(3, Decimal.ROUND_HALF_UP);
      // Car and class come from the latest-dated counted registration.
      row.carDescription = entry.carDescription;
      row.classCode = entry.classCode;
    }
  }
  rows.sort((a, b) => {
    if (a.points !== b.points) return new Decimal(b.points).cmp(new Decimal(a.points));
    return a.driverName < b.driverName ? -1 : a.driverName > b.driverName ? 1 : 0;
  });
  rows.forEach((r, i) => (r.position = i + 1));
  return {
    year,
    events: counted.map((e) => ({ id: e.id, name: e.name, date: String(e.date) })),
    rows,
  };
}

function localYear(date: Date, tz: string): number {
  return localParts(date, tz).y;
}

/** CSV neutralisation: cells starting with =, +, - or @ gain a leading apostrophe. */
export function neutraliseCell(value: string): string {
  if (value.startsWith("=") || value.startsWith("+") || value.startsWith("-") || value.startsWith("@")) {
    return `'${value}`;
  }
  return value;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function seasonCsv(rows: SeasonRow[]): string {
  const lines = ["Position,Driver,Car,Class,Events,Points"];
  for (const r of rows) {
    const cells = [String(r.position), r.driverName, r.carDescription, r.classCode, String(r.events), r.points];
    lines.push(cells.map((c) => csvField(neutraliseCell(c))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

void decimal;
