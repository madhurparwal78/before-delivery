import { randomToken, config } from "../config.js";
import { bad, validation } from "../errors.js";
import { db } from "../db.js";
import { sendMail } from "../providers/mail.js";

import { copy } from "../../shared/copy.js";
import { formatExpiry } from "../../shared/format.js";
import { publishDrawingEvent } from "../live.js";
import { drawingContext } from "./drawings.js";
import { json, type Ctx } from "./accounts.js";
import { revcloudArcs } from "../domain/objects.js";
import { workspaceNow, endOfDayEpochMs, dateNotBeforeToday } from "../clock.js";

const traceCommands = new Set(["LINE", "PLINE", "CIRCLE", "REVCLOUD", "MTEXT", "ERASE"]);

export async function handleTraceCreate(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "trace");
  if (info.access === "view") throw bad("view_only");
  const body = ctx.body as { name?: string };
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) throw validation({ name: copy.traceNameError });
  const traceId = randomToken(9);
  await db.run(`insert into traces (id, drawing_id, name, state, author, created_epoch) values ($1, $2, $3, 'open', $4, $5)`, [
    traceId,
    drawingId,
    name,
    info.actor,
    Date.now(),
  ]);
  publishDrawingEvent(drawingId, "trace", { trace: { id: traceId, name, state: "open", author: info.actor, notice: null } });
  json(ctx.res, 201, {
    trace: { id: traceId, name, state: "open", author: info.actor, notice: null, objects: [] },
  });
}

export async function handleTraceGet(ctx: Ctx, traceId: string): Promise<void> {
  const row = await db.one<{ id: string; name: string; state: string; author: string; notice: string | null; drawing_id: string }>(
    `select id, name, state, author, notice, drawing_id from traces where id = $1`,
    [traceId],
  );
  if (!row) throw bad("not_found");
  await drawingContext(ctx, row.drawing_id, "read");
  const objects = await db.all<{ handle: string; record: Record<string, unknown>; seq: string }>(
    `select handle, geometry as record, seq from trace_objects where trace_id = $1 order by seq`,
    [traceId],
  );
  json(ctx.res, 200, {
    trace: {
      id: row.id,
      name: row.name,
      state: row.state,
      author: row.author,
      notice: row.notice,
      objects: objects.map((o) => ({
        handle: o.handle,
        ...((o.record.geometry ?? {}) as Record<string, unknown>),
        snaps: o.record.snaps ?? { endpoint: [], midpoint: [], center: [] },
      })),
    },
  });
}

