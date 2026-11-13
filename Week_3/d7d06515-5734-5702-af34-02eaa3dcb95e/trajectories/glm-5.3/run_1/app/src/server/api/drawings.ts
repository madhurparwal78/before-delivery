import { bad, validation } from "../errors.js";
import { db } from "../db.js";
import { round } from "../../shared/format.js";
import { copy } from "../../shared/copy.js";
import { resolveCommand } from "../../shared/commands.js";
import { loadSnapshot, objectPublic } from "../command-state.js";
import { applyCommand, makeEnv, applyLayerOp, objectCountByLayer, validLayerName } from "../commands.js";
import {
  commitCommand,
  applyStateSnapshot,
  versionRecord,
  findUndoVersion,
  findRedoVersion,
  setUndone,
  activityFeed,
  type StateSnapshot,
} from "../commit.js";
import { publishDrawingChange, publishDrawingEvent } from "../live.js";
import { workspaceNow, trialEnded } from "../clock.js";
import type { Ctx } from "./accounts.js";
import { json } from "./accounts.js";
import { collaborators } from "../presence.js";
import { intersectObjects } from "../domain/geometry.js";
import type { Point, Units, DrawingObject } from "../../shared/types.js";

export interface DrawingAccessInfo {
  drawingId: string;
  workspaceId: string;
  access: "owner" | "edit" | "markup" | "view";
  actor: string;
  accountId: string | null;
  zone: string;
  units: Units;
  plotStyle: string;
  version: number;
  trialEnded: boolean;
}

export type AccessNeed = "read" | "base" | "trace" | "owner" | "export";

/** Access, link status and trial state decided in this one place. */
export async function drawingContext(ctx: Ctx, drawingId: string, need: AccessNeed): Promise<DrawingAccessInfo> {
  const account = ctx.account;
  let access: "owner" | "edit" | "markup" | "view" | null = null;
  let actor = "";
  let accountId: string | null = null;
  const drawing = await db.one<{
    id: string;
    workspace_id: string;
    units: string;
    plot_style: string;
    version: number;
    deleted_epoch: string | null;
  }>(`select id, workspace_id, units, plot_style, version, deleted_epoch from drawings where id = $1`, [drawingId]);
  if (!drawing || drawing.deleted_epoch !== null) throw bad("not_found");
  const zoneRow = await db.one<{ zone: string }>(`select time_zone as zone from workspaces where id = $1`, [drawing.workspace_id]);
  const zone = zoneRow?.zone ?? "UTC";
  if (account && account.workspace_id === drawing.workspace_id) {
    accountId = account.id;
    actor = account.name;
    const owner = await db.one<{ id: string }>(
      `select a.id from accounts a where a.workspace_id = $1 order by a.created_epoch limit 1`,
      [drawing.workspace_id],
    );
    access = owner?.id === account.id ? "owner" : "edit";
  } else if (ctx.linkToken) {
    const share = await db.one<{
      access: string;
      recipient_email: string;
      recipient_name: string | null;
      expires_epoch: string | null;
      revoked: boolean;
    }>(
      `select access, recipient_email, recipient_name, expires_epoch, revoked from shares where token = $1 and drawing_id = $2`,
      [ctx.linkToken, drawingId],
    );
    if (!share) throw bad("not_found");
    if (share.revoked) throw bad("link_revoked");
    if (share.expires_epoch !== null) {
      const { epochMs } = await workspaceNow(drawing.workspace_id);
      if (epochMs >= Number(share.expires_epoch)) throw bad("link_expired");
    }
    access = share.access as "view" | "markup" | "edit";
    actor = share.recipient_name ?? share.recipient_email;
  }
  if (access === null) throw bad("unauthenticated");
  const ownerRow = await db.one<{ confirmed_date_key: string | null; time_zone: string }>(
    `select confirmed_date_key, time_zone from accounts where workspace_id = $1 order by created_epoch limit 1`,
    [drawing.workspace_id],
  );
  const trialOver =
    ownerRow?.confirmed_date_key !== null && ownerRow?.confirmed_date_key !== undefined
      ? await (async () => {
          const { epochMs } = await workspaceNow(drawing.workspace_id);
          return trialEnded(ownerRow.confirmed_date_key!, epochMs, ownerRow.time_zone);
        })()
      : false;
  if (need === "base") {
    if (access === "view") throw bad("view_only");
    if (access === "markup") throw bad("markup_only");
    if (trialOver) throw bad("trial_ended");
  }
  if (need === "export") {
    if (access === "view") throw bad("view_only");
    if (access === "markup") throw bad("markup_only");
  }
  if (need === "owner") {
    if (access === "view") throw bad("view_only");
    if (access === "markup") throw bad("markup_only");
    if (access !== "owner") throw bad("forbidden");
  }
  return {
    drawingId,
    workspaceId: drawing.workspace_id,
    access,
    actor,
    accountId,
    zone,
    units: drawing.units as Units,
    plotStyle: drawing.plot_style,
    version: drawing.version,
    trialEnded: trialOver,
  };
}

