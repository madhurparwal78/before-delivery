import { recordAudit } from "./audit.js";
import { requireRole, requireUser } from "./auth.js";
import { lockKey, many, pool, tx } from "./db.js";
import { COPY, FieldErrors, refuse } from "./errors.js";
import { type EntryRow, ENTRY_SELECT, assetsOf, entryById, entryView, viewOf, visibleEntry } from "./entries.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { categoryById } from "./programs.js";
import { guardEntriesClosed, guardEntry } from "./rules.js";
import { text } from "./validate.js";

// Screening and reinstatement by the director (brief: API, Screening, rounds and publishing).

export async function listCategoryEntries(req: ApiRequest): Promise<ApiResult> {
  const user = await requireUser(req);
  const category = await categoryById(pool, req.params.id ?? "");
  if (!category) throw refuse("not_found");
  requireRole(user, "director");
  const rows = await many<EntryRow>(pool, `${ENTRY_SELECT} WHERE e.category_id = $1 AND e.state <> 'draft' ORDER BY e.entry_number`,
    [category.id]);
  const assets = await assetsOf(pool, rows.map((r) => r.id));
  const now = new Date();
  return { status: 200, json: { entries: rows.map((r) => entryView(r, assets, "director", now)) } };
}

export async function screenEntry(req: ApiRequest): Promise<ApiResult> {
  const entry = await tx(async (client) => {
    const user = await requireUser(req);
    const found = await visibleEntry(client, user, req.params.id ?? "");
    requireRole(user, "director");
    await lockKey(client, `entry:${found.id}`);
    const current = (await entryById(client, found.id)) as EntryRow;
    const decision = req.body.decision;
    guardEntry(current.state, decision === "pass" ? "pass" : "disqualify");
    guardEntriesClosed(current, new Date());
    const errors = new FieldErrors();
    errors.check(decision === "pass" || decision === "disqualify", "decision", "Choose pass or disqualify.");
    const reason = decision === "disqualify" ? text(req.body.reason, 1, 300) : null;
    if (decision === "disqualify") errors.check(reason !== null, "reason", COPY.reason);
    errors.throwIfAny();
    if (decision === "pass") {
      await client.query("UPDATE entries SET state = 'screened' WHERE id = $1", [current.id]);
      await recordAudit(client, "entry.pass", "entry", current.id, { entryNumber: current.entry_number });
    } else {
      await client.query("UPDATE entries SET state = 'disqualified', disqualify_reason = $2 WHERE id = $1", [current.id, reason]);
      await recordAudit(client, "entry.disqualify", "entry", current.id, { entryNumber: current.entry_number, reason });
    }
    return viewOf(client, (await entryById(client, current.id)) as EntryRow, "director");
  });
  return { status: 200, json: { entry } };
}

export async function reinstateEntry(req: ApiRequest): Promise<ApiResult> {
  const entry = await tx(async (client) => {
    const user = await requireUser(req);
    const found = await visibleEntry(client, user, req.params.id ?? "");
    requireRole(user, "director");
    await lockKey(client, `entry:${found.id}`);
    const current = (await entryById(client, found.id)) as EntryRow;
    guardEntry(current.state, "reinstate");
    guardEntriesClosed(current, new Date());
    await client.query("UPDATE entries SET state = 'screened', disqualify_reason = NULL WHERE id = $1", [current.id]);
    await recordAudit(client, "entry.reinstate", "entry", current.id, { entryNumber: current.entry_number });
    return viewOf(client, (await entryById(client, current.id)) as EntryRow, "director");
  });
  return { status: 200, json: { entry } };
}