export async function handleTraceCommand(ctx: Ctx, traceId: string): Promise<void> {
  const trace = await db.one<{
    id: string;
    name: string;
    state: string;
    author: string;
    notice: string | null;
    drawing_id: string;
    next_handle: string;
  }>(`select id, name, state, author, notice, drawing_id, next_handle from traces where id = $1`, [traceId]);
  if (!trace) throw bad("not_found");
  const info = await drawingContext(ctx, trace.drawing_id, "read");
  if (trace.author !== info.actor) throw bad("forbidden");
  if (trace.state !== "open") throw bad("trace_not_open");
  const body = ctx.body as { command?: string; args?: Record<string, unknown> };
  const command = String(body?.command ?? "").toUpperCase();
  if (!traceCommands.has(command)) throw validation({ command: "Unknown command." });
  const args = (body?.args ?? {}) as Record<string, unknown>;
  const nextHandleNumber = Number(trace.next_handle);
  let createdHandle = `T${nextHandleNumber}`;
  const record: Record<string, unknown> = { layer: "TRACE" };
  switch (command) {
    case "LINE": {
      const points = asPoints(args.points);
      if (points.length < 2) throw validation({ args: "Invalid point." });
      for (let i = 0; i + 1 < points.length; i++) {
        await insertTraceObject(traceId, `T${nextHandleNumber + i}`, "line", { start: points[i], end: points[i + 1] });
      }
      createdHandle = `T${nextHandleNumber + points.length - 2}`;
      await db.run(`update traces set next_handle = $2 where id = $1`, [traceId, nextHandleNumber + points.length - 1]);
      break;
    }
    case "PLINE": {
      const points = asPoints(args.points);
      if (points.length < 2) throw validation({ args: "Invalid point." });
      await insertTraceObject(traceId, createdHandle, "polyline", { vertices: points, closed: args.closed === true });
      await db.run(`update traces set next_handle = $2 where id = $1`, [traceId, nextHandleNumber + 1]);
      break;
    }
    case "CIRCLE": {
      const center = asPoint(args.center);
      const radius = asNumber(args.radius);
      if (radius <= 0) throw validation({ radius: "Requires a positive number." });
      await insertTraceObject(traceId, createdHandle, "circle", { center, radius });
      await db.run(`update traces set next_handle = $2 where id = $1`, [traceId, nextHandleNumber + 1]);
      break;
    }
    case "REVCLOUD": {
      const first = asPoint(args.first);
      const opposite = asPoint(args.opposite);
      await insertTraceObject(traceId, createdHandle, "revcloud", {
        first,
        opposite,
        arcs: revcloudArcs(first, opposite),
      });
      await db.run(`update traces set next_handle = $2 where id = $1`, [traceId, nextHandleNumber + 1]);
      break;
    }
    case "MTEXT": {
      const position = asPoint(args.position);
      const width = asNumber(args.width);
      const height = asNumber(args.height);
      const contents = String(args.contents ?? "");
      if (contents.trim() === "") throw validation({ contents: "Enter text." });
      if (width <= 0 || height <= 0) throw validation({ width: "Requires a positive number." });
      await insertTraceObject(traceId, createdHandle, "mtext", { position, width, height, contents });
      await db.run(`update traces set next_handle = $2 where id = $1`, [traceId, nextHandleNumber + 1]);
      break;
    }
    case "ERASE": {
      const handles = args.handles;
      if (!Array.isArray(handles)) throw validation({ handles: "No object found." });
      for (const handle of handles) {
        const row = await db.one<{ trace_id: string }>(`select trace_id from trace_objects where handle = $1`, [String(handle)]);
        if (!row || row.trace_id !== traceId) throw bad("forbidden");
        await db.run(`delete from trace_objects where trace_id = $1 and handle = $2`, [traceId, String(handle)]);
      }
      createdHandle = "";
      break;
    }
  }
  void record;
  publishDrawingEvent(trace.drawing_id, "trace", { trace: { id: traceId } });
  const objects = await db.all<{ handle: string; record: Record<string, unknown> }>(
    `select handle, geometry as record from trace_objects where trace_id = $1 order by seq`,
    [traceId],
  );
  json(ctx.res, 200, {
    trace: {
      id: traceId,
      name: trace.name,
      state: trace.state,
      author: trace.author,
      notice: trace.notice,
      objects: objects.map((o) => ({
        handle: o.handle,
        ...((o.record.geometry ?? {}) as Record<string, unknown>),
      })),
    },
  });
}

async function insertTraceObject(traceId: string, handle: string, type: string, geometry: Record<string, unknown>): Promise<void> {
  const count = await db.one<{ count: string }>(`select count(*) as count from trace_objects where trace_id = $1`, [traceId]);
  await db.run(`insert into trace_objects (trace_id, handle, seq, geometry) values ($1, $2, $3, $4)`, [
    traceId,
    handle,
    Number(count?.count ?? 0) + 1,
    JSON.stringify({ type, geometry, layer: "TRACE", color: "ByLayer", linetype: "ByLayer", linetype_scale: 1, lineweight: "ByLayer", dimension_style: "Standard", text_style: "Standard", multileader_style: "Standard", snaps: { endpoint: [], midpoint: [], center: [] } }),
  ]);
}

function asPoint(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    throw validation({ args: "Invalid point." });
  }
  return [value[0], value[1]];
}

function asPoints(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) throw validation({ args: "Invalid point." });
  return value.map(asPoint);
}

function asNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw validation({ args: "Enter a number." });
  return value;
}