export async function handleDrawingGet(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "read");
  json(ctx.res, 200, await drawingDocument(info));
}

export async function drawingDocument(info: DrawingAccessInfo): Promise<Record<string, unknown>> {
  const snapshot = await loadSnapshot(info.drawingId);
  const objects = snapshot.objects.map((o) => objectPublic(o, info.units));
  const intersections = await drawingIntersections(info.drawingId);
  const counts = new Map<string, number>();
  for (const o of snapshot.objects) counts.set(o.layer, (counts.get(o.layer) ?? 0) + 1);
  const xrefRows = await db.all<{ id: string; source_drawing_id: string; name: string; status: string }>(
    `select id, source_drawing_id, name, status from xrefs where drawing_id = $1 order by id`,
    [info.drawingId],
  );
  const xrefs: Record<string, unknown>[] = [];
  for (const row of xrefRows) {
    const source = await db.one<{ deleted_epoch: string | null }>(`select deleted_epoch from drawings where id = $1`, [
      row.source_drawing_id,
    ]);
    const status = !source || source.deleted_epoch !== null ? "not_found" : row.status;
    const objectsList =
      status === "loaded"
        ? (await loadSnapshot(row.source_drawing_id)).objects.map((o) => objectPublic(o, info.units))
        : [];
    xrefs.push({ id: row.id, drawing_id: row.source_drawing_id, name: row.name, status, objects: objectsList });
  }
  const traceRows = await db.all<{
    id: string;
    name: string;
    state: string;
    author: string;
    notice: string | null;
  }>(`select id, name, state, author, notice from traces where drawing_id = $1 order by created_epoch`, [info.drawingId]);
  const traces: Record<string, unknown>[] = [];
  for (const trace of traceRows) {
    traces.push({ ...trace, objects: await traceObjectsOf(trace.id, info.units) });
  }
  const owner = await db.one<{ name: string }>(
    `select a.name from accounts a where a.workspace_id = $1 order by a.created_epoch limit 1`,
    [info.workspaceId],
  );
  return {
    id: snapshot.drawing.id,
    name: snapshot.drawing.name,
    folder_id: snapshot.drawing.folder_id,
    owner: { name: owner?.name ?? "" },
    units: info.units,
    plot_style: info.plotStyle,
    version: snapshot.drawing.version,
    access: info.access,
    layers: snapshot.layers.map((l) => ({
      name: l.name,
      color: l.color,
      linetype: l.linetype,
      lineweight: l.lineweight,
      on: l.on,
      frozen: l.frozen,
      locked: l.locked,
      current: l.current,
      objects: counts.get(l.name) ?? 0,
    })),
    objects,
    intersections,
    layouts: snapshot.layouts.map((l) => ({ name: l.name, viewport_scale: l.viewport_scale })),
    xrefs,
    traces,
  };
}

async function traceObjectsOf(traceId: string, units: Units): Promise<Record<string, unknown>[]> {
  const rows = await db.all<{ handle: string; seq: string; record: Record<string, unknown> }>(
    `select handle, seq, geometry as record from trace_objects where trace_id = $1 order by seq`,
    [traceId],
  );
  void units;
  return rows.map((r) => {
    const record = r.record as Record<string, unknown>;
    return {
      handle: r.handle,
      type: record.type as string,
      layer: record.layer as string,
      color: record.color as string,
      linetype: record.linetype as string,
      linetype_scale: record.linetype_scale as number,
      lineweight: record.lineweight as string,
      dimension_style: record.dimension_style as string,
      text_style: record.text_style as string,
      multileader_style: record.multileader_style as string,
      snaps: record.snaps ?? { endpoint: [], midpoint: [], center: [] },
      ...((record.geometry ?? {}) as Record<string, unknown>),
    };
  });
}

