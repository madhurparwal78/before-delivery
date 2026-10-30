// The conflict tray: a member's own open conflicts and rejected cell edits, re-apply and keep current.
import { qualifiedCell } from "../../shared/refs.js";
import { tx } from "../db.js";
import { ApiError, invalid, notFound } from "../errors.js";
import { jsonBody, member } from "../http.js";
import { seasonRoleSheet } from "../rules/edits.js";
import { type Services } from "../services/index.js";
import { appendOps, recordHead } from "../sync.js";
import { derive, isUuid, stationClock, stationWorkbook } from "../workbook.js";

interface ConflictRow {
  id: string;
  kind: "conflict" | "rejected";
  sheet_id: string;
  sheet_name: string;
  cell: string;
  my_input: string;
  current_input: string;
  current_author_id: string | null;
  current_author_name: string | null;
  reason: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

const REASON_STATUS = { season_locked: 409, season_archived: 409, role_cannot_edit: 403, sheet_missing: 409 } as const;

export function conflictRoutes(svc: Services): void {
  member("GET", "/api/workbooks/:id/conflicts", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    const derived = await derive(svc.db, row, stationClock(me.timeZone));
    const r = await svc.db.query<ConflictRow>(
      "SELECT * FROM conflicts WHERE workbook_id = $1 AND member_id = $2 AND resolved_at IS NULL ORDER BY created_at, id",
      [row.id, me.id],
    );
    const conflicts = r.rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      ref: qualifiedCell(derived.engine.sheetById(c.sheet_id)?.name ?? c.sheet_name, c.cell),
      sheetId: c.sheet_id,
      cell: c.cell,
      myInput: c.my_input,
      currentInput: c.current_input,
      currentAuthor: c.current_author_id ? { id: c.current_author_id, name: c.current_author_name } : null,
      reason: c.kind === "rejected" ? c.reason : null,
      createdAt: c.created_at.toISOString(),
    }));
    return { status: 200, json: { conflicts } };
  });

  member("POST", "/api/workbooks/:id/conflicts/:conflictId/resolve", async ({ req, member: me }) => {
    const workbook = await stationWorkbook(svc.db, me.stationId, req.params.id);
    const conflictId = req.params.conflictId;
    if (!isUuid(conflictId)) throw notFound();
    const body = jsonBody(req);
    return tx(svc.db, async (t) => {
      const row = await stationWorkbook(t, me.stationId, workbook.id, true);
      const found = await t.query<ConflictRow>("SELECT * FROM conflicts WHERE id = $1 AND workbook_id = $2 AND member_id = $3 FOR UPDATE", [
        conflictId,
        row.id,
        me.id,
      ]);
      const conflict = found.rows[0];
      if (!conflict) throw notFound();
      if (conflict.resolved_at) throw new ApiError(409, "conflict_resolved", "That conflict was already resolved.");
      const choice = body.choice;
      if (choice !== "reapply" && choice !== "keep_current") throw invalid({ choice: "Pick reapply or keep_current." });
      let result: { status: "applied"; seq: number } | null = null;
      if (choice === "reapply") {
        const derived = await derive(t, row, stationClock(me.timeZone));
        const op = { opId: conflict.id, type: "setCell" as const, sheetId: conflict.sheet_id, cell: conflict.cell, input: conflict.my_input };
        const blocked = seasonRoleSheet(row, me.role, op, derived, new Date());
        if (blocked) throw new ApiError(REASON_STATUS[blocked], blocked, `Can't re-apply: ${blocked}.`);
        const seq = derived.headSeq + 1;
        derived.apply(op, seq, { id: me.id, name: me.name });
        await appendOps(t, row.id, [{ seq, op }], { id: me.id, name: me.name });
        await recordHead(t, row.id, derived);
        result = { status: "applied", seq };
      }
      await t.query("UPDATE conflicts SET resolved_at = clock_timestamp(), choice = $2 WHERE id = $1", [conflict.id, choice]);
      return { status: 200, json: { resolved: { id: conflict.id, choice }, result } };
    });
  });
}