export async function handleTraceSubmit(ctx: Ctx, traceId: string): Promise<void> {
  const trace = await db.one<{ id: string; name: string; state: string; author: string; drawing_id: string }>(
    `select id, name, state, author, drawing_id from traces where id = $1`,
    [traceId],
  );
  if (!trace) throw bad("not_found");
  const info = await drawingContext(ctx, trace.drawing_id, "read");
  if (trace.author !== info.actor) throw bad("forbidden");
  if (trace.state !== "open") throw bad("trace_not_open");
  const objects = await db.all<{ handle: string; record: Record<string, unknown> }>(
    `select handle, geometry as record from trace_objects where trace_id = $1 order by seq`,
    [traceId],
  );
  let issueCount = 0;
  let issueNumber = await nextIssueNumber(trace.drawing_id);
  for (const obj of objects) {
    const record = obj.record as { type?: string; geometry?: { contents?: string } };
    if (record.type === "mtext") {
      const contents = String(record.geometry?.contents ?? "");
      if (contents !== "") {
        await db.run(
          `insert into issues (drawing_id, number, trace_id, text, status) values ($1, $2, $3, $4, 'open')`,
          [trace.drawing_id, issueNumber, traceId, contents],
        );
        issueNumber += 1;
        issueCount += 1;
      }
    }
  }
  const owner = await db.one<{ email: string; name: string }>(
    `select a.email, a.name from accounts a join drawings d on d.workspace_id = a.workspace_id where d.id = $1 order by a.created_epoch limit 1`,
    [trace.drawing_id],
  );
  const drawing = await db.one<{ name: string }>(`select name from drawings where id = $1`, [trace.drawing_id]);
  let notice: "sent" | "not_sent" = "not_sent";
  if (owner) {
    const accepted = await sendMail({
      to: owner.email,
      subject: `Trace "${trace.name}" submitted on ${drawing?.name ?? ""}`,
      text: `${info.actor}\n${issueCount}`,
    });
    notice = accepted ? "sent" : "not_sent";
  }
  await db.run(`update traces set state = 'submitted', notice = $2 where id = $1`, [traceId, notice]);
  publishDrawingEvent(trace.drawing_id, "trace", { trace: { id: traceId, state: "submitted" }, submitted: { name: trace.name, reviewer: info.actor } });
  const issues = await db.all<{ number: number; trace_id: string; text: string; status: string }>(
    `select number, trace_id, text, status from issues where drawing_id = $1 order by number`,
    [trace.drawing_id],
  );
  publishDrawingEvent(trace.drawing_id, "issues", { issues });
  json(ctx.res, 200, {
    trace: { id: traceId, name: trace.name, state: "submitted", author: trace.author, notice },
  });
}

async function nextIssueNumber(drawingId: string): Promise<number> {
  const row = await db.one<{ max: string | null }>(`select max(number) as max from issues where drawing_id = $1`, [drawingId]);
  return Number(row?.max ?? 0) + 1;
}

export async function handleTraceClose(ctx: Ctx, traceId: string): Promise<void> {
  const trace = await db.one<{ id: string; name: string; state: string; author: string; drawing_id: string }>(
    `select id, name, state, author, drawing_id from traces where id = $1`,
    [traceId],
  );
  if (!trace) throw bad("not_found");
  await drawingContext(ctx, trace.drawing_id, "owner");
  if (trace.state !== "submitted") throw bad("trace_not_submitted");
  await db.run(`update traces set state = 'closed' where id = $1`, [traceId]);
  publishDrawingEvent(trace.drawing_id, "trace", { trace: { id: traceId, state: "closed" } });
  json(ctx.res, 200, { trace: { id: traceId, name: trace.name, state: "closed", author: trace.author } });
}

export async function handleIssues(ctx: Ctx, drawingId: string): Promise<void> {
  await drawingContext(ctx, drawingId, "read");
  const rows = await db.all<{ number: number; trace_id: string; text: string; status: string }>(
    `select number, trace_id, text, status from issues where drawing_id = $1 order by number`,
    [drawingId],
  );
  json(ctx.res, 200, { issues: rows });
}