export async function drawingIntersections(drawingId: string): Promise<Point[]> {
  const rows = await db.all<{ geometry: Record<string, unknown>; type: string }>(
    `select o.geometry, o.type from objects o join layers l on l.drawing_id = o.drawing_id and l.name = o.layer
     where o.drawing_id = $1 and l.frozen = false and l.is_on = true`,
    [drawingId],
  );
  const items: Array<{ geometry: Record<string, unknown>; type: string }> = rows.map((r) => ({
    geometry: r.geometry,
    type: r.type,
  }));
  const xrefs = await db.all<{ source: string }>(
    `select x.source_drawing_id as source from xrefs x join drawings d on d.id = x.source_drawing_id
     where x.drawing_id = $1 and x.status = 'loaded' and d.deleted_epoch is null`,
    [drawingId],
  );
  for (const x of xrefs) {
    const xRows = await db.all<{ geometry: Record<string, unknown>; type: string }>(
      `select o.geometry, o.type from objects o join layers l on l.drawing_id = o.drawing_id and l.name = o.layer
       where o.drawing_id = $1 and l.frozen = false and l.is_on = true`,
      [x.source],
    );
    for (const r of xRows) items.push({ geometry: r.geometry, type: r.type });
  }
  return intersectObjects(items);
}

export async function handleMeasure(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "read");
  const body = ctx.body as { first?: unknown; second?: unknown };
  const first = pointOf(body?.first);
  const second = pointOf(body?.second);
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const dist = Math.hypot(dx, dy);
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const text = copy.distLine(dist.toFixed(2), `${angle.toFixed(2)}°`, dx.toFixed(2), dy.toFixed(2));
  json(ctx.res, 200, {
    distance: round(dist, 6),
    angle: round(angle, 6),
    delta_x: round(dx, 6),
    delta_y: round(dy, 6),
    text,
    units: info.units,
  });
}

function pointOf(value: unknown): Point {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    throw validation({ args: "Invalid point." });
  }
  return [value[0], value[1]];
}

export async function handleCommand(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "base");
  const body = ctx.body as { base_version?: number; command?: string; args?: Record<string, unknown> };
  if (typeof body?.command !== "string") throw validation({ command: "Unknown command." });
  const baseVersion = body?.base_version;
  if (typeof baseVersion !== "number") throw validation({ base_version: "Enter a version." });
  const args = (body.args ?? {}) as Record<string, unknown>;
  const command = body.command.toUpperCase();
  if (command === "UNDO" || command === "REDO") {
    json(ctx.res, 200, await runUndoRedo(info, command as "UNDO" | "REDO", baseVersion));
    return;
  }
  const snapshot = await loadSnapshot(drawingId);
  if (command === "LAYER" || command === "LAYOUT" || command === "XREF") {
    json(ctx.res, 200, await runStructural(info, snapshot, command, args, baseVersion));
    return;
  }
  const resolved = resolveCommand(command);
  if (!resolved) throw validation({ command: copy.unknownCommand(body.command) });
  const env = makeEnv(snapshot);
  applyCommand(env, command, args);
  const outcome = env.outcome;
  const announce = announcementFor(command, outcome);
  const result = await commitCommand(
    {
      drawingId,
      workspaceId: info.workspaceId,
      zone: info.zone,
      actor: info.actor,
      accountId: info.accountId,
      command,
    },
    baseVersion,
    async (client) => {
      await applyOutcome(client, drawingId, outcome);
      return outcome;
    },
    { nextHandle: nextHandleHex(env.allocator), maxHandleUsed: env.allocator.used },
  );
  const objects = await changedObjects(drawingId, info.units, result);
  if (result.version !== baseVersion) {
    publishDrawingChange(drawingId, {
      version: result.version,
      changed: [...result.created, ...result.modified, ...result.erased],
      actor: info.actor,
      command,
    });
    const feed = await activityFeed(drawingId, info.zone, 1);
    if (feed[0]) {
      publishDrawingEvent(drawingId, "activity", { entry: feed[0] });
    }
  }
  json(ctx.res, 200, { ...result, objects, announcement: announce });
}

