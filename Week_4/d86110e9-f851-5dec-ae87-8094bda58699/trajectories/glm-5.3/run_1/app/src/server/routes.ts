// Every API route. Handlers stay thin; domain rules live in their modules.

import { CONFIG, KIND_LABELS, STEP_KINDS, TRIGGER_KINDS, GRID_COLS, GRID_ROWS } from "./config.js";
import { db } from "./db.js";
import { ApiError, Errors } from "./errors.js";
import { requireObject, send } from "./http.js";
import type { Ctx } from "./http.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { newToken, newImportId } from "./ids.js";
import { users, sessions, confirmTokens, workspaces, invites, automations, stepsRepo, edgesRepo, countersRepo, runsRepo, runStepsRepo, tablesRepo, timersRepo, idemKeys, editHolds, versionsRepo } from "./repo.js";
import type { AutomationRow, RunRow } from "./repo.js";
import type { AutomationContent, EdgeLink, StepNode, TriggerNode } from "./graph.js";
import { executionOrder, isInsideALoop, reaches, stepMap, partOf, edgesFrom, connectedFromTrigger, stepNumber } from "./graph.js";
import { charCount, parseDecimal } from "./text.js";
import { nameTooLong, validateForPublish, webhookUrlRefused } from "./validate.js";
import { sendMail } from "./mailer.js";
import { putObject } from "./storage.js";
import { startRun, cancelRun, draftContent, versionContent, PORT } from "./engine.js";
import { pushDraftEvent, pushRunListItem, pushAnnouncement, pushVersionEvent, pushDrainCount, pushTableEventMsg, runListShape } from "./push.js";
import { addClient, removeClient, draftMembers, writeEvent } from "./events.js";
import { workspaceNow, wsOffset, realNowMs, invalidateWs } from "./clock.js";
import { parseSchedule, nextAfter } from "./schedule.js";

// ---------------------------------------------------------------- helpers

function bad(status: number, message: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(status, message, extra);
}

async function requireWs(ctx: Ctx, wsId: string): Promise<{ role: string; wsName: string; slug: string }> {
  if (!ctx.userId) throw Errors.signRequired();
  const ws = await workspaces.byId(db, wsId);
  const role = ws ? await workspaces.memberRole(db, wsId, ctx.userId) : null;
  if (!ws || !role) throw Errors.notFound();
  return { role, wsName: ws.name, slug: ws.slug };
}

async function requireEditor(ctx: Ctx, wsId: string): Promise<string> {
  const { role } = await requireWs(ctx, wsId);
  if (role === "viewer") throw Errors.viewerForbidden();
  return role;
}

async function requireOwner(ctx: Ctx, wsId: string): Promise<void> {
  const { role } = await requireWs(ctx, wsId);
  if (role === "viewer") throw Errors.viewerForbidden();
  if (role !== "owner") throw Errors.ownerForbidden();
}

async function automationOf(ctx: Ctx, wsId: string, aid: string): Promise<AutomationRow> {
  await requireWs(ctx, wsId);
  const a = await automations.byId(db, aid);
  if (!a || a.workspace_id !== wsId) throw Errors.notFound();
  return a;
}

async function revisionBump(aid: string): Promise<number> {
  const r = await db.query("UPDATE automations SET draft_revision=draft_revision+1 WHERE id=$1 RETURNING draft_revision", [aid]);
  return Number(r.rows[0].draft_revision);
}

async function currentRevision(aid: string): Promise<number> {
  const r = await db.query("SELECT draft_revision FROM automations WHERE id=$1", [aid]);
  return Number(r.rows[0].draft_revision);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  while (await workspaces.bySlug(db, slug)) {
    slug = base + "-" + i++;
  }
  return slug;
}

