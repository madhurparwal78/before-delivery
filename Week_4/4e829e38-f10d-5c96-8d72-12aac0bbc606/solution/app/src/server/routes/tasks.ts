import { personName, projectTeam, requireCoordinator, taskAccess } from "../access.js";
import { config } from "../config.js";
import { isoInstant, now, plus } from "../clock.js";
import { pool, transaction, lockProject, type Queryable } from "../db.js";
import { publish } from "../events.js";
import { ApiError, fields, invalid, readJson, route } from "../http.js";
import { NO_CONTENT } from "../state.js";
import { getTaskRow, listTasks, loadProject, parsePatch, taskJson } from "../tasks.js";
import { createTask, deleteTask, saveTask } from "../workflow.js";
import { randomUUID } from "node:crypto";
import { parseRule } from "../rules.js";

async function blocksOf(db: Queryable, projectId: string): Promise<Map<string, string[]>> {
  const { rows } = await db.query(
    "SELECT d.from_task, d.to_task FROM dependencies d JOIN tasks t ON t.id = d.from_task WHERE t.project_id = $1", [projectId]);
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.from_task, [...(map.get(r.from_task) ?? []), r.to_task]);
  return map;
}

route("GET", "/api/projects/:id/tasks", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const project = await loadProject(pool, ctx.params.id);
  const all = await listTasks(pool, project);
  const size = config.limits.pageSize;
  const page = Math.max(1, Math.floor(Number(ctx.url.searchParams.get("page"))) || 1);
  const [instant, blocks] = await Promise.all([now(pool), blocksOf(pool, project.id)]);
  return {
    tasks: all.slice((page - 1) * size, page * size).map((t) => ({ ...taskJson(t, project, instant), blocks: blocks.get(t.id) ?? [] })),
    page, pageSize: size, total: all.length,
  };
});

route("POST", "/api/projects/:id/tasks", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const patch = parsePatch(body, project, true);
  const row = await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const instant = await now(tx);
    const actor = { name: await personName(tx, ctx.personId) };
    return createTask(tx, project, {
      name: patch.name!, description: patch.description, sectionId: patch.sectionId ?? project.sections[0].id, parentId: patch.parentId,
      position: patch.position, assigneeId: patch.assigneeId, start: patch.start, due: patch.due, effort: patch.effort,
      recurrence: patch.recurrence, values: patch.values,
    }, actor, instant);
  });
  return { ...taskJson(row, project, await now(pool)), blocks: [] };
}, { status: 201 });

async function holdsOf(db: Queryable, taskId: string, instant: Date) {
  const { rows } = await db.query(
    "SELECT h.field, p.id, p.name, h.expires_at FROM holds h JOIN people p ON p.id = h.holder_id WHERE h.task_id = $1 AND h.expires_at > $2", [taskId, instant]);
  return rows.map((r) => ({ field: r.field as string, holder: { id: r.id as string, name: r.name as string }, expiresAt: isoInstant(r.expires_at) }));
}

async function viewersOf(db: Queryable, taskId: string, instant: Date) {
  const cutoff = plus(instant, -config.limits.holdTimeoutMs);
  const { rows } = await db.query(
    `SELECT p.id, p.name, min(pr.joined_at) AS joined FROM presence pr JOIN people p ON p.id = pr.person_id
       WHERE pr.task_id = $1 AND (pr.left_at IS NULL OR pr.left_at > $2) GROUP BY p.id, p.name ORDER BY joined, p.name`, [taskId, cutoff]);
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

async function latestApproval(db: Queryable, taskId: string) {
  const { rows } = await db.query("SELECT id, status, approver_id, requester_id FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1", [taskId]);
  return rows.length ? { id: rows[0].id, status: rows[0].status, approverId: rows[0].approver_id, requesterId: rows[0].requester_id }
    : { id: null, status: null, approverId: null, requesterId: null };
}

route("GET", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const project = await loadProject(pool, access.projectId);
  const task = await getTaskRow(pool, ctx.params.id);
  const instant = await now(pool);
  const [attachments, blocks, blockedBy, history, viewing, holds, approval] = await Promise.all([
    pool.query("SELECT id, name, size FROM attachments WHERE task_id = $1 ORDER BY created_at", [task.id]),
    pool.query("SELECT to_task FROM dependencies WHERE from_task = $1", [task.id]),
    pool.query("SELECT from_task FROM dependencies WHERE to_task = $1", [task.id]),
    pool.query("SELECT text, created_at FROM history WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100", [task.id]),
    viewersOf(pool, task.id, instant),
    holdsOf(pool, task.id, instant),
    latestApproval(pool, task.id),
  ]);
  return {
    ...taskJson(task, project, instant),
    attachments: attachments.rows,
    approval,
    blocks: blocks.rows.map((r) => r.to_task as string),
    blockedBy: blockedBy.rows.map((r) => r.from_task as string),
    history: history.rows.map((r) => ({ text: r.text as string, createdAt: isoInstant(r.created_at) })),
    viewing,
    holds,
  };
});