function announcementFor(command: string, outcome: { created: Array<{ handle: string; type: string; geometry: Record<string, unknown> }>; announcement: string | null }): string | null {
  if (outcome.announcement) return outcome.announcement;
  if (command.startsWith("DIM")) {
    return null;
  }
  return null;
}

function nextHandleHex(allocator: { used: number }): string {
  return (allocator.used + 1).toString(16).toUpperCase();
}

async function changedObjects(drawingId: string, units: Units, result: { created: string[]; modified: string[] }): Promise<Record<string, unknown>[]> {
  if (result.created.length === 0 && result.modified.length === 0) return [];
  const snapshot = await loadSnapshot(drawingId);
  const handles = new Set([...result.created, ...result.modified]);
  return snapshot.objects.filter((o) => handles.has(o.handle)).map((o) => objectPublic(o, units));
}

/** Writes the command's outcome inside the caller's transaction. */
async function applyOutcome(
  client: import("pg").PoolClient,
  drawingId: string,
  outcome: {
    created: Array<{ handle: string; type: string; layer: string; geometry: Record<string, unknown>; props?: Record<string, unknown> }>;
    modified: Array<{ handle: string; type: string; layer: string; geometry: Record<string, unknown>; props?: Record<string, unknown> }>;
    erased: string[];
  },
): Promise<void> {
  for (const handle of outcome.erased) {
    await client.query(`delete from objects where drawing_id = $1 and handle = $2`, [drawingId, handle]);
  }
  for (const obj of outcome.modified) {
    const props = obj.props ?? defaultProps();
    await client.query(
      `update objects set layer = $3, type = $4, geometry = $5, color = $6, linetype = $7, linetype_scale = $8, lineweight = $9, dimension_style = $10, text_style = $11, multileader_style = $12
       where drawing_id = $1 and handle = $2`,
      [
        drawingId,
        obj.handle,
        obj.layer,
        obj.type,
        JSON.stringify(obj.geometry),
        props.color,
        props.linetype,
        props.linetype_scale,
        props.lineweight,
        props.dimension_style,
        props.text_style,
        props.multileader_style,
      ],
    );
  }
  for (const obj of outcome.created) {
    const props = obj.props ?? defaultProps();
    await client.query(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        obj.handle,
        drawingId,
        obj.layer,
        obj.type,
        props.color,
        props.linetype,
        props.linetype_scale,
        props.lineweight,
        props.dimension_style,
        props.text_style,
        props.multileader_style,
        JSON.stringify(obj.geometry),
        Date.now(),
      ],
    );
  }
}

export function defaultProps(): Record<string, unknown> {
  return {
    color: "ByLayer",
    linetype: "ByLayer",
    linetype_scale: 1,
    lineweight: "ByLayer",
    dimension_style: "Standard",
    text_style: "Standard",
    multileader_style: "Standard",
  };
}