function defaultTriggerName(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

async function draftShape(a: AutomationRow): Promise<Record<string, unknown>> {
  const trigger = await stepsRepo.triggerOf(db, a.id, null);
  const steps = await stepsRepo.listDraft(db, a.id);
  const edges = await edgesRepo.list(db, a.id, null);
  const drain = await runsRepo.drainCount(db, a.id, a.live_version);
  const nextRunAt = await nextRunAtOf(a);
  return {
    id: a.id, name: a.name, trigger_kind: a.trigger_kind, revision: a.draft_revision,
    live_version: a.live_version, drain_count: drain, next_run_at: nextRunAt,
    trigger, steps, edges,
  };
}

async function nextRunAtOf(a: AutomationRow): Promise<string | null> {
  if (a.live_version === null || a.trigger_kind !== "schedule") return null;
  const v = await versionsRepo.get(db, a.id, a.live_version);
  if (!v) return null;
  const spec = parseSchedule(String(v.content.trigger.fields.schedule ?? ""));
  if (!spec) return null;
  const r = await db.query("SELECT next_fire_at FROM automations WHERE id=$1", [a.id]);
  const nf = r.rows[0]?.next_fire_at as Date | null;
  return nf ? new Date(nf).toISOString() : null;
}

// ------------------------------------------------------------ auth routes

export async function signUp(ctx: Ctx): Promise<void> {
  const b = requireObject(ctx.body);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (name === "") throw bad(422, "Enter your name", { field: "name" });
  if (nameTooLong(name)) throw Errors.nameTooLong();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad(422, "Enter a valid email address", { field: "email" });
  if (password.length < 8) throw bad(422, "Password must be at least 8 characters", { field: "password" });
  const existing = await users.byEmail(db, email);
  if (existing) throw Errors.emailTaken();
  const user = await users.create(db, email, name, password, false);
  const token = await confirmTokens.create(db, user.id);
  const mail = await sendMail({
    to: email,
    subject: "Confirm your Pinbyte Switchyard account",
    body: `${CONFIG.publicUrl}/confirm/${token}`,
  });
  if (!mail.accepted) {
    await db.query("DELETE FROM users WHERE id=$1", [user.id]);
    throw Errors.emailUnavailable();
  }
  const ws = await workspaces.create(db, `${name}'s workspace`, await uniqueSlug(slugify(`${name}s-workspace`)));
  await workspaces.addMember(db, ws.id, user.id, "owner");
  send(ctx.res, 201, { message: "Check your email to confirm your account" });
}

export async function confirm(ctx: Ctx): Promise<void> {
  const b = requireObject(ctx.body);
  const token = typeof b.token === "string" ? b.token : "";
  const uid = await confirmTokens.find(db, token);
  if (!uid) throw Errors.notFound();
  await users.setConfirmed(db, uid);
  await confirmTokens.consume(db, uid);
  const sess = await sessions.create(db, uid);
  const wsList = await workspaces.listForUser(db, uid);
  ctx.res.setHeader("Set-Cookie", cookieOf(sess));
  send(ctx.res, 200, { workspace_id: wsList[0]?.id ?? null });
}

export async function signIn(ctx: Ctx): Promise<void> {
  const b = requireObject(ctx.body);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const u = await users.byEmail(db, email);
  if (!u || !verifyPassword(password, u.password_hash)) throw Errors.wrongPassword();
  if (!u.confirmed) throw Errors.confirmFirst();
  const sess = await sessions.create(db, u.id);
  const wsList = await workspaces.listForUser(db, u.id);
  ctx.res.setHeader("Set-Cookie", cookieOf(sess));
  send(ctx.res, 200, { workspace_id: wsList[0]?.id ?? null, name: u.name });
}

export async function signOut(ctx: Ctx): Promise<void> {
  if (ctx.session) await sessions.delete(db, ctx.session);
  ctx.res.setHeader("Set-Cookie", cookieOf("", true));
  send(ctx.res, 204);
}

export async function me(ctx: Ctx): Promise<void> {
  if (!ctx.userId) throw Errors.signRequired();
  const u = await users.byId(db, ctx.userId);
  if (!u) throw Errors.signRequired();
  const wsList = await workspaces.listForUser(db, u.id);
  send(ctx.res, 200, { id: u.id, name: u.name, email: u.email, workspaces: wsList });
}

function cookieOf(token: string, expire = false): string {
  if (expire) return "switchyard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  return `switchyard_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export async function inviteInfo(ctx: Ctx): Promise<void> {
  const inv = await invites.find(db, ctx.params.token);
  if (!inv || inv.used) throw Errors.notFound();
  const ws = await workspaces.byId(db, inv.workspace_id);
  const has = Boolean(await users.byEmail(db, inv.email));
  send(ctx.res, 200, { workspace_name: ws?.name ?? "", email: inv.email, role: inv.role, has_account: has });
}

export async function inviteAccept(ctx: Ctx): Promise<void> {
  const inv = await invites.find(db, ctx.params.token);
  if (!inv || inv.used) throw Errors.notFound();
  const b = requireObject(ctx.body);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (password.length < 8) throw bad(422, "Password must be at least 8 characters", { field: "password" });
  let uid: string;
  const existing = await users.byEmail(db, inv.email);
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) throw Errors.wrongPassword();
    uid = existing.id;
    if (!existing.confirmed) await users.setConfirmed(db, uid);
  } else {
    if (name === "") throw bad(422, "Enter your name", { field: "name" });
    if (nameTooLong(name)) throw Errors.nameTooLong();
    const u = await users.create(db, inv.email, name, password, true);
    uid = u.id;
  }
  await workspaces.addMember(db, inv.workspace_id, uid, inv.role);
  await invites.markUsed(db, inv.id);
  const sess = await sessions.create(db, uid);
  ctx.res.setHeader("Set-Cookie", cookieOf(sess));
  send(ctx.res, 200, { workspace_id: inv.workspace_id });
}

// ------------------------------------------------- workspace, members, tables

export async function wsInfo(ctx: Ctx): Promise<void> {
  const { role, wsName, slug } = await requireWs(ctx, ctx.params.ws);
  const ws = await workspaces.byId(db, ctx.params.ws);
  const now = await workspaceNow(db, ctx.params.ws);
  send(ctx.res, 200, { id: ctx.params.ws, name: wsName, slug, role, time_zone: CONFIG.timeZone, now: now.toISOString() });
}

export async function membersList(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const mems = await workspaces.members(db, ctx.params.ws);
  const out = [];
  for (const m of mems) {
    const u = await users.byId(db, m.user_id);
    if (u) out.push({ user_id: u.id, name: u.name, email: u.email, role: m.role });
  }
  const inv = await invites.listPending(db, ctx.params.ws);
  send(ctx.res, 200, { members: out, invites: inv });
}

export async function inviteCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  const { wsName } = await requireWs(ctx, wsId);
  await requireOwner(ctx, wsId);
  const b = requireObject(ctx.body);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const role = typeof b.role === "string" ? b.role : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad(422, "Enter a valid email address", { field: "email" });
  if (role !== "editor" && role !== "viewer") throw bad(422, "Role must be editor or viewer", { field: "role" });
  const existingUser = await users.byEmail(db, email);
  if (existingUser) {
    const alreadyMember = await workspaces.memberRole(db, wsId, existingUser.id);
    if (alreadyMember) throw Errors.alreadyMember();
  }
  const meU = ctx.userId ? await users.byId(db, ctx.userId) : null;
  const { id, token } = await invites.replaceForEmail(db, wsId, email, role);
  const mail = await sendMail({
    to: email,
    subject: `${meU?.name ?? "Someone"} invited you to ${wsName} on Pinbyte Switchyard`,
    body: `${CONFIG.publicUrl}/invite/${token}`,
  });
  if (!mail.accepted) {
    await invites.markUsed(db, id);
    throw Errors.emailUnavailable();
  }
  send(ctx.res, 201, { invite_id: id, email, role });
}

