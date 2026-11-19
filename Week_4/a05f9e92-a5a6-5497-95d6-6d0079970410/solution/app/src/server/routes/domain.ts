import { addRelationship, ciByName, ciList, createCi, removeRelationship, scheduleMaintenance, serviceMap, setStatus, updateCi } from "../cis.js";
import { approvalsFor, boardAgenda, calendarDays, castVote, closeStep, computeRisk, stepsOf, type Board } from "../changes.js";
import { Env } from "../env.js";
import { fail, notFound, validation } from "../errors.js";
import { decideItemApproval } from "../workflows.js";
import { numberParam, reply, requireOperator, requireRole, route, withEnv } from "../http.js";
import { acknowledge, listPages, loadRotation, onCallAt, shiftsBetween, startPage, validateRotation, type PolicyLevel, type Rotation } from "../oncall.js";
import { findRecord, recordView } from "../records.js";
import { attachmentsOf } from "../files.js";
import { linkChildren, linkIncidents, listProposals, majorView, promote, publishWorkaround, reject, timeline, unlinkChild, impactJson } from "../major.js";
import { isoWithOffset } from "../../shared/tz.js";
import { isValidZone } from "../../shared/tz.js";
import type { RecordObj } from "../world.js";

async function visible(env: Env, number: string): Promise<RecordObj> {
  const rec = await findRecord(env.tx, number);
  if (!rec || !(await env.access()).canRead(rec)) return notFound();
  return rec;
}

async function present(env: Env, rec: RecordObj): Promise<Record<string, unknown>> {
  return { ...(await recordView(env, rec)), attachments: await attachmentsOf(env.tx, rec.number) };
}

const deskAndManagers = ["operator", "technician", "manager"] as const;
const deskAndApprovers = ["operator", "technician", "approver"] as const;

route("GET", "/api/cis", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    return reply(200, { cis: await ciList(env) });
  }),
);

route("GET", "/api/cis/:name", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    return reply(200, { ci: await ciByName(env, ctx.params.name!) });
  }),
);

route("POST", "/api/cis", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { ci: await createCi(env, ctx.json()) });
  }),
);

route("PATCH", "/api/cis/:name", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { ci: await updateCi(env, ctx.params.name!, ctx.json()) });
  }),
);

route("POST", "/api/relationships", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { relationship: await addRelationship(env, ctx.json()) });
  }),
);

route("DELETE", "/api/relationships", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    await removeRelationship(env, ctx.json());
    return reply(204);
  }),
);

route("GET", "/api/service-map", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    return reply(200, await serviceMap(env));
  }),
);

route("POST", "/api/cis/:name/status", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(200, await setStatus(env, ctx.params.name!, ctx.json<{ status?: unknown }>().status));
  }),
);

route("POST", "/api/cis/:name/maintenance", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { window: await scheduleMaintenance(env, ctx.params.name!, ctx.json()) });
  }),
);

route("GET", "/api/cis/:name/impact", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    if (!env.world.cis.has(ctx.params.name!)) return notFound();
    return reply(200, await impactJson(env, ctx.params.name!));
  }),
);

route("GET", "/api/major-proposals", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    return reply(200, { proposals: await listProposals(env) });
  }),
);

route("POST", "/api/major-proposals/:id/promote", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { record: await present(env, await promote(env, numberParam(ctx, "id"))) });
  }),
);

route("POST", "/api/major-proposals/:id/reject", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    const reason = ctx.json<{ reason?: unknown }>().reason;
    return reply(200, { proposal: await reject(env, numberParam(ctx, "id"), typeof reason === "string" ? reason : "") });
  }),
);

route("POST", "/api/records/:number/children", async (ctx) =>
  withEnv(ctx, async (env) => {
    const parent = await visible(env, ctx.params.number!);
    requireRole(env, ["operator", "technician"]);
    const numbers = ctx.json<{ numbers?: string[] }>().numbers;
    if (!Array.isArray(numbers) || numbers.length === 0) return validation("Name the incidents to link.", { numbers: "Add at least one incident." });
    await linkChildren(env, parent.number, numbers);
    return reply(200, { record: await present(env, (await findRecord(env.tx, parent.number))!) });
  }),
);