async function runStructural(
  info: DrawingAccessInfo,
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  command: string,
  args: Record<string, unknown>,
  baseVersion: number,
): Promise<Record<string, unknown>> {
  const outcome = {
    ...({ created: [], modified: [], erased: [], locked: [], history: null, announcement: null, modelChanged: null } as const),
  };
  const env = makeEnv(snapshot);
  let announcement: string | null = null;
  const apply = async (client: import("pg").PoolClient): Promise<ReturnType<typeof freshOutcomeStructural>> => {
    const result = structuralOutcome(command);
    if (command === "LAYER") {
      const layers = snapshot.layers.map((l) => ({ ...l }));
      const counts = objectCountByLayer(snapshot.objects);
      const layerResult = applyLayerOp(layers, String(args.op ?? ""), args, counts);
      announcement = layerResult.announcement;
      result.layerChanged = true;
      result.announcement = layerResult.announcement;
      await client.query(`delete from layers where drawing_id = $1`, [info.drawingId]);
      let position = 0;
      for (const layer of layers) {
        await client.query(
          `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            info.drawingId,
            layer.name,
            layer.name.toLowerCase(),
            layer.color,
            layer.linetype,
            layer.lineweight,
            layer.on,
            layer.frozen,
            layer.locked,
            layer.current,
            position++,
          ],
        );
      }
      if (String(args.op) === "rename") {
        await client.query(`update objects set layer = $3 where drawing_id = $1 and layer = $2`, [
          info.drawingId,
          String(args.name),
          String(args.new_name),
        ]);
      }
      return result;
    }
    if (command === "LAYOUT") {
      const op = String(args.op ?? "");
      if (op === "new") {
        const names = snapshot.layouts.map((l) => l.name);
        let n = 1;
        while (names.includes(`Layout${n}`)) n += 1;
        await client.query(`insert into layouts (drawing_id, name, viewport_scale, position) values ($1, $2, '1:50', $3)`, [
          info.drawingId,
          `Layout${n}`,
          snapshot.layouts.length,
        ]);
      } else if (op === "scale") {
        const name = String(args.name ?? "");
        const scale = String(args.viewport_scale ?? "");
        if (!snapshot.layouts.some((l) => l.name === name)) throw validation({ name: "Choose a layout." });
        if (!["1:20", "1:50", "1:100", "1:200"].includes(scale)) throw validation({ viewport_scale: "Choose a scale." });
        await client.query(`update layouts set viewport_scale = $3 where drawing_id = $1 and name = $2`, [
          info.drawingId,
          name,
          scale,
        ]);
      } else {
        throw validation({ op: "Unknown layout operation." });
      }
      result.layoutChanged = true;
      return result;
    }
    const op = String(args.op ?? "");
    if (op === "attach") {
      const sourceId = String(args.drawing_id ?? "");
      const source = await db.one<{ id: string; name: string; workspace_id: string; deleted_epoch: string | null }>(
        `select id, name, workspace_id, deleted_epoch from drawings where id = $1`,
        [sourceId],
      );
      if (!source || source.deleted_epoch !== null || source.workspace_id !== info.workspaceId) throw bad("not_found");
      const existing = await db.one<{ id: string }>(`select id from xrefs where drawing_id = $1 and source_drawing_id = $2`, [
        info.drawingId,
        source.id,
      ]);
      if (!existing) {
        await client.query(
          `insert into xrefs (id, drawing_id, source_drawing_id, name, status) values ($1, $2, $3, $4, 'loaded')`,
          [`${info.drawingId}:${source.id}`, info.drawingId, source.id, source.name],
        );
      }
      announcement = copy.xrefAttached(source.name);
    } else if (op === "unload" || op === "reload" || op === "detach") {
      const xrefId = String(args.xref_id ?? "");
      if (op === "detach") {
        await client.query(`delete from xrefs where id = $1 and drawing_id = $2`, [xrefId, info.drawingId]);
      } else {
        await client.query(`update xrefs set status = $3 where id = $1 and drawing_id = $2`, [
          xrefId,
          info.drawingId,
          op === "unload" ? "unloaded" : "loaded",
        ]);
      }
    } else {
      throw validation({ op: "Unknown xref operation." });
    }
    result.xrefChanged = true;
    result.announcement = announcement;
    return result;
  };
  const envUnused = env;
  void envUnused;
  void outcome;
  const result = await commitCommand(
    {
      drawingId: info.drawingId,
      workspaceId: info.workspaceId,
      zone: info.zone,
      actor: info.actor,
      accountId: info.accountId,
      command,
    },
    baseVersion,
    apply,
    { nextHandle: snapshot.drawing.next_handle, maxHandleUsed: snapshot.drawing.max_handle_used },
  );
  if (result.version !== baseVersion) {
    publishDrawingChange(info.drawingId, {
      version: result.version,
      changed: [],
      actor: info.actor,
      command,
    });
    publishDrawingEvent(info.drawingId, "layer", { announcement: result.announcement });
  }
  return { ...result, objects: [] };
}

interface StructuralOutcome {
  created: never[];
  modified: never[];
  erased: never[];
  locked: never[];
  history: string | null;
  announcement: string | null;
  layerChanged: boolean;
  layoutChanged: boolean;
  xrefChanged: boolean;
  modelChanged: null;
}

function structuralOutcome(command: string): StructuralOutcome {
  void command;
  return {
    created: [],
    modified: [],
    erased: [],
    locked: [],
    history: null,
    announcement: null,
    layerChanged: false,
    layoutChanged: false,
    xrefChanged: false,
    modelChanged: null,
  };
}

function freshOutcomeStructural(): StructuralOutcome {
  return structuralOutcome("");
}

/** UNDO reverses the actor's latest change; REDO replays it. */
async function runUndoRedo(
  info: DrawingAccessInfo,
  command: "UNDO" | "REDO",
  baseVersion: number,
): Promise<Record<string, unknown>> {
  if (!info.accountId) throw bad("forbidden");
  const targetVersion =
    command === "UNDO" ? await findUndoVersion(info.drawingId, info.accountId) : await findRedoVersion(info.drawingId, info.accountId);
  if (targetVersion === null) {
    return {
      version: info.version,
      created: [],
      modified: [],
      erased: [],
      locked: [],
      objects: [],
      history: command === "UNDO" ? copy.nothingToUndo : copy.nothingToRedo,
      announcement: null,
    };
  }
  const record = await versionRecord(info.drawingId, targetVersion);
  if (!record || !record.beforeState || !record.afterState) {
    return {
      version: info.version,
      created: [],
      modified: [],
      erased: [],
      locked: [],
      objects: [],
      history: command === "UNDO" ? copy.nothingToUndo : copy.nothingToRedo,
      announcement: null,
    };
  }
  const targetState = command === "UNDO" ? record.beforeState : record.afterState;
  const historyLine = command === "UNDO" ? copy.undoLine(record.command) : copy.redoLine(record.command);
  const changedHandles = [...record.created, ...record.modified, ...record.erased];
  let applied = false;
  const result = await commitCommand(
    {
      drawingId: info.drawingId,
      workspaceId: info.workspaceId,
      zone: info.zone,
      actor: info.actor,
      accountId: info.accountId,
      command: command === "UNDO" ? "UNDO" : "REDO",
    },
    baseVersion,
    async (client) => {
      await applyStateSnapshot(client, info.drawingId, targetState);
      applied = true;
      return {
        created: [],
        modified: [],
        erased: [],
        locked: [],
        history: historyLine,
        announcement: null,
        layerChanged: false,
        layoutChanged: false,
        xrefChanged: false,
        modelChanged: null,
        restored: true,
      };
    },
    { nextHandle: await nextHandleOf(info.drawingId), maxHandleUsed: await maxHandleOf(info.drawingId) },
    { history: historyLine },
  );
  if (applied && result.version !== baseVersion) {
    await setUndone(info.drawingId, targetVersion, command === "UNDO");
    publishDrawingChange(info.drawingId, {
      version: result.version,
      changed: changedHandles,
      actor: info.actor,
      command,
    });
  }
  const objects = await objectsByHandles(info.drawingId, info.units, changedHandles);
  return { ...result, objects, announcement: null };
}

async function nextHandleOf(drawingId: string): Promise<string> {
  const row = await db.one<{ next_handle: string }>(`select next_handle from drawings where id = $1`, [drawingId]);
  return row?.next_handle ?? "10";
}

async function maxHandleOf(drawingId: string): Promise<number> {
  const row = await db.one<{ max_handle_used: number }>(`select max_handle_used from drawings where id = $1`, [drawingId]);
  return Number(row?.max_handle_used ?? 0);
}

async function objectsByHandles(drawingId: string, units: Units, handles: string[]): Promise<Record<string, unknown>[]> {
  if (handles.length === 0) return [];
  const snapshot = await loadSnapshot(drawingId);
  const set = new Set(handles);
  return snapshot.objects.filter((o) => set.has(o.handle)).map((o) => objectPublic(o, units));
}

export async function handleActivity(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "read");
  json(ctx.res, 200, { entries: await activityFeed(drawingId, info.zone) });
}

export async function handlePresencePost(ctx: Ctx, drawingId: string): Promise<void> {
  const info = await drawingContext(ctx, drawingId, "read");
  const body = ctx.body as { tab_id?: string };
  if (typeof body?.tab_id !== "string" || body.tab_id === "") throw validation({ tab_id: "Enter a tab id." });
  const { recordPresence } = await import("../presence.js");
  await recordPresence({ tabId: body.tab_id, drawingId, name: info.actor, access: info.access });
  json(ctx.res, 204, null);
}

export async function collaboratorList(drawingId: string, selfName: string | null): Promise<Array<{ name: string; state: string }>> {
  return collaborators(drawingId, selfName);
}

export function objectIsDrawing(o: Record<string, unknown>): boolean {
  return typeof o.handle === "string" && typeof o.type === "string";
}

export type DrawingObjects = DrawingObject[];