export async function tablesList(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const ts = await tablesRepo.listForWs(db, ctx.params.ws);
  const out = [];
  for (const t of ts) {
    out.push({ id: t.id, name: t.name, columns: t.columns, row_count: await tablesRepo.rowCount(db, t.id) });
  }
  send(ctx.res, 200, { tables: out });
}

export async function tablesCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const b = requireObject(ctx.body);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const cols = b.columns;
  if (name === "") throw bad(422, "Table name is required", { field: "name" });
  if (nameTooLong(name)) throw Errors.nameTooLong();
  if (!Array.isArray(cols) || cols.length === 0) throw bad(422, "Add at least one column", { field: "columns" });
  const seen = new Set<string>();
  const columns: { name: string; type: string }[] = [];
  for (const c of cols) {
    const cn = typeof (c as Record<string, unknown>).name === "string" ? ((c as Record<string, unknown>).name as string).trim() : "";
    const ct = typeof (c as Record<string, unknown>).type === "string" ? (c as Record<string, unknown>).type : "";
    if (cn === "") throw bad(422, "Column names must be unique", { field: "columns" });
    if (seen.has(cn)) throw bad(422, "Column names must be unique", { field: "columns" });
    if (nameTooLong(cn)) throw Errors.nameTooLong();
    if (ct !== "text" && ct !== "number") throw bad(422, "Column type must be text or number", { field: "columns" });
    seen.add(cn);
    columns.push({ name: cn, type: ct });
  }
  const t = await tablesRepo.create(db, wsId, name, columns);
  send(ctx.res, 201, { id: t.id, name: t.name, columns: t.columns, rows: [] });
}

export async function tableDetail(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const t = await tablesRepo.byId(db, ctx.params.tid);
  if (!t || t.workspace_id !== ctx.params.ws) throw Errors.notFound();
  const rows = await tablesRepo.rows(db, t.id);
  send(ctx.res, 200, { id: t.id, name: t.name, columns: t.columns, rows: rows.map((r) => ({ _row_id: r.row_id, ...r.values })) });
}

export async function tableRowAdd(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const t = await tablesRepo.byId(db, ctx.params.tid);
  if (!t || t.workspace_id !== wsId) throw Errors.notFound();
  const b = requireObject(ctx.body);
  const values = (b.values ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const col of t.columns) {
    const v = values[col.name];
    if (v === undefined) continue;
    if (col.type === "number") {
      const num = typeof v === "number" ? v : (typeof v === "string" ? parseDecimal(v) : null);
      if (num === null) throw bad(422, `Column ${col.name} must be a number`, { field: col.name });
      out[col.name] = num;
    } else {
      out[col.name] = typeof v === "string" ? v : String(v);
    }
  }
  const row = await tablesRepo.insertRow(db, t.id, out);
  pushTableEventMsg(wsId, t.id);
  await fireRowAddedTriggers(wsId, t.id, { ...row.values, _row_id: row.row_id });
  send(ctx.res, 201, { _row_id: row.row_id, ...row.values });
}

async function fireRowAddedTriggers(wsId: string, tableId: string, row: Record<string, unknown>): Promise<void> {
  const autos = await automations.listForWs(db, wsId);
  for (const a of autos) {
    if (a.trigger_kind !== "row_added" || a.live_version === null) continue;
    const v = await versionsRepo.get(db, a.id, a.live_version);
    if (!v) continue;
    if (String(v.content.trigger.fields.table ?? "") !== tableId) continue;
    await startRun({ wsId, aid: a.id, version: a.live_version, test: false, triggerOutput: row });
  }
}

// ------------------------------------------------------- automations, draft

export async function autosList(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const list = await automations.listForWs(db, ctx.params.ws);
  const out = [];
  for (const a of list) {
    out.push({
      id: a.id, name: a.name, trigger_kind: a.trigger_kind, live_version: a.live_version,
      next_run_at: await nextRunAtOf(a), drain_count: await runsRepo.drainCount(db, a.id, a.live_version),
    });
  }
  send(ctx.res, 200, { automations: out });
}

export async function autosCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const b = requireObject(ctx.body);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const kind = typeof b.trigger_kind === "string" ? b.trigger_kind : "";
  if (name === "") throw bad(422, "Name is required", { field: "name" });
  if (nameTooLong(name)) throw Errors.nameTooLong();
  if (!TRIGGER_KINDS.includes(kind)) throw Errors.unknownNodeKind(kind);
  const a = await automations.create(db, wsId, name, kind);
  const seq = 1;
  await stepsRepo.insert(db, a.id, null, {
    id: "trigger", kind, name: defaultTriggerName(kind), col: 1, row: 2,
    fields: defaultTriggerFields(kind), seq,
  } as never, {});
  send(ctx.res, 201, await draftShape(a));
}

function defaultTriggerFields(kind: string): Record<string, unknown> {
  switch (kind) {
    case "form": return { path: "", form_fields: [] };
    case "schedule": return { schedule: "" };
    case "webhook": return { path: "" };
    case "row_added": return { table: "" };
    default: return {};
  }
}

export async function autoDetail(ctx: Ctx): Promise<void> {
  const a = await automationOf(ctx, ctx.params.ws, ctx.params.aid);
  send(ctx.res, 200, await draftShape(a));
}

