import { z } from "zod";
import type { IndexTableView } from "../../shared/api.js";
import { parseFactor } from "../../shared/rules.js";
import { isCalendarDate } from "../../shared/time.js";
import type { ClubAuth } from "../auth.js";
import { type Db, one, returning, rows, transaction } from "../db.js";
import { ApiError } from "../errors.js";
import { parse } from "../validate.js";

interface TableRow {
  id: number;
  effective_date: string;
  factors: Record<string, string>;
  created_at: Date;
  created_by: { id: number; name: string } | null;
}

export async function loadTables(db: Db, clubId: number): Promise<IndexTableView[]> {
  const found = await rows<TableRow>(
    db,
    `select t.id, t.effective_date, t.factors, t.created_at,
            case when u.id is null then null else jsonb_build_object('id', u.id, 'name', u.name) end as created_by
       from index_tables t left join users u on u.id = t.created_by
      where t.club_id = $1 order by t.effective_date`,
    [clubId],
  );
  return found.map(view);
}

function view(row: TableRow): IndexTableView {
  return {
    id: row.id,
    effectiveDate: row.effective_date,
    factors: row.factors,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

/** The factor text a stored table holds for a class every event of the club is known to use. */
export function factorText(factors: Record<string, string>, classCode: string): string {
  const factor = factors[classCode];
  if (factor === undefined) throw new Error(`the index table has no factor for class ${classCode}`);
  return factor;
}

/** The same factor as integer ten-thousandths. */
export function factorBasisPoints(factors: Record<string, string>, classCode: string): number {
  const basisPoints = parseFactor(factorText(factors, classCode));
  if (basisPoints === null) throw new Error(`the stored factor for class ${classCode} is invalid`);
  return basisPoints;
}

const factorsSchema = z
  .record(z.string(), z.string())
  .superRefine((factors, ctx) => {
    const entries = Object.entries(factors);
    if (entries.length === 0) ctx.addIssue({ code: "custom", message: "Give at least one class and factor." });
    for (const [code, factor] of entries) {
      if (!/^[A-Z0-9]{1,6}$/.test(code)) {
        ctx.addIssue({ code: "custom", message: `Class ${code} must be 1 to 6 uppercase letters or digits.` });
      } else if (parseFactor(factor) === null) {
        ctx.addIssue({ code: "custom", message: `Factor for ${code} must have four decimals from 0.4000 to 1.2000.` });
      }
    }
  });

const tableSchema = z.object({
  effectiveDate: z.string({ error: "Enter an effective date as YYYY-MM-DD." }).refine(isCalendarDate, "Enter an effective date as YYYY-MM-DD."),
  factors: factorsSchema,
});

/** Loading a table never edits an existing one; the 409s are judged before the factors are validated. */
export async function loadTable(auth: ClubAuth, body: unknown): Promise<IndexTableView> {
  const date = typeof body === "object" && body !== null && "effectiveDate" in body ? body.effectiveDate : undefined;
  return transaction(async (db) => {
    await db.query("select pg_advisory_xact_lock($1)", [auth.club.id]);
    if (typeof date === "string") {
      const taken = await one(db, "select 1 from index_tables where club_id = $1 and effective_date = $2", [auth.club.id, date]);
      if (taken) throw new ApiError("effective_date_taken", `A table already starts on ${date}.`);
      if (isCalendarDate(date)) {
        const timed = await one<{ date: string }>(
          db,
          `select e.date from events e
            where e.club_id = $1 and e.date >= $2
              and exists (select 1 from registrations r join runs ru on ru.registration_id = r.id
                           where r.event_id = e.id and ru.status in ('committed', 'corrected'))
            limit 1`,
          [auth.club.id, date],
        );
        if (timed) throw new ApiError("effective_date_conflict", `An event on or after ${date} already has timed runs.`);
      }
    }
    const input = parse(tableSchema, body);
    const missing = await missingClasses(db, auth.club.id, input.effectiveDate, Object.keys(input.factors));
    if (missing.length > 0) {
      throw new ApiError("classes_in_use", `Missing classes used by later events: ${missing.join(", ")}.`);
    }
    const created = await returning<{ id: number; created_at: Date }>(
      db,
      `insert into index_tables (club_id, effective_date, factors, created_by) values ($1, $2, $3, $4)
       returning id, created_at`,
      [auth.club.id, input.effectiveDate, input.factors, auth.userId],
    );
    return {
      id: created.id,
      effectiveDate: input.effectiveDate,
      factors: input.factors,
      createdAt: created.created_at.toISOString(),
      createdBy: { id: auth.userId, name: auth.name },
    };
  });
}

async function missingClasses(db: Db, clubId: number, effectiveDate: string, provided: string[]): Promise<string[]> {
  const used = await rows<{ class_code: string }>(
    db,
    `select distinct c.class_code from event_classes c join events e on e.id = c.event_id
      where e.club_id = $1 and e.date >= $2 order by c.class_code`,
    [clubId, effectiveDate],
  );
  return used.map((u) => u.class_code).filter((code) => !provided.includes(code));
}