route("DELETE", "/api/records/:number/children/:child", async (ctx) =>
  withEnv(ctx, async (env) => {
    const parent = await visible(env, ctx.params.number!);
    requireRole(env, ["operator", "technician"]);
    await unlinkChild(env, parent.number, ctx.params.child!);
    return reply(200, { record: await present(env, (await findRecord(env.tx, parent.number))!) });
  }),
);

route("GET", "/api/records/:number/timeline", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    return reply(200, { entries: await timeline(env, rec.number) });
  }),
);

route("GET", "/api/major/:number", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndManagers]);
    const rec = await visible(env, ctx.params.number!);
    if (rec.table !== "incident" || rec.fields.is_major !== true) return notFound();
    const view = await majorView(env, rec);
    return reply(200, { record: await present(env, rec), impact: view.impact, children: view.children, timeline: view.timeline });
  }),
);

route("POST", "/api/records/:problem/incidents", async (ctx) =>
  withEnv(ctx, async (env) => {
    const problem = await visible(env, ctx.params.problem!);
    requireRole(env, ["operator", "technician"]);
    const numbers = ctx.json<{ numbers?: string[] }>().numbers;
    if (problem.table !== "problem" || !Array.isArray(numbers)) return validation("Name a problem and the incidents to link.", { numbers: "Add incidents." });
    await linkIncidents(env, problem.number, numbers);
    return reply(200, { record: await present(env, (await findRecord(env.tx, problem.number))!) });
  }),
);

route("POST", "/api/records/:problem/workaround", async (ctx) =>
  withEnv(ctx, async (env) => {
    const problem = await visible(env, ctx.params.problem!);
    requireRole(env, ["operator", "technician"]);
    const text = ctx.json<{ text?: unknown }>().text;
    await publishWorkaround(env, problem.number, typeof text === "string" ? text : "");
    return reply(200, { record: await present(env, (await findRecord(env.tx, problem.number))!) });
  }),
);

async function changeOf(env: Env, number: string): Promise<RecordObj> {
  const rec = await visible(env, number);
  return rec.table === "change" ? rec : notFound();
}

route("GET", "/api/records/:number/risk", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await changeOf(env, ctx.params.number!);
    requireRole(env, [...deskAndApprovers]);
    const risk = await computeRisk(env, rec.number, rec.fields);
    if (!risk) return validation("A risk score needs the item and the planned window.", { configuration_item: "Set the item and the planned window." });
    return reply(200, risk);
  }),
);

route("GET", "/api/records/:number/approvals", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await changeOf(env, ctx.params.number!);
    requireRole(env, [...deskAndApprovers]);
    return reply(200, { steps: await stepsOf(env.tx, rec.number) });
  }),
);

route("POST", "/api/records/:number/steps/:step/votes", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await changeOf(env, ctx.params.number!);
    const body = ctx.json<{ decision?: unknown; on_behalf_of?: string | null }>();
    if (body.decision !== "approve" && body.decision !== "reject") return validation("Vote approve or reject.", { decision: "Choose approve or reject." });
    return reply(201, await castVote(env, rec.number, numberParam(ctx, "step"), body.decision, body.on_behalf_of ?? null));
  }),
);

route("POST", "/api/records/:number/steps/:step/close", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await changeOf(env, ctx.params.number!);
    requireOperator(env);
    return reply(200, { step: await closeStep(env, rec.number, numberParam(ctx, "step")) });
  }),
);

route("GET", "/api/changes/calendar", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndApprovers]);
    const month = ctx.query.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return validation("Month must look like 2026-11.", { month: "Use YYYY-MM." });
    return reply(200, { days: await calendarDays(env, month) });
  }),
);

function boardOf(row: Record<string, unknown>): Board {
  return { name: row.name as string, rule: row.rule as Board["rule"], n: (row.n as number | null) ?? null, threshold_percent: (row.threshold_percent as number | null) ?? null, window_hours: row.window_hours as number, members: row.members as Board["members"] };
}