export async function stepCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const b = requireObject(ctx.body);
  const kind = typeof b.kind === "string" ? b.kind : "";
  const col = Number(b.col);
  const row = Number(b.row);
  if (!STEP_KINDS.includes(kind)) throw Errors.unknownNodeKind(kind);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 1 || col > GRID_COLS || row < 1 || row > GRID_ROWS) throw Errors.cellOutside();
  const taken = await cellTaken(a.id, null, col, row);
  if (taken) throw Errors.cellTaken();
  let sid = typeof b.id === "string" ? b.id : "";
  if (sid) {
    // restore a previously deleted id (undo)
    const exists = await stepsRepo.byId(db, a.id, null, sid);
    if (exists) throw Errors.cellTaken();
  } else {
    sid = await automations.nextStepId(db, a.id);
  }
  const count = await countersRepo.bumpStep(db, a.id, kind);
  const name = `${KIND_LABELS[kind]} ${count}`;
  const seq = await automations.nextDraftStepSeq(db, a.id);
  await stepsRepo.insert(db, a.id, null, { id: sid, kind, name, col, row, fields: defaultStepFields(kind), seq });
  const revision = await revisionBump(a.id);
  pushDraftEvent(wsId, a.id, revision, sid, null);
  send(ctx.res, 201, { id: sid, kind, name, col, row, fields: defaultStepFields(kind) });
}

async function cellTaken(aid: string, version: number | null, col: number, row: number): Promise<boolean> {
  const trig = await stepsRepo.triggerOf(db, aid, version);
  if (trig.col === col && trig.row === row) return true;
  const steps = version === null ? await stepsRepo.listDraft(db, aid) : await stepsRepo.listVersion(db, aid, version);
  return steps.some((s) => s.col === col && s.row === row);
}

function defaultStepFields(kind: string): Record<string, unknown> {
  switch (kind) {
    case "set": return { values: {} };
    case "filter": case "branch": return { left: "", operator: "equals", right: "" };
    case "loop": return { source: "list", list: "", table: "" };
    case "wait": return { seconds: 60 };
    case "send_email": return { to: "", subject: "", body: "" };
    case "add_row": case "update_row": return { table: "", values: {} };
    case "call_webhook": return { url: "", body: {} };
    default: return {};
  }
}

export async function stepUpdate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  const { role } = await requireWs(ctx, wsId);
  if (role === "viewer") throw Errors.viewerForbidden();
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const sid = ctx.params.sid;
  const b = requireObject(ctx.body);
  const existing = sid === "trigger" ? await stepsRepo.triggerOf(db, a.id, null) : await stepsRepo.byId(db, a.id, null, sid);
  if (!existing) throw Errors.notFound();
  const patch: { name?: string; fields?: Record<string, unknown>; sample?: unknown; col?: number; row?: number } = {};
  if (typeof b.name === "string") {
    if (nameTooLong(b.name)) throw Errors.nameTooLong();
    patch.name = b.name;
  }
  if (b.fields !== undefined) {
    const f = requireObject(b.fields);
    patch.fields = f;
  }
  if (b.sample !== undefined) {
    if (sid !== "trigger") throw bad(422, "Sample data must be a JSON object", { field: "sample" });
    if (b.sample === null || typeof b.sample !== "object" || Array.isArray(b.sample)) throw Errors.sampleObject();
    patch.sample = b.sample;
  }
  if (b.col !== undefined || b.row !== undefined) {
    const col = b.col !== undefined ? Number(b.col) : existing.col;
    const row = b.row !== undefined ? Number(b.row) : existing.row;
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 1 || col > GRID_COLS || row < 1 || row > GRID_ROWS) throw Errors.cellOutside();
    if (col !== existing.col || row !== existing.row) {
      const taken = await cellTaken(a.id, null, col, row);
      if (taken) throw Errors.cellTaken();
    }
    patch.col = col;
    patch.row = row;
  }
  // names/fields/sample hold the step; a move does not
  const holdsSomething = patch.name !== undefined || patch.fields !== undefined || patch.sample !== undefined;
  if (holdsSomething && sid !== "trigger") {
    const conflict = await checkEditHold(a.id, sid, ctx.userId!);
    if (conflict) {
      const step = await stepsRepo.byId(db, a.id, null, sid);
      throw bad(409, conflict, { step });
    }
  }
  await stepsRepo.updateFields(db, a.id, null, sid, patch);
  const revision = await revisionBump(a.id);
  if (holdsSomething && sid !== "trigger") {
    const until = new Date((await workspaceNow(db, wsId)).getTime() + CONFIG.editHoldSeconds * 1000);
    await editHolds.put(db, a.id, sid, ctx.userId!, until);
  }
  const step = sid === "trigger" ? await stepsRepo.triggerOf(db, a.id, null) : await stepsRepo.byId(db, a.id, null, sid);
  pushDraftEvent(wsId, a.id, revision, sid, step);
  send(ctx.res, 200, { step, revision });
}

async function checkEditHold(aid: string, sid: string, userId: string): Promise<string | null> {
  const h = await editHolds.get(db, aid, sid);
  if (!h) return null;
  if (h.holder === userId) return null;
  const now = await workspaceNow(db, (await automations.byId(db, aid))!.workspace_id);
  if (h.held_until.getTime() <= now.getTime()) return null;
  const holder = await users.byId(db, h.holder);
  const step = await stepsRepo.byId(db, aid, null, sid);
  return `${holder?.name ?? "Another member"} is editing ${step?.name ?? sid}. Your change was not saved.`;
}

export async function stepDelete(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const sid = ctx.params.sid;
  if (sid === "trigger") throw Errors.triggerUndeletable();
  const existing = await stepsRepo.byId(db, a.id, null, sid);
  if (!existing) throw Errors.notFound();
  await edgesRepo.deleteOfStep(db, a.id, null, sid);
  await stepsRepo.delete(db, a.id, null, sid);
  await editHolds.release(db, a.id, sid, ctx.userId!);
  const revision = await revisionBump(a.id);
  pushDraftEvent(wsId, a.id, revision, sid, null);
  send(ctx.res, 204);
}

// ------------------------------------------------------------ draft edges

