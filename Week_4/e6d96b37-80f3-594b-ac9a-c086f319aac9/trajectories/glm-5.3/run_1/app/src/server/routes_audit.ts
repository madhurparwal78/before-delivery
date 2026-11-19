import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { cellExists, errors, nextEvent, replayLookup, replayStore, runCommand } from "./domain.js";
import { broadcastLater, guarded, num, parseJsonBody, requireDealer, str } from "./routes_util.js";

interface AuditMarkRequest {
  command_id: string;
  expectedVersion: number;
  cell: string;
  mark: "missing";
}

export function auditRouter(env: FlanEnv): Router {
  const router = Router();

  async function applyMark(tx: Parameters<Parameters<typeof runCommand>[0]>[0], ns: string, command: AuditMarkRequest, actor: "dealer"): Promise<{ status: number; body: unknown }> {
    const payload = { command_id: command.command_id, expected_version: command.expectedVersion, cell: command.cell, mark: command.mark };
    const replayed = await replayLookup(tx, ns, command.command_id, payload);
    if (replayed) return { status: replayed.status, body: replayed.body };
    if (!cellExists(command.cell)) throw errors.invalid({ cell: copyFor("F_CELL_EMPTY") });
    const cell = await tx.query<{ specimen: string | null; audit_version: number }>(
      "SELECT specimen, audit_version FROM tray_cells WHERE ns = $1 AND cell = $2",
      [ns, command.cell],
    );
    const row = cell.rows[0];
    if (!row || row.specimen === null) throw errors.invalid({ cell: copyFor("F_CELL_EMPTY") });
    if (command.expectedVersion !== row.audit_version) throw errors.stale();
    await tx.query(
      "UPDATE tray_cells SET audit_mark = 'missing', audit_version = audit_version + 1 WHERE ns = $1 AND cell = $2",
      [ns, command.cell],
    );
    await tx.query("UPDATE specimens SET missing = TRUE, status = 'missing' WHERE ns = $1 AND key = $2", [ns, row.specimen]);
    await tx.query(
      "INSERT INTO audit_marks (ns, cell, command_id, actor, mark, at) VALUES ($1, $2, $3, $4, 'missing', now())",
      [ns, command.cell, command.command_id, actor],
    );
    const event = await nextEvent(tx, ns, command.command_id, actor, "audit.marked");
    const body = {
      cell: {
        cell: command.cell,
        specimen: row.specimen,
        audit_mark: "missing" as const,
        audit_version: row.audit_version + 1,
      },
    };
    await replayStore(tx, ns, command.command_id, payload, 200, body);
    broadcastLater(ns, event);
    return { status: 200, body };
  }

  router.post("/desks/:ns/audit/marks", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commandId = str(raw.command_id);
      if (!commandId) throw errors.invalid({});
      const expectedVersion = num(raw.expected_version);
      if (expectedVersion === undefined) throw errors.stale();
      const cell = str(raw.cell) ?? "";
      const mark = str(raw.mark);
      if (mark !== "missing") throw errors.invalid({ cell: copyFor("F_CELL_EMPTY") });
      const command: AuditMarkRequest = { command_id: commandId, expectedVersion, cell, mark: "missing" };
      return runCommand((tx) => applyMark(tx, ns, command, "dealer"));
    });
  });

  router.post("/desks/:ns/audit/sync", async (req, res) => {
    await guarded(res, async () => {
      const session = await requireDealer(req);
      const ns = req.params.ns;
      if (session.namespace !== ns) throw errors.hidden();
      const raw = parseJsonBody(req.body);
      const commands = Array.isArray(raw.commands) ? raw.commands : [];
      if (commands.length > env.FLAN_SYNC_BATCH_MAX) {
        throw errors.invalid({ commands: copyFor("F_SYNC_LIMIT", { max: env.FLAN_SYNC_BATCH_MAX }) });
      }
      const results: { command_id: string; status: number; body: unknown }[] = [];
      for (const item of commands) {
        const entry = item as Record<string, unknown>;
        const commandId = str(entry.command_id);
        const expectedVersion = num(entry.expected_version);
        const cell = str(entry.cell) ?? "";
        const mark = str(entry.mark);
        if (!commandId || expectedVersion === undefined || mark !== "missing") {
          results.push({ command_id: commandId ?? "", status: 422, body: { error: "invalid", message: copyFor("F_INVALID"), fields: { cell: copyFor("F_CELL_EMPTY") } } });
          continue;
        }
        const command: AuditMarkRequest = { command_id: commandId, expectedVersion, cell, mark: "missing" };
        try {
          const outcome = await runCommand((tx) => applyMark(tx, ns, command, "dealer"));
          results.push({ command_id: commandId, status: outcome.status, body: outcome.body });
        } catch (err) {
          results.push({
            command_id: commandId,
            status: err instanceof Error && "failure" in err ? (err as unknown as { failure: { status: number; body: unknown } }).failure.status : 503,
            body: err instanceof Error && "failure" in err ? (err as unknown as { failure: { body: unknown } }).failure.body : { error: "service_unavailable", message: copyFor("F_SERVICE") },
          });
        }
      }
      return { status: 200, body: { results } };
    });
  });

  return router;
}