export async function saveBoard(env: Env, body: Record<string, unknown>, name: string | null): Promise<Board> {
  const errors: Record<string, string> = {};
  const boardName = name ?? (typeof body.name === "string" ? body.name : "");
  if (boardName === "") errors.name = "Name is required.";
  if (!["all", "any", "n_of_m", "weighted"].includes(String(body.rule))) errors.rule = "Use all, any, n_of_m or weighted.";
  const members = Array.isArray(body.members) ? (body.members as Array<Partial<Board["members"][number]>>).map((m) => ({ ...m, weight: m.weight ?? 1 }) as Board["members"][number]) : [];
  const windowHours = body.window_hours ?? 48;
  if (members.length === 0 || members.some((m) => typeof m.username !== "string" || !Number.isInteger(m.weight) || m.weight < 1)) errors.members = "Give each member a username and a weight of at least 1.";
  if (body.rule === "n_of_m" && (!Number.isInteger(body.n) || (body.n as number) < 1 || (body.n as number) > members.length)) errors.n = "N must be between 1 and the number of members.";
  if (body.rule === "weighted" && (!Number.isInteger(body.threshold_percent) || (body.threshold_percent as number) < 1 || (body.threshold_percent as number) > 100)) errors.threshold_percent = "Give a threshold from 1 to 100.";
  if (!Number.isInteger(windowHours) || (windowHours as number) < 1) errors.window_hours = "Give a window of at least 1 hour.";
  if (Object.keys(errors).length > 0) return validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  const rows = await env.tx.query(
    `INSERT INTO boards (name, rule, n, threshold_percent, window_hours, members) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET rule = EXCLUDED.rule, n = EXCLUDED.n, threshold_percent = EXCLUDED.threshold_percent, window_hours = EXCLUDED.window_hours, members = EXCLUDED.members RETURNING *`,
    [boardName, body.rule, body.rule === "n_of_m" ? body.n : null, body.rule === "weighted" ? body.threshold_percent : null, windowHours, JSON.stringify(members)],
  );
  return boardOf(rows[0]!);
}

route("GET", "/api/boards", async (ctx) => withEnv(ctx, async (env) => reply(200, { boards: (await env.tx.query("SELECT * FROM boards ORDER BY name")).map(boardOf) })));
route("POST", "/api/boards", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { board: await saveBoard(env, ctx.json(), null) });
  }),
);
route("PUT", "/api/boards/:name", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(200, { board: await saveBoard(env, ctx.json(), ctx.params.name!) });
  }),
);
route("GET", "/api/boards/:name/agenda", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, [...deskAndApprovers]);
    if (!(await env.tx.query("SELECT 1 FROM boards WHERE name = $1", [ctx.params.name])).length) return notFound();
    return reply(200, { items: await boardAgenda(env, ctx.params.name!) });
  }),
);

route("GET", "/api/freeze-windows", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rows = await env.tx.query("SELECT * FROM freeze_windows ORDER BY start_at, name");
    return reply(200, { freeze_windows: rows.map((r) => ({ name: r.name, start: r.start_at, end: r.end_at, time_zone: r.time_zone, scope: r.scope })) });
  }),
);

export async function createFreeze(env: Env, body: { name?: string; start?: string; end?: string; time_zone?: string; scope?: unknown }): Promise<Record<string, unknown>> {
  const errors: Record<string, string> = {};
  if (typeof body.name !== "string" || body.name === "") errors.name = "Name is required.";
  const start = Date.parse(body.start ?? "");
  const end = Date.parse(body.end ?? "");
  if (Number.isNaN(start)) errors.start = "Give a start instant.";
  if (Number.isNaN(end) || end <= start) errors.end = "The end must be after the start.";
  if (typeof body.time_zone !== "string" || !isValidZone(body.time_zone)) errors.time_zone = "Use an IANA time zone.";
  const scope = body.scope;
  if (scope !== "all" && !(typeof scope === "object" && scope !== null && Array.isArray((scope as { items?: unknown }).items))) errors.scope = 'Use "all" or {"items": [names]}.';
  if (Object.keys(errors).length > 0) return validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  await env.tx.query(
    `INSERT INTO freeze_windows (name, start_at, end_at, time_zone, scope) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name) DO UPDATE SET start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, time_zone = EXCLUDED.time_zone, scope = EXCLUDED.scope`,
    [body.name, new Date(start).toISOString(), new Date(end).toISOString(), body.time_zone, JSON.stringify(scope)],
  );
  return { name: body.name, start: isoWithOffset(start, body.time_zone!), end: isoWithOffset(end, body.time_zone!), time_zone: body.time_zone, scope };
}