export async function handleIssueResolve(ctx: Ctx, drawingId: string, number: string): Promise<void> {
  await drawingContext(ctx, drawingId, "owner");
  const row = await db.one<{ number: number; trace_id: string; text: string; status: string }>(
    `select number, trace_id, text, status from issues where drawing_id = $1 and number = $2`,
    [drawingId, Number(number)],
  );
  if (!row) throw bad("not_found");
  if (row.status === "resolved") throw bad("issue_resolved");
  await db.run(`update issues set status = 'resolved' where drawing_id = $1 and number = $2`, [drawingId, Number(number)]);
  const issues = await db.all<{ number: number; trace_id: string; text: string; status: string }>(
    `select number, trace_id, text, status from issues where drawing_id = $1 order by number`,
    [drawingId],
  );
  publishDrawingEvent(drawingId, "issues", { issues });
  json(ctx.res, 200, { issue: { ...row, status: "resolved" } });
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleShareCreate(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "owner");
  const body = ctx.body as { access?: string; recipient_email?: string; recipient_name?: string; expiry_date?: string | null };
  const access = String(body?.access ?? "");
  if (!["view", "markup", "edit"].includes(access)) throw validation({ access: "Choose an access level." });
  const email = String(body?.recipient_email ?? "").trim().toLowerCase();
  if (!emailPattern.test(email)) throw validation({ recipient_email: copy.emailError });
  const name = typeof body?.recipient_name === "string" ? body.recipient_name.trim() : "";
  const expiryDate = body?.expiry_date === null || body?.expiry_date === undefined || body?.expiry_date === "" ? null : String(body.expiry_date);
  let expiresEpoch: number | null = null;
  let expiryLabel = "Does not expire";
  if (expiryDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw validation({ expiry_date: copy.expiryFormat });
    const { epochMs } = await workspaceNow(info.workspaceId);
    if (!dateNotBeforeToday(expiryDate, epochMs, info.zone)) throw validation({ expiry_date: copy.expiryPast });
    expiresEpoch = endOfDayEpochMs(expiryDate, info.zone);
    expiryLabel = formatExpiry(expiresEpoch, info.zone);
  }
  const shareId = randomToken(9);
  const token = randomToken(32);
  const url = `${publicUrlFor()}/s/${token}`;
  await db.run(
    `insert into shares (id, drawing_id, token, access, recipient_email, recipient_name, expires_epoch, revoked, created_epoch, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9)`,
    [shareId, drawingId, token, access, email, name === "" ? null : name, expiresEpoch, Date.now(), info.actor],
  );
  json(ctx.res, 201, {
    share: {
      id: shareId,
      token,
      url,
      access,
      recipient_email: email,
      recipient_name: name === "" ? null : name,
      expires_at: expiresEpoch === null ? null : new Date(expiresEpoch).toISOString(),
      time_zone: info.zone,
      status: "active",
      expiry_label: expiryLabel,
    },
  });
}

function publicUrlFor(): string {
  return config.publicUrl;
}

export async function handleShareList(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "owner");
  const rows = await db.all<{
    id: string;
    token: string;
    access: string;
    recipient_email: string;
    recipient_name: string | null;
    expires_epoch: string | null;
    revoked: boolean;
  }>(`select id, token, access, recipient_email, recipient_name, expires_epoch, revoked from shares where drawing_id = $1 order by created_epoch desc`, [
    drawingId,
  ]);
  const { epochMs } = await workspaceNow(info.workspaceId);
  const items = rows.map((row) => {
    const status = row.revoked ? "revoked" : row.expires_epoch !== null && epochMs >= Number(row.expires_epoch) ? "expired" : "active";
    return {
      id: row.id,
      token: row.token,
      url: `${publicUrlFor()}/s/${row.token}`,
      access: row.access,
      recipient_email: row.recipient_email,
      recipient_name: row.recipient_name,
      expires_at: row.expires_epoch === null ? null : new Date(Number(row.expires_epoch)).toISOString(),
      time_zone: info.zone,
      status,
      expiry_label:
        row.expires_epoch === null ? "Does not expire" : formatExpiry(Number(row.expires_epoch), info.zone),
    };
  });
  json(ctx.res, 200, { shares: items });
}

