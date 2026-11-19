import { isDate } from "../../shared/time.js";
import { planner, requireWritable } from "../auth.js";
import { sql } from "../db.js";
import { HttpError, json, route } from "../http.js";
import { parseCalendar, parseCsv } from "./parse.js";

const MAX_ROWS = 2000;

/** Rows match cards on the pair (source, external id), never across members. */
const matchKey = (source: string, externalId: string) => JSON.stringify([source, externalId]);

type Row = { line: number; key: string; source: string; externalId: string; title: string; estimate: number | null; dueDate: string | null };
type Existing = { id: string; source: string; external_id: string; title: string; estimate_minutes: number | null; due_date: string | null };

/** Reads the CSV into valid rows and rejections (Business rules › Task import). */
function readTaskExport(text: string): { rows: Row[]; rejected: { line: number; reason: string }[] } {
  const records = parseCsv(text);
  const header = (records[0]?.cells ?? []).map((h) => h.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const idCol = column("external_id");
  const titleCol = column("title");
  if (idCol < 0 || titleCol < 0) {
    throw new HttpError(422, "not_a_task_export", "That file isn't a task export with external_id and title columns.");
  }
  const data = records.slice(1);
  if (data.length > MAX_ROWS) throw new HttpError(422, "too_many_rows", "That file has more than 2,000 rows.");
  const estimateCol = column("estimate_minutes");
  const dueCol = column("due_date");
  const sourceCol = column("source");
  const rows: Row[] = [];
  const rejected: { line: number; reason: string }[] = [];
  for (const record of data) {
    const cell = (index: number) => (index >= 0 ? (record.cells[index] ?? "").trim() : "");
    const externalId = cell(idCol);
    const title = cell(titleCol);
    const rawEstimate = cell(estimateCol);
    const dueDate = cell(dueCol);
    const source = cell(sourceCol) || "csv";
    const estimate = rawEstimate === "" ? null : Number(rawEstimate);
    let reason: string | null = null;
    if (!externalId) reason = "missing external_id";
    else if (!title) reason = "missing title";
    else if (title.length > 200) reason = "title longer than 200 characters";
    else if (estimate !== null && !(Number.isInteger(estimate) && estimate >= 5 && estimate <= 600 && estimate % 5 === 0)) reason = "invalid estimate_minutes";
    else if (dueDate && !isDate(dueDate)) reason = "invalid due_date";
    if (reason) rejected.push({ line: record.line, reason });
    else rows.push({ line: record.line, key: matchKey(source, externalId), source, externalId, title, estimate, dueDate: dueDate || null });
  }
  return { rows, rejected };
}

route(
  "POST",
  "/api/imports/tasks",
  async (ctx) => {
    const who = await planner(ctx);
    requireWritable(who.workspace);
    const { member } = who;
    const { rows, rejected } = readTaskExport(ctx.raw.toString("utf8"));
    // Import matching: last row per (source, external id) wins; earlier ones are merged.
    const winners = new Map<string, Row>();
    for (const row of rows) winners.set(row.key, row);
    const merged = rows.length - winners.size;
    const result = await sql.begin(async (tx) => {
      await tx`SELECT id FROM members WHERE id = ${member.id} FOR UPDATE`;
      const sources = [...new Set(rows.map((r) => r.source))];
      const existing = await tx<Existing[]>`
        SELECT id, source, external_id, title, estimate_minutes, to_char(due_date, 'YYYY-MM-DD') AS due_date
        FROM tasks WHERE member_id = ${member.id} AND external_id IS NOT NULL AND source = ANY(${sources})`;
      const byKey = new Map(existing.map((t) => [matchKey(t.source, t.external_id), t]));
      let updated = 0;
      let unchanged = 0;
      const fresh: Row[] = [];
      for (const row of winners.values()) {
        const card = byKey.get(row.key);
        if (!card) {
          fresh.push(row);
          continue;
        }
        const estimate = card.estimate_minutes ?? row.estimate;
        if (card.title === row.title && card.due_date === row.dueDate && card.estimate_minutes === estimate) {
          unchanged++;
          continue;
        }
        updated++;
        await tx`UPDATE tasks SET title = ${row.title}, due_date = ${row.dueDate}::date, estimate_minutes = ${estimate},
                   version = version + 1, updated_at = clock_timestamp()
                 WHERE id = ${card.id}`;
      }
      if (fresh.length) {
        const [{ next }] = await tx<{ next: number }[]>`
          SELECT coalesce(max(position) + 1, 0) AS next FROM tasks WHERE member_id = ${member.id} AND day_date IS NULL`;
        await tx`
          INSERT INTO tasks ${tx(
            fresh.map((r, i) => ({
              member_id: member.id,
              title: r.title,
              estimate_minutes: r.estimate,
              due_date: r.dueDate,
              source: r.source,
              external_id: r.externalId,
              position: next + i,
            })),
          )}`;
      }
      const keys = new Set(winners.keys());
      const orphaned = existing
        .filter((t) => !keys.has(matchKey(t.source, t.external_id)))
        .map((t) => t.id);
      const orphans = orphaned.length
        ? await tx<{ externalId: string; title: string }[]>`
            SELECT external_id AS "externalId", title FROM tasks
            WHERE id = ANY(${orphaned}::uuid[]) AND status = 'open' ORDER BY external_id`
        : [];
      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (member_id, workspace_id, kind) VALUES (${member.id}, ${member.workspace_id}, 'tasks') RETURNING id`;
      return { batchId: batch.id, created: fresh.length, updated, unchanged, merged, rejected, orphaned: orphans };
    });
    return json(200, result);
  },
  "csv",
);

route(
  "POST",
  "/api/imports/calendar",
  async (ctx) => {
    const who = await planner(ctx);
    requireWritable(who.workspace);
    const parsed = parseCalendar(ctx.raw.toString("utf8"));
    if (!parsed) throw new HttpError(422, "not_a_calendar", "That file isn't an iCalendar file.");
    const result = await sql.begin(async (tx) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const latest = new Map(parsed.events.map((e) => [e.uid, e]));
      for (const event of latest.values()) {
        const [previous] = await tx<{ summary: string; starts_at: Date; ends_at: Date }[]>`
          SELECT summary, starts_at, ends_at FROM meetings WHERE member_id = ${who.member.id} AND uid = ${event.uid} FOR UPDATE`;
        await tx`
          INSERT INTO meetings (member_id, uid, summary, starts_at, ends_at)
          VALUES (${who.member.id}, ${event.uid}, ${event.summary}, ${new Date(event.start)}, ${new Date(event.end)})
          ON CONFLICT (member_id, uid) DO UPDATE SET summary = EXCLUDED.summary, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`;
        const row = {
          inserted: !previous,
          changed:
            !!previous &&
            (previous.summary !== event.summary || previous.starts_at.getTime() !== event.start || previous.ends_at.getTime() !== event.end),
        };
        if (row.inserted) created++;
        else if (row.changed) updated++;
        else unchanged++;
      }
      const [batch] = await tx<{ id: string }[]>`
        INSERT INTO import_batches (member_id, workspace_id, kind) VALUES (${who.member.id}, ${who.member.workspace_id}, 'calendar') RETURNING id`;
      return { batchId: batch.id, created, updated, unchanged, skipped: parsed.skipped + parsed.events.length - latest.size };
    });
    return json(200, result);
  },
  "calendar",
);