route("POST", "/api/freeze-windows", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { freeze_window: await createFreeze(env, ctx.json()) });
  }),
);

route("GET", "/api/approvals", async (ctx) => withEnv(ctx, async (env) => reply(200, { approvals: await approvalsFor(env) })));

route("POST", "/api/approvals/:id/decision", async (ctx) =>
  withEnv(ctx, async (env) => {
    const body = ctx.json<{ decision?: unknown }>();
    if (body.decision !== "approve" && body.decision !== "reject") return validation("Vote approve or reject.", { decision: "Choose approve or reject." });
    const id = ctx.params.id!;
    const card = (await approvalsFor(env)).find((a) => a.id === id);
    if (id.startsWith("item-")) {
      if (!card) return fail(409, "already_decided", "This approval has already been decided.");
      await decideItemApproval(env, Number(id.slice(5)), body.decision);
      return reply(200, { approval: { ...card, decision: body.decision } });
    }
    const [number, step] = id.split(":") as [string, string];
    if (!card) {
      const existing = number && step ? await stepsOf(env.tx, number) : [];
      if (existing.length === 0) return notFound();
      return fail(409, "already_decided", "This approval has already been decided.");
    }
    const voters = card.step!.voters;
    const member = voters.some((v) => v.username === env.user.username) ? null : (voters.find((v) => v.decision === null)?.username ?? null);
    await castVote(env, number, Number(step), body.decision, member);
    return reply(200, { approval: { ...card, decision: body.decision } });
  }),
);

async function rotationOf(env: Env, name: string): Promise<Rotation> {
  return (await loadRotation(env.tx, name)) ?? notFound();
}

route("GET", "/api/rotations", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const rows = await env.tx.query("SELECT * FROM rotations ORDER BY name");
    return reply(200, { rotations: rows.map((r) => ({ name: r.name, time_zone: r.time_zone, handover_weekday: r.handover_weekday, handover_time: r.handover_time, members: r.members, anchor_date: r.anchor_date })) });
  }),
);

export async function createRotation(env: Env, body: Record<string, unknown>): Promise<Rotation> {
  const errors: Record<string, string> = {};
  if (typeof body.name !== "string" || body.name === "") errors.name = "Name is required.";
  if (typeof body.time_zone !== "string" || !isValidZone(body.time_zone)) errors.time_zone = "Use an IANA time zone.";
  if (typeof body.anchor_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.anchor_date)) errors.anchor_date = "Use YYYY-MM-DD.";
  const handoverTime = body.handover_time ?? "09:00";
  if (typeof handoverTime !== "string" || !/^\d{2}:\d{2}$/.test(handoverTime)) errors.handover_time = "Use HH:mm.";
  const members = Array.isArray(body.members) ? (body.members as string[]) : [];
  if (Object.keys(errors).length > 0) return validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  const rotation: Rotation = { name: body.name as string, time_zone: body.time_zone as string, handover_weekday: String(body.handover_weekday ?? "monday"), handover_time: handoverTime as string, members, anchor_date: body.anchor_date as string };
  validateRotation(rotation);
  await env.tx.query(
    `INSERT INTO rotations (name, time_zone, handover_weekday, handover_time, members, anchor_date) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET time_zone = EXCLUDED.time_zone, handover_weekday = EXCLUDED.handover_weekday, handover_time = EXCLUDED.handover_time, members = EXCLUDED.members, anchor_date = EXCLUDED.anchor_date`,
    [rotation.name, rotation.time_zone, rotation.handover_weekday, rotation.handover_time, rotation.members, rotation.anchor_date],
  );
  return rotation;
}