export async function edgeCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const b = requireObject(ctx.body);
  const from = typeof b.from === "string" ? b.from : "";
  const port = typeof b.port === "string" ? b.port : "";
  const to = typeof b.to === "string" ? b.to : "";
  const content = await draftContent(db, a.id);
  const m = stepMap(content);
  if (!m.has(from) || !m.has(to)) throw Errors.unknownStep(m.has(from) ? to : from);
  if (to === "trigger") throw bad(422, "The trigger cannot have an incoming edge");
  const fromNode = m.get(from)!;
  const ports = from === "trigger" ? ["out"] : portsOfKind(fromNode.kind);
  if (!ports.includes(port)) throw bad(422, `Step ${from} has no port ${port}`);
  if (reaches(content.edges, from, to)) throw bad(422, `That edge would close a cycle at step ${to}`);
  if (content.edges.some((e) => e.to === to)) throw bad(422, `Step ${to} already has an incoming edge`);
  const order = edgesFrom(content.edges, from, port).length + 1;
  const eid = await countersRepo.nextEdgeId(db, a.id, null);
  const edge: EdgeLink = { id: eid, from, port, to, order };
  await edgesRepo.insert(db, a.id, null, edge);
  const revision = await revisionBump(a.id);
  pushDraftEvent(wsId, a.id, revision, from, null);
  send(ctx.res, 201, edge);
}

function portsOfKind(kind: string): string[] {
  const map: Record<string, string[]> = {
    set: ["out", "error"], filter: ["out"], branch: ["true", "false"], loop: ["each", "done"],
    wait: ["out"], send_email: ["out", "error"], add_row: ["out", "error"], update_row: ["out", "error"],
    call_webhook: ["out", "error"],
  };
  return map[kind] ?? [];
}

export async function edgeDelete(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const edges = await edgesRepo.list(db, a.id, null);
  const e = edges.find((x) => x.id === ctx.params.eid);
  if (!e) throw Errors.notFound();
  await edgesRepo.delete(db, a.id, null, e.id);
  // renumber remaining edges on that port from 1
  const rest = edgesFrom(edges.filter((x) => x.id !== e.id), e.from, e.port);
  let i = 1;
  for (const r of rest) {
    await db.query("UPDATE edges SET ord=$1 WHERE automation_id=$2 AND version=0 AND id=$3", [i++, a.id, r.id]);
  }
  const revision = await revisionBump(a.id);
  pushDraftEvent(wsId, a.id, revision, e.from, null);
  send(ctx.res, 204);
}

// --------------------------------------------------------------- publish

export async function publish(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const content = await draftContent(db, a.id);
  // path uniqueness among other live automations
  const err = await publishPathConflict(wsId, a.id, content);
  if (err) {
    send(ctx.res, 422, { error: err.error, step_id: err.step_id });
    return;
  }
  const verr = validateForPublish(content);
  if (verr) {
    send(ctx.res, 422, { error: verr.error, step_id: verr.step_id });
    return;
  }
  if (a.live_version !== null) {
    const live = await versionsRepo.get(db, a.id, a.live_version);
    if (live && live.revision === a.draft_revision) throw Errors.noChanges(a.live_version);
  }
  const version = (a.live_version ?? 0) + 1;
  const now = await workspaceNow(db, wsId);
  await versionsRepo.put(db, a.id, version, a.draft_revision, now, content);
  await db.query("UPDATE automations SET live_version=$1 WHERE id=$2", [version, a.id]);
  // schedule anchoring
  if (content.trigger.kind === "schedule") {
    const spec = parseSchedule(String(content.trigger.fields.schedule ?? ""));
    if (spec) {
      const next = new Date(nextAfter(spec, now.getTime()));
      await db.query("UPDATE automations SET next_fire_at=$1 WHERE id=$2", [next, a.id]);
    }
  } else {
    await db.query("UPDATE automations SET next_fire_at=NULL WHERE id=$1", [a.id]);
  }
  pushVersionEvent(wsId, a.id, version);
  pushAnnouncement(wsId, `Version ${version} published`);
  const drain = await runsRepo.drainCount(db, a.id, version);
  if (drain > 0) {
    pushDrainCount(db, wsId, a.id);
  }
  send(ctx.res, 201, { version, published_at: now.toISOString() });
}

async function publishPathConflict(wsId: string, aid: string, content: AutomationContent): Promise<{ error: string; step_id: string } | null> {
  const trig = content.trigger;
  const path = String(trig.fields.path ?? "");
  if (trig.kind !== "form" && trig.kind !== "webhook") return null;
  if (path === "") return null;
  const others = await automations.listForWs(db, wsId);
  for (const o of others) {
    if (o.id === aid || o.live_version === null) continue;
    const v = await versionsRepo.get(db, o.id, o.live_version);
    if (!v) continue;
    const ot = v.content.trigger;
    if (ot.kind === trig.kind && String(ot.fields.path ?? "") === path) {
      return { error: "Step trigger needs a path no other live automation uses", step_id: "trigger" };
    }
  }
  return null;
}

export async function versionsList(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const a = await automationOf(ctx, ctx.params.ws, ctx.params.aid);
  const vs = await versionsRepo.list(db, a.id);
  const out = [];
  for (const v of vs) {
    const runsLeft = await runsRepo.unfinishedOnOldVersions(db, a.id, v.version);
    const isLive = a.live_version === v.version;
    const olderUnfinished = v.version < (a.live_version ?? 0) ? await countUnfinishedAtOrBelow(db, a.id, v.version) : 0;
    let status: string;
    if (isLive) status = "live";
    else if (olderUnfinished > 0) status = "draining";
    else status = "retired";
    out.push({ version: v.version, status, published_at: new Date(v.published_at).toISOString(), runs_left: olderUnfinished });
  }
  send(ctx.res, 200, { versions: out });
}

async function countUnfinishedAtOrBelow(d: typeof db, aid: string, version: number): Promise<number> {
  const r = await d.query(
    "SELECT COUNT(*) AS c FROM runs WHERE automation_id=$1 AND test=false AND version=$2 AND status IN ('queued','running','waiting')",
    [aid, version]
  );
  return Number(r.rows[0].c);
}