route("PATCH", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const project = await loadProject(pool, access.projectId);
  const result = await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const current = await getTaskRow(tx, ctx.params.id, true);
    const instant = await now(tx);
    const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (body) {
      const touched = ["name", "description"].filter((k) => k in body);
      if (touched.length) {
        const other = (await holdsOf(tx, current.id, instant)).find((h) => touched.includes(h.field) && h.holder.id !== ctx.personId);
        if (other) throw new ApiError(409, { error: "held_by_other", holder: other.holder.name });
      }
      if (typeof body.version === "number" && body.version !== current.version) {
        throw new ApiError(409, { error: "stale_task", latest: current.version });
      }
    }
    const given = fields(raw);
    if (typeof given.version !== "number") throw invalid({ version: "Send the version you are editing" });
    const { version: _version, ...rest } = given;
    const patch = parsePatch(rest, project, false);
    const saved = await saveTask(tx, project, current, patch, { name: await personName(tx, ctx.personId) }, instant);
    const released = ["name", "description"].filter((k) => k in rest);
    if (released.length) {
      await tx.query("DELETE FROM holds WHERE task_id = $1 AND holder_id = $2 AND field = ANY($3)", [saved.id, ctx.personId, released]);
      await publish(tx, { t: "hold", team: project.teamId, task: saved.id });
    }
    return { saved, instant };
  });
  const blocks = await blocksOf(pool, project.id);
  return { ...taskJson(result.saved, project, result.instant), blocks: blocks.get(result.saved.id) ?? [] };
});

route("DELETE", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  await readJson(ctx);
  const project = await loadProject(pool, access.projectId);
  await transaction(async (tx) => {
    await lockProject(tx, project.id);
    await deleteTask(tx, project, await getTaskRow(tx, ctx.params.id, true));
  });
  return NO_CONTENT;
});

/* ------------------------------------------------------------------ dependencies and holds */

route("POST", "/api/tasks/:id/dependencies", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const target = typeof body.blocks === "string" ? await pool.query("SELECT id FROM tasks WHERE id = $1 AND project_id = $2", [body.blocks, access.projectId]) : null;
  if (!target?.rows.length) throw invalid({ blocks: "Choose a task of this project" });
  await transaction(async (tx) => {
    await lockProject(tx, access.projectId);
    const loop = await tx.query(
      `WITH RECURSIVE reach(id) AS (SELECT $2::text UNION SELECT d.to_task FROM dependencies d JOIN reach r ON d.from_task = r.id)
       SELECT 1 FROM reach WHERE id = $1`, [ctx.params.id, body.blocks]);
    if (loop.rowCount) throw invalid({ blocks: "A task can't block itself or create a loop" });
    await tx.query("INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ctx.params.id, body.blocks]);
    await publish(tx, { t: "structure", team: access.teamId, project: access.projectId });
  });
  return { from: ctx.params.id, to: body.blocks };
}, { status: 201 });

const HOLD_FIELDS = ["name", "description"];

route("POST", "/api/tasks/:id/hold", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  return transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hold:${ctx.params.id}`]);
    const instant = await now(tx);
    const held = (await holdsOf(tx, ctx.params.id, instant)).find((h) => h.field === body.field && h.holder.id !== ctx.personId);
    if (held) throw new ApiError(409, { error: "held_by_other", holder: held.holder.name });
    if (typeof body.field !== "string" || !HOLD_FIELDS.includes(body.field)) throw invalid({ field: "Choose name or description" });
    const expires = plus(instant, config.limits.holdTimeoutMs);
    await tx.query(
      `INSERT INTO holds (task_id, field, holder_id, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, field) DO UPDATE SET holder_id = $3, expires_at = $4`, [ctx.params.id, body.field, ctx.personId, expires]);
    await publish(tx, { t: "hold", team: access.teamId, task: ctx.params.id });
    return { field: body.field, holder: { id: ctx.personId, name: await personName(tx, ctx.personId) }, expiresAt: expires.toISOString() };
  });
});

route("DELETE", "/api/tasks/:id/hold", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  await transaction(async (tx) => {
    await tx.query("DELETE FROM holds WHERE task_id = $1 AND holder_id = $2 AND field = $3", [ctx.params.id, ctx.personId, body.field]);
    await publish(tx, { t: "hold", team: access.teamId, task: ctx.params.id });
  });
  return NO_CONTENT;
});

route("GET", "/api/tasks/:id/rule-runs", async (ctx) => {
  await taskAccess(pool, ctx.personId, ctx.params.id);
  const { rows } = await pool.query("SELECT id, depth, summary, detail, created_at FROM rule_runs WHERE task_id = $1 ORDER BY id", [ctx.params.id]);
  return { runs: rows.map((r) => ({ id: String(r.id), depth: r.depth as number, summary: r.summary as string, detail: r.detail as string, createdAt: isoInstant(r.created_at) })) };
});

/* ------------------------------------------------------------------ rules */

route("GET", "/api/projects/:id/rules", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const { rows } = await pool.query("SELECT id, name, position, trigger, condition, action FROM rules WHERE project_id = $1 ORDER BY position, seq", [ctx.params.id]);
  return { rules: rows };
});

route("POST", "/api/projects/:id/rules", async (ctx) => {
  const { teamId, role } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const { name, trigger, condition, action } = parseRule(body, project);
  const id = randomUUID();
  const position = ((await pool.query("SELECT coalesce(max(position), 0)::int + 1 AS next FROM rules WHERE project_id = $1", [project.id])).rows[0]).next;
  await transaction(async (tx) => {
    await tx.query("INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, project.id, name, position, JSON.stringify(trigger), condition ? JSON.stringify(condition) : null, JSON.stringify(action), await now(tx)]);
    await publish(tx, { t: "rules", team: teamId, project: project.id });
  });
  return { id, name, position, trigger, condition, action };
}, { status: 201 });