route("POST", "/api/rotations", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { rotation: await createRotation(env, ctx.json()) });
  }),
);

export async function createOverride(env: Env, rotation: string, body: { username?: unknown; start?: unknown; end?: unknown }): Promise<Record<string, unknown>> {
  await rotationOf(env, rotation);
  const start = typeof body.start === "string" ? Date.parse(body.start) : NaN;
  const end = typeof body.end === "string" ? Date.parse(body.end) : NaN;
  if (typeof body.username !== "string" || !env.world.people.has(body.username)) return validation("Choose an existing person.", { username: "Choose an existing person." });
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return validation("Give a start and an end, with the end after the start.", { end: "The end must be after the start." });
  await env.tx.query("INSERT INTO overrides (rotation, username, start_at, end_at) VALUES ($1, $2, $3, $4)", [rotation, body.username, new Date(start).toISOString(), new Date(end).toISOString()]);
  return { rotation, username: body.username, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

route("POST", "/api/rotations/:name/overrides", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { override: await createOverride(env, ctx.params.name!, ctx.json()) });
  }),
);

route("GET", "/api/rotations/:name/oncall", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const at = Date.parse(ctx.query.get("at") ?? "");
    if (Number.isNaN(at)) return validation("Give the instant to look at.", { at: "Use an ISO 8601 instant." });
    const shift = await onCallAt(env.tx, await rotationOf(env, ctx.params.name!), at);
    return reply(200, { username: shift.username, shift_start: new Date(shift.start).toISOString(), shift_end: new Date(shift.end).toISOString(), override: shift.override });
  }),
);

route("GET", "/api/rotations/:name/shifts", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    const from = Date.parse(ctx.query.get("from") ?? "");
    const to = Date.parse(ctx.query.get("to") ?? "");
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return validation("Give a from and a to instant.", { to: "Use ISO 8601 instants, with to after from." });
    const shifts = await shiftsBetween(env.tx, await rotationOf(env, ctx.params.name!), from, to);
    return reply(200, { shifts: shifts.map((s) => ({ username: s.username, start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), override: s.override })) });
  }),
);

route("GET", "/api/escalation-policies", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(200, { escalation_policies: (await env.tx.query("SELECT * FROM escalation_policies ORDER BY name")).map((p) => ({ name: p.name, levels: p.levels })) });
  }),
);

export async function createPolicy(env: Env, body: { name?: unknown; levels?: PolicyLevel[] }): Promise<Record<string, unknown>> {
  if (typeof body.name !== "string" || body.name === "" || !Array.isArray(body.levels) || body.levels.length === 0) return validation("A policy needs a name and at least one level.", { levels: "Add at least one level." });
  for (const level of body.levels) {
    const target = level.target;
    if ("user" in target ? !env.world.people.has(target.user) : !(await loadRotation(env.tx, target.rotation))) return validation("Every level needs an existing person or rotation.", { levels: "Check the level targets." });
  }
  await env.tx.query("INSERT INTO escalation_policies (name, levels) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET levels = EXCLUDED.levels", [body.name, JSON.stringify(body.levels)]);
  return { name: body.name, levels: body.levels };
}

route("POST", "/api/escalation-policies", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireOperator(env);
    return reply(201, { escalation_policy: await createPolicy(env, ctx.json()) });
  }),
);

route("POST", "/api/records/:number/page", async (ctx) =>
  withEnv(ctx, async (env) => {
    const rec = await visible(env, ctx.params.number!);
    requireRole(env, ["operator", "technician"]);
    const policy = ctx.json<{ policy?: unknown }>().policy;
    if (typeof policy !== "string") return validation("Name the escalation policy.", { policy: "Policy is required." });
    return reply(201, { page: await startPage(env, rec.number, policy) });
  }),
);

route("GET", "/api/pages", async (ctx) =>
  withEnv(ctx, async (env) => {
    requireRole(env, ["operator", "technician"]);
    return reply(200, { pages: await listPages(env.tx) });
  }),
);

route("POST", "/api/pages/:id/acknowledge", async (ctx) => withEnv(ctx, async (env) => reply(200, { page: await acknowledge(env, numberParam(ctx, "id")) })));