export async function versionDetail(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const a = await automationOf(ctx, ctx.params.ws, ctx.params.aid);
  const n = Number(ctx.params.n);
  const v = await versionsRepo.get(db, a.id, n);
  if (!v) throw Errors.notFound();
  send(ctx.res, 200, { ...contentToShape(v.content), version: n });
}

function contentToShape(c: AutomationContent): Record<string, unknown> {
  return {
    trigger: { id: "trigger", kind: c.trigger.kind, name: c.trigger.name, col: c.trigger.col, row: c.trigger.row, fields: c.trigger.fields, sample: c.trigger.sample },
    steps: c.steps.map((s) => ({ id: s.id, kind: s.kind, name: s.name, col: s.col, row: s.row, fields: s.fields })),
    edges: c.edges,
  };
}

// --------------------------------------------------------------- export

export async function exportVersion(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const n = Number(ctx.params.n);
  const v = await versionsRepo.get(db, a.id, n);
  if (!v) throw Errors.notFound();
  const file = {
    format: "switchyard-automation",
    format_version: 1,
    name: a.name,
    trigger: { kind: v.content.trigger.kind, col: v.content.trigger.col, row: v.content.trigger.row, fields: v.content.trigger.fields, sample: v.content.trigger.sample },
    steps: v.content.steps.map((s) => ({ id: s.id, kind: s.kind, name: s.name, col: s.col, row: s.row, fields: s.fields })),
    edges: v.content.edges.map((e) => ({ from: e.from, port: e.port, to: e.to, order: e.order })),
  };
  const bytes = Buffer.from(JSON.stringify(file, null, 2) + "\n", "utf8");
  const key = `exports/${wsId}/${a.id}/v${n}.json`;
  await putObject(key, bytes);
  ctx.res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Disposition": "attachment",
  });
  ctx.res.end(bytes);
}

export async function importAutomation(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const raw = ctx.rawBody;
  if (raw.length > 262144) throw Errors.importTooLarge();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw Errors.importNotJson();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Errors.importNotSwitchyard();
  const f = parsed as Record<string, unknown>;
  if (f.format !== "switchyard-automation" || f.format_version !== 1) throw Errors.importNotSwitchyard();
  const trig = f.trigger as Record<string, unknown> | undefined;
  const steps = f.steps as Record<string, unknown>[] | undefined;
  const edges = f.edges as Record<string, unknown>[] | undefined;
  if (!trig || !Array.isArray(steps) || !Array.isArray(edges)) throw Errors.importNotSwitchyard();
  const name = typeof f.name === "string" ? f.name : "";
  if (name === "" || nameTooLong(name)) throw Errors.importNotSwitchyard();
  const trigKind = String(trig.kind ?? "");
  if (!TRIGGER_KINDS.includes(trigKind)) throw Errors.unknownNodeKind(trigKind);
  for (const s of steps) {
    const k = String(s.kind ?? "");
    if (!STEP_KINDS.includes(k)) throw Errors.unknownNodeKind(k);
  }
  // build content and validate edges
  const content: AutomationContent = {
    trigger: {
      id: "trigger", kind: trigKind, name: defaultTriggerName(trigKind),
      col: Number(trig.col ?? 1), row: Number(trig.row ?? 2),
      fields: (trig.fields ?? {}) as Record<string, unknown>,
      sample: trig.sample ?? {},
    },
    steps: steps.map((s, i) => ({
      id: String(s.id ?? `s${i + 1}`), kind: String(s.kind), name: String(s.name ?? ""),
      col: Number(s.col ?? 1), row: Number(s.row ?? 2), fields: (s.fields ?? {}) as Record<string, unknown>,
    })),
    edges: edges.map((e, i) => ({
      id: `e${i + 1}`, from: String(e.from ?? ""), port: String(e.port ?? ""),
      to: String(e.to ?? ""), order: Number(e.order ?? i + 1),
    })),
  };
  // edge checks in the published order
  const m = stepMap(content);
  for (const e of content.edges) {
    if (!m.has(e.from) || !m.has(e.to)) throw Errors.unknownStep(m.has(e.from) ? e.to : e.from);
    if (e.to === "trigger") throw bad(422, "The trigger cannot have an incoming edge");
    const fromNode = m.get(e.from)!;
    const ports = e.from === "trigger" ? ["out"] : portsOfKind(fromNode.kind);
    if (!ports.includes(e.port)) throw bad(422, `Step ${e.from} has no port ${e.port}`);
    if (reaches(content.edges.filter((x) => x !== e), e.from, e.to)) throw bad(422, `That edge would close a cycle at step ${e.to}`);
    if (content.edges.some((x) => x !== e && x.to === e.to)) throw bad(422, `Step ${e.to} already has an incoming edge`);
  }
  const importId = newImportId();
  const key = `imports/${wsId}/${importId}.json`;
  await putObject(key, raw);
  // create the new draft from the content
  const a = await automations.create(db, wsId, name, trigKind);
  await stepsRepo.insert(db, a.id, null, { ...content.trigger, seq: 1 } as never, content.trigger.sample);
  let seq = 2;
  const idMap = new Map<string, string>();
  content.steps.forEach((s, i) => idMap.set(String((steps[i] as Record<string, unknown>).id ?? s.id), s.id));
  for (const s of content.steps) {
    await stepsRepo.insert(db, a.id, null, { ...s, seq: seq++ });
    await countersRepo.bumpStep(db, a.id, s.kind);
  }
  let ei = 1;
  for (const e of content.edges) {
    await edgesRepo.insert(db, a.id, null, { ...e, id: "e" + ei++ });
  }
  send(ctx.res, 201, { automation_id: a.id, import_id: importId, key });
}