export async function handleInvite(ctx: Ctx, shareId: string): Promise<void> {
  const share = await db.one<{
    id: string;
    drawing_id: string;
    token: string;
    access: string;
    recipient_email: string;
    recipient_name: string | null;
    expires_epoch: string | null;
    invited_epoch: string | null;
    revoked: boolean;
  }>(`select * from shares where id = $1`, [shareId]);
  if (!share) throw bad("not_found");
  const info = await drawingContext(ctx, share.drawing_id, "owner");
  const { epochMs } = await workspaceNow(info.workspaceId);
  if (share.invited_epoch !== null) {
    const elapsed = Math.floor((epochMs - Number(share.invited_epoch)) / 1000);
    const cooldown = cooldownSeconds();
    if (elapsed < cooldown) throw bad("invite_cooldown", { retry_after_seconds: cooldown - elapsed });
  }
  const drawing = await db.one<{ name: string }>(`select name from drawings where id = $1`, [share.drawing_id]);
  const accessLabel = accessLabels()[share.access as "view" | "markup" | "edit"];
  const expiryLine =
    share.expires_epoch === null ? "Does not expire" : formatExpiry(Number(share.expires_epoch), info.zone);
  const accepted = await sendMail({
    to: share.recipient_email,
    subject: `${info.actor} shared "${drawing?.name ?? ""}" with you`,
    text: `${publicUrlFor()}/s/${share.token}\n${accessLabel}\n${expiryLine}`,
  });
  if (!accepted) throw bad("mail_unavailable");
  await db.run(`update shares set invited_epoch = $2 where id = $1`, [shareId, epochMs]);
  json(ctx.res, 200, { invite: "sent", sent_to: share.recipient_email });
}

function cooldownSeconds(): number {
  return config.limits.INVITE_COOLDOWN_SECONDS;
}

function accessLabels(): Record<string, string> {
  return { view: "Can view", markup: "Can mark up", edit: "Can edit" };
}

export async function handleRevoke(ctx: Ctx, shareId: string): Promise<void> {
  const share = await db.one<{ id: string; drawing_id: string; recipient_email: string; revoked: boolean }>(
    `select id, drawing_id, recipient_email, revoked from shares where id = $1`,
    [shareId],
  );
  if (!share) throw bad("not_found");
  const info = await drawingContext(ctx, share.drawing_id, "owner");
  await db.run(`update shares set revoked = true where id = $1`, [shareId]);
  publishDrawingEvent(share.drawing_id, "link", { status: "revoked" });
  json(ctx.res, 200, {
    share: {
      id: share.id,
      token: "",
      url: "",
      access: "",
      recipient_email: share.recipient_email,
      recipient_name: null,
      expires_at: null,
      time_zone: info.zone,
      status: "revoked",
    },
  });
}

export async function handleLinkInfo(ctx: Ctx, token: string): Promise<void> {
  const share = await db.one<{
    id: string;
    drawing_id: string;
    token: string;
    access: string;
    recipient_email: string;
    recipient_name: string | null;
    expires_epoch: string | null;
    revoked: boolean;
  }>(`select id, drawing_id, token, access, recipient_email, recipient_name, expires_epoch, revoked from shares where token = $1`, [token]);
  if (!share) throw bad("not_found");
  const workspace = await db.one<{ workspace_id: string; zone: string }>(
    `select d.workspace_id, w.time_zone as zone from drawings d join workspaces w on w.id = d.workspace_id where d.id = $1`,
    [share.drawing_id],
  );
  if (!workspace) throw bad("not_found");
  const { epochMs } = await workspaceNow(workspace.workspace_id);
  if (share.revoked) throw bad("link_revoked");
  if (share.expires_epoch !== null && epochMs >= Number(share.expires_epoch)) throw bad("link_expired");
  const drawing = await db.one<{ id: string; name: string }>(`select id, name from drawings where id = $1`, [share.drawing_id]);
  json(ctx.res, 200, {
    drawing: { id: drawing?.id ?? "", name: drawing?.name ?? "" },
    access: share.access,
    status: "active",
    expires_at: share.expires_epoch === null ? null : new Date(Number(share.expires_epoch)).toISOString(),
    time_zone: workspace.zone,
    expiry_label: share.expires_epoch === null ? "Does not expire" : formatExpiry(Number(share.expires_epoch), workspace.zone),
  });
}
