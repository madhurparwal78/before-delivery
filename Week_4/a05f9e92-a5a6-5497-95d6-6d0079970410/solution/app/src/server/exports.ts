import { fieldsOf, labelOf } from "../shared/fields.js";
import type { SessionUser, Table } from "../shared/types.js";
import { settings } from "./config.js";
import { csvText } from "./csv.js";
import { query, transaction } from "./db.js";
import { Env } from "./env.js";
import { fail, notFound, storageUnavailable, validation } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish } from "./live.js";
import { matching, unknownField } from "./lists.js";
import { getObject, isAvailable, putObject, StorageDown } from "./storage.js";

export interface ExportJson {
  id: number;
  status: "queued" | "running" | "storing" | "complete" | "failed";
  rows_total: number;
  rows_done: number;
  error: "storage_unavailable" | null;
  key: string | null;
}

function jsonOf(row: Record<string, unknown>): ExportJson {
  return {
    id: row.id as number,
    status: row.status as ExportJson["status"],
    rows_total: row.rows_total as number,
    rows_done: row.rows_done as number,
    error: (row.error as ExportJson["error"]) ?? null,
    key: (row.key as string | null) ?? null,
  };
}

export function requireTable(value: unknown): Table {
  if (value !== "incident" && value !== "problem" && value !== "change" && value !== "request_item" && value !== "task") return validation("Unknown table.", { table: "Choose a table." });
  return value;
}

export async function createExport(env: Env, body: { table: Table; filter?: string; columns?: string[] }): Promise<ExportJson> {
  const names = fieldsOf(body.table).map((f) => f.name);
  const columns = body.columns && body.columns.length > 0 ? body.columns : ["number", "short_description", "priority", "state", "assigned_to"].filter((c) => names.includes(c));
  for (const c of columns) if (!names.includes(c)) unknownField(c);
  await matching(env, body.table, { filter: body.filter ?? "" });
  const rows = await env.tx.query("INSERT INTO exports (owner, table_name, filter, columns, status) VALUES ($1, $2, $3, $4, 'queued') RETURNING *", [
    env.user.username,
    body.table,
    body.filter ?? "",
    JSON.stringify(columns),
  ]);
  const created = jsonOf(rows[0]!);
  env.tx.after.push(() => void runExport(created.id));
  return created;
}

export async function loadExport(env: Env, id: number): Promise<ExportJson> {
  const rows = await env.tx.query("SELECT * FROM exports WHERE id = $1", [id]);
  const row = rows[0];
  if (!row || (row.owner !== env.user.username && !env.user.roles.includes("operator"))) return notFound();
  return jsonOf(row);
}

async function setProgress(id: number, patch: Record<string, string | number | null>): Promise<void> {
  const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`);
  await query(`UPDATE exports SET ${sets.join(", ")} WHERE id = $1`, [id, ...Object.values(patch)]);
  publish(`export:${id}`, "progress", {});
}

/** Counts rows in batches, then stores the file; the job is complete only after storage accepted the object. */
async function runExport(id: number): Promise<void> {
  const row = (await query("SELECT * FROM exports WHERE id = $1", [id]))[0];
  if (!row) return;
  try {
    await setProgress(id, { status: "running", rows_done: 0, error: null });
    const owner = (await query("SELECT p.username, p.display_name, p.department, u.roles, u.time_zone FROM people p JOIN users u ON u.username = p.username WHERE p.username = $1", [row.owner]))[0];
    if (!owner) return;
    const user: SessionUser = {
      username: owner.username as string,
      display_name: owner.display_name as string,
      roles: owner.roles as SessionUser["roles"],
      department: owner.department as string,
      time_zone: owner.time_zone as string,
    };
    const table = row.table_name as Table;
    const columns = row.columns as string[];
    const lines = await transaction(async (tx) => {
      const env = await Env.create(tx, { user, actor: user.username, actingFor: null });
      const { visible } = await matching(env, table, { filter: row.filter as string });
      const access = await env.access();
      const allowed = columns.filter((c) => access.readableForTable(table, c));
      await setProgress(id, { rows_total: visible.length });
      const out: unknown[][] = [allowed.map((c) => labelOf(table, c))];
      for (const [index, v] of visible.entries()) {
        out.push(allowed.map((c) => (c === "number" ? v.rec.number : (v.fields[c] ?? null))));
        if ((index + 1) % settings.EXPORT_BATCH_ROWS === 0) await setProgress(id, { rows_done: index + 1 });
      }
      return out;
    });
    await setProgress(id, { status: "storing", rows_done: lines.length - 1 });
    if (!isAvailable()) throw new StorageDown("storage unavailable");
    const key = `exports/${id}.csv`;
    await putObject(key, csvText(lines), "text/csv");
    await setProgress(id, { status: "complete", key });
    await transaction(async (tx) => {
      await deliver(tx, "export_finished", [row.owner as string], `Export ${id} is ready.`);
    });
  } catch (error) {
    if (error instanceof StorageDown) await setProgress(id, { status: "failed", error: "storage_unavailable" });
    else {
      await setProgress(id, { status: "failed", error: null });
      process.stderr.write(`export ${id} failed: ${String(error)}\n`);
    }
  }
}

export async function retryExport(env: Env, id: number): Promise<ExportJson> {
  const json = await loadExport(env, id);
  if (json.status !== "failed") fail(409, "not_failed", "Only a failed export can be retried.");
  if (!isAvailable()) return storageUnavailable();
  await env.tx.query("UPDATE exports SET status = 'queued', error = NULL WHERE id = $1", [id]);
  env.tx.after.push(() => void runExport(id));
  return { ...json, status: "queued", error: null };
}

export async function exportFile(env: Env, id: number): Promise<Buffer> {
  const json = await loadExport(env, id);
  if (json.status !== "complete" || !json.key) fail(409, "not_complete", "This export is not complete yet.");
  if (!isAvailable()) return storageUnavailable();
  try {
    return await getObject(json.key);
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
}

/** Failed exports whose error was an outage are retried from the start when storage returns. */
export async function retryOutageFailures(): Promise<void> {
  const rows = await query("SELECT id FROM exports WHERE status = 'failed' AND error = 'storage_unavailable' ORDER BY id");
  for (const row of rows) {
    await query("UPDATE exports SET status = 'queued', error = NULL WHERE id = $1", [row.id]);
    void runExport(row.id as number);
  }
}