// ----------------------------------------------------------------- runs

export async function runCreate(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const a = await automationOf(ctx, wsId, ctx.params.aid);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const isTest = b.test === true;
  let input: unknown = {};
  if (b.input !== undefined) {
    if (!b.input || typeof b.input !== "object" || Array.isArray(b.input)) throw Errors.runInputObject();
    input = b.input;
  }
  let version: number | null;
  let triggerOutput: unknown;
  if (isTest) {
    version = null;
    const trig = await stepsRepo.triggerOf(db, a.id, null);
    triggerOutput = b.input !== undefined ? input : (trig.sample && typeof trig.sample === "object" ? trig.sample : {});
  } else {
    if (a.trigger_kind !== "manual") throw Errors.onlyManual();
    if (a.live_version === null) throw Errors.publishBeforeRun();
    version = a.live_version;
    triggerOutput = input;
  }
  const run = await startRun({ wsId, aid: a.id, version, test: isTest, triggerOutput });
  send(ctx.res, 201, { run_id: run.id, number: run.number });
}

export async function runsList(ctx: Ctx): Promise<void> {
  await requireWs(ctx, ctx.params.ws);
  const status = ctx.query.status ?? "";
  const autoFilter = ctx.query.automation ?? "";
  const showTests = ctx.query.test === "true";
  if (status !== "" && !["queued", "running", "waiting", "succeeded", "failed", "cancelled"].includes(status)) {
    throw Errors.unknownStatus(status);
  }
  if (autoFilter !== "") {
    const a = await automations.byId(db, autoFilter);
    if (!a || a.workspace_id !== ctx.params.ws) throw Errors.notFound();
  }
  let rows = await runsRepo.listForWs(db, ctx.params.ws);
  if (!showTests) rows = rows.filter((r) => !r.test);
  if (status !== "") rows = rows.filter((r) => r.status === status);
  if (autoFilter !== "") rows = rows.filter((r) => r.automation_id === autoFilter);
  const out = [];
  for (const r of rows.slice(0, 100)) {
    out.push(await runListShape(db, r));
  }
  send(ctx.res, 200, { runs: out });
}

async function runOf(ctx: Ctx, wsId: string, rid: string): Promise<RunRow> {
  await requireWs(ctx, wsId);
  const run = await runsRepo.byId(db, rid);
  if (!run || run.workspace_id !== wsId) throw Errors.notFound();
  return run;
}

export async function runDetail(ctx: Ctx): Promise<void> {
  const run = await runOf(ctx, ctx.params.ws, ctx.params.rid);
  const item = await runListShape(db, run);
  const steps = await runStepsRepo.list(db, run.id);
  const content = run.version === null ? await draftContent(db, run.automation_id) : await versionContent(db, run.automation_id, run.version);
  const edges = content.edges;
  send(ctx.res, 200, {
    ...item,
    trigger: run.trigger_output,
    steps: steps.map((s) => ({
      id: s.step_id, kind: s.kind, name: s.name, col: s.col, row: s.row,
      status: s.status, reused: s.reused,
      input: s.step_id === "trigger" ? {} : s.input,
      output: s.step_id === "trigger" ? run.trigger_output : s.output,
      log: s.step_id === "trigger" ? (s.reused ? s.log : []) : s.log,
      attempts: s.step_id === "trigger" ? 1 : s.attempts,
      started_at: s.started_at ? new Date(s.started_at).toISOString() : null,
      finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null,
      due_at: s.due_at ? new Date(s.due_at).toISOString() : null,
      retry_at: s.retry_at ? new Date(s.retry_at).toISOString() : null,
    })),
    edges,
  });
}

export async function runCancel(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const run = await runOf(ctx, wsId, ctx.params.rid);
  if (["succeeded", "failed", "cancelled"].includes(run.status)) throw Errors.alreadyFinished(run.number);
  await cancelRun(run.id);
  const fresh = await runsRepo.byId(db, run.id);
  send(ctx.res, 200, await runListShape(db, fresh!));
}

export async function runReplay(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  await requireEditor(ctx, wsId);
  const run = await runOf(ctx, wsId, ctx.params.rid);
  if (run.status !== "failed") throw Errors.notFailedRun();
  const b = requireObject(ctx.body);
  const fromStep = typeof b.from_step === "string" ? b.from_step : "";
  const content = run.version === null ? await draftContent(db, run.automation_id) : await versionContent(db, run.automation_id, run.version);
  const steps = await runStepsRepo.list(db, run.id);
  const byId = new Map(steps.map((s) => [s.step_id, s]));
  if (!byId.has(fromStep)) throw Errors.notFound();
  const failedStep = steps.find((s) => s.status === "failed");
  if (!failedStep) throw Errors.notFailedRun();
  // replay must start at or before the failed step in first-execution order
  const ord = new Map(steps.map((s) => [s.step_id, s.ord]));
  if (ord.get(fromStep)! > ord.get(failedStep.step_id)!) throw Errors.replayAfterFailed();
  // not inside a loop body
  if (fromStep !== "trigger") {
    const loop = isInsideALoop(content, fromStep);
    if (loop) throw Errors.replayInLoop();
  }
  // steps before the chosen one are reused
  const reused = new Map<string, { status: string; output: unknown }>();
  for (const s of steps) {
    if (s.step_id === "trigger" || s.ord < ord.get(fromStep)!) {
      if (s.status === "succeeded" || s.status === "failed" || s.status === "skipped" || s.status === "cancelled") {
        reused.set(s.step_id, { status: s.status, output: s.output });
      }
    }
  }
  const newRun = await startRun({
    wsId, aid: run.automation_id, version: run.version, test: run.test,
    triggerOutput: run.trigger_output, replayOf: run.id, reused,
  });
  send(ctx.res, 201, { run_id: newRun.id, number: newRun.number });
}

