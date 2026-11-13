import type { Ctx, Reply } from "./context";
import { json, requireRole } from "./context";
import { isUniqueViolation, pool } from "./db";
import { Fields, conflict, forbidden, notFound } from "./errors";
import { nameKey } from "./seed";
import { asObject, checkText } from "./validate";
import { loadTable } from "./table";

export async function showTable(): Promise<Reply> {
  return json(200, await loadTable(pool));
}

export async function renameTeam(ctx: Ctx): Promise<Reply> {
  const id = Number(ctx.params[0]);
  const exists = /^\d+$/.test(ctx.params[0] ?? "") ? await pool.query("SELECT 1 FROM teams WHERE id = $1", [id]) : null;
  if (exists === null || exists.rowCount === 0) throw notFound();
  const session = requireRole(ctx, "captain");
  if (session.teamId !== id) throw forbidden();
  const name = checkText(asObject(ctx.body)["name"], "name");
  const fields = new Fields();
  if (!name.ok) fields.set("name", name.error);
  fields.assertEmpty();
  const text = (name as { text: string }).text;
  try {
    await pool.query("UPDATE teams SET name = $2, name_key = $3 WHERE id = $1", [id, text, nameKey(text)]);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("name_taken");
    throw error;
  }
  return json(200, { team: { id, name: text } });
}