// ------------------------------------------------------ intake (form, hook)

export async function formSubmit(ctx: Ctx): Promise<void> {
  const ws = await workspaces.bySlug(db, ctx.params.slug);
  if (!ws) throw Errors.notFound();
  const path = ctx.params.path;
  const autos = await automations.listForWs(db, ws.id);
  let match: AutomationRow | null = null;
  for (const a of autos) {
    if (a.trigger_kind !== "form" || a.live_version === null) continue;
    const v = await versionsRepo.get(db, a.id, a.live_version);
    if (!v) continue;
    if (String(v.content.trigger.fields.path ?? "") === path) { match = a; break; }
  }
  if (!match || match.live_version === null) throw Errors.notFound();
  const v = (await versionsRepo.get(db, match.id, match.live_version))!;
  const fields = (v.content.trigger.fields.form_fields ?? []) as { name: string; label: string; type: string }[];
  const b = requireObject(ctx.body);
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const val = b[f.name];
    if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
      throw bad(422, `${f.label} is required`, { field: f.name });
    }
    if (f.type === "number") {
      if (typeof val === "number") values[f.name] = val;
      else if (typeof val === "string" && parseDecimal(val) !== null) values[f.name] = parseDecimal(val);
      else throw bad(422, `${f.label} must be a number`, { field: f.name });
    } else {
      values[f.name] = typeof val === "string" ? val : String(val);
    }
  }
  const run = await startRun({ wsId: ws.id, aid: match.id, version: match.live_version, test: false, triggerOutput: values });
  send(ctx.res, 202, { run_id: run.id });
}

export async function hookReceive(ctx: Ctx): Promise<void> {
  const ws = await workspaces.bySlug(db, ctx.params.slug);
  if (!ws) { send(ctx.res, 404, { error: "Not found" }); return; }
  const path = ctx.params.path;
  const autos = await automations.listForWs(db, ws.id);
  let match: AutomationRow | null = null;
  for (const a of autos) {
    if (a.trigger_kind !== "webhook" || a.live_version === null) continue;
    const v = await versionsRepo.get(db, a.id, a.live_version);
    if (!v) continue;
    if (String(v.content.trigger.fields.path ?? "") === path) { match = a; break; }
  }
  if (!match || match.live_version === null) { send(ctx.res, 404, { error: "Not found" }); return; }
  const raw = ctx.rawBody;
  if (raw.length > CONFIG.webhookBodyLimit) {
    send(ctx.res, 413, { error: `Body is larger than ${CONFIG.webhookBodyLimit} bytes` });
    return;
  }
  const ct = (ctx.req.headers["content-type"] ?? "").split(";")[0].trim();
  let bodyObj: Record<string, unknown>;
  if (ct === "application/x-www-form-urlencoded") {
    bodyObj = {};
    for (const [k, v] of new URLSearchParams(raw.toString("utf8"))) bodyObj[k] = v;
  } else if (ct === "application/json") {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString("utf8")); } catch { send(ctx.res, 422, { error: "Body is not valid JSON" }); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { send(ctx.res, 422, { error: "Body must be a JSON object" }); return; }
    bodyObj = parsed as Record<string, unknown>;
  } else {
    send(ctx.res, 415, { error: "Content type must be application/json or application/x-www-form-urlencoded" });
    return;
  }
  const key = typeof ctx.req.headers["idempotency-key"] === "string" ? ctx.req.headers["idempotency-key"] : "";
  const sha = (await import("node:crypto")).createHash("sha256").update(raw).digest("hex");
  const now = await workspaceNow(db, ws.id);
  if (key !== "") {
    const existing = await idemKeys.find(db, ws.id, path, key);
    if (existing) {
      const windowMs = CONFIG.idempotencyWindowSeconds * 1000;
      if (now.getTime() - existing.created_at.getTime() <= windowMs) {
        if (existing.body_sha !== sha) {
          send(ctx.res, 409, { error: "Idempotency-Key was already used with a different body" });
          return;
        }
        send(ctx.res, 200, { run_id: existing.run_id, replayed: true });
        return;
      }
    }
  }
  const run = await startRun({ wsId: ws.id, aid: match.id, version: match.live_version, test: false, triggerOutput: bodyObj });
  if (key !== "") await idemKeys.put(db, ws.id, path, key, run.id, sha, now);
  send(ctx.res, 202, { run_id: run.id, replayed: false });
}

export async function hookMethod(ctx: Ctx): Promise<void> {
  ctx.res.setHeader("Allow", "POST");
  send(ctx.res, 405, { error: "Method not allowed" });
}

// ------------------------------------------------------------- live stream

export async function eventsStream(ctx: Ctx): Promise<void> {
  const wsId = ctx.params.ws;
  const { role } = await requireWs(ctx, wsId);
  if (!ctx.userId) throw Errors.signRequired();
  void role;
  const draftAid = ctx.query.draft ?? null;
  const me = await users.byId(db, ctx.userId);
  const client = {
    res: ctx.res, wsId, userId: ctx.userId, userName: me?.name ?? "", draftAid,
  };
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  addClient(client);
  if (draftAid) {
    // tell this new connection who is already there (excluding own other tabs
    // is handled by the hub: presence counts a user once)
    const members = draftMembers(draftAid, null).filter((m) => m.id !== ctx.userId);
    writeEvent(ctx.res, { type: "presence", workspace_id: wsId, automation_id: draftAid, members });
  }
  ctx.req.on("close", () => removeClient(client));
}

// --------------------------------------------------------------- health

export async function health(ctx: Ctx): Promise<void> {
  const { storageHealthy } = await import("./storage.js");
  const { mailHealthy } = await import("./mailer.js");
  const [s, m] = await Promise.all([storageHealthy(), mailHealthy()]);
  send(ctx.res, 200, { status: s && m ? "ok" : "unavailable" });
}
