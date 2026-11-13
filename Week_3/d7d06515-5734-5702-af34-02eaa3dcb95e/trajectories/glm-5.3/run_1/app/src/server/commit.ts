import { db } from "./db.js";
import { bad } from "./errors.js";
import { formatTime } from "../shared/format.js";
import { workspaceNow } from "./clock.js";
import type { CommandOutcome } from "./commands.js";
import type { PoolClient } from "pg";

export interface ObjectState {
  handle: string;
  layer: string;
  type: string;
  geometry: Record<string, unknown>;
  props: Record<string, unknown>;
}

export interface CommitContext {
  drawingId: string;
  workspaceId: string;
  zone: string;
  actor: string;
  accountId: string | null;
  command: string;
}

export interface CommitResult {
  version: number;
  created: string[];
  modified: string[];
  erased: string[];
  locked: string[];
  objects: Record<string, unknown>[];
  history: string | null;
  announcement: string | null;
}

interface ObjectStateRow {
  handle: string;
  layer: string;
  type: string;
  color: string;
  linetype: string;
  linetype_scale: string;
  lineweight: string;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
  geometry: Record<string, unknown>;
}

function objectStateOf(row: ObjectStateRow): ObjectState {
  return {
    handle: row.handle,
    layer: row.layer,
    type: row.type,
    geometry: row.geometry,
    props: {
      color: row.color,
      linetype: row.linetype,
      linetype_scale: Number(row.linetype_scale),
      lineweight: row.lineweight,
      dimension_style: row.dimension_style,
      text_style: row.text_style,
      multileader_style: row.multileader_style,
    },
  };
}

export interface LayerState {
  name: string;
  color: string;
  linetype: string;
  lineweight: string;
  on?: boolean;
  is_on?: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  position: number;
}

export interface StateSnapshot {
  objects: ObjectState[];
  layers: LayerState[];
  model: { units: string; plot_style: string } | null;
}

async function readState(client: PoolClient, drawingId: string): Promise<StateSnapshot> {
  const objects = await client.query<ObjectStateRow>(
    `select handle, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry
     from objects where drawing_id = $1 order by created_epoch, handle`,
    [drawingId],
  );
  const layers = await client.query<LayerState>(
    `select name, color, linetype, lineweight, is_on as "on", frozen, locked, current, position from layers where drawing_id = $1 order by position`,
    [drawingId],
  );
  const model = await client.query<{ units: string; plot_style: string }>(
    `select units, plot_style from drawings where id = $1`,
    [drawingId],
  );
  return {
    objects: objects.rows.map(objectStateOf),
    layers: layers.rows,
    model: model.rows[0] ?? null,
  };
}

/** Every base edit runs in one transaction: version check, apply, version bump, activity. */
export async function commitCommand(
  ctx: CommitContext,
  baseVersion: number,
  apply: (client: PoolClient) => Promise<CommandOutcome>,
  handles: { nextHandle: string; maxHandleUsed: number },
  overrides?: { history?: string | null; announcement?: string | null },
): Promise<CommitResult> {
  const result = await db.tx(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [ctx.drawingId]);
    const row = await client.query<{ version: number }>(`select version from drawings where id = $1 for update`, [ctx.drawingId]);
    const currentVersion = row.rows[0]?.version;
    if (currentVersion !== baseVersion) {
      const changedRows = await client.query<{ created: string[]; modified: string[]; erased: string[] }>(
        `select created, modified, erased from versions where drawing_id = $1 and version > $2 order by version`,
        [ctx.drawingId, baseVersion],
      );
      const set = new Set<string>();
      for (const r of changedRows.rows) {
        for (const h of r.created ?? []) set.add(h);
        for (const h of r.modified ?? []) set.add(h);
        for (const h of r.erased ?? []) set.add(h);
      }
      throw bad("version_conflict", { current_version: currentVersion, changed: [...set].sort() });
    }
    const before = await readState(client, ctx.drawingId);
    const outcome = await apply(client);
    const changed =
      outcome.created.length > 0 ||
      outcome.modified.length > 0 ||
      outcome.erased.length > 0 ||
      outcome.layerChanged ||
      outcome.layoutChanged ||
      outcome.xrefChanged ||
      outcome.modelChanged !== null ||
      outcome.restored === true;
    if (!changed) {
      return {
        version: baseVersion,
        created: [] as string[],
        modified: [] as string[],
        erased: [] as string[],
        locked: outcome.locked,
        history: overrides?.history ?? outcome.history,
        announcement: overrides?.announcement ?? outcome.announcement,
        bumped: false,
      };
    }
    const newVersion = baseVersion + 1;
    const now = Date.now();
    const { epochMs } = await workspaceNow(ctx.workspaceId);
    await client.query(
      `update drawings set version = $1, modified_epoch = $2, next_handle = $3, max_handle_used = $4 where id = $5`,
      [newVersion, now, handles.nextHandle, handles.maxHandleUsed, ctx.drawingId],
    );
    const after = await readState(client, ctx.drawingId);
    const createdHandles = outcome.created.map((o) => o.handle);
    const modifiedHandles = outcome.modified.map((o) => o.handle);
    const erasedHandles = [...outcome.erased];
    await client.query(
      `insert into versions (drawing_id, version, actor, command, created_epoch, created, modified, erased, before_state, after_state, undone)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)`,
      [
        ctx.drawingId,
        newVersion,
        ctx.actor,
        ctx.command,
        now,
        JSON.stringify(createdHandles),
        JSON.stringify(modifiedHandles),
        JSON.stringify(erasedHandles),
        JSON.stringify(before),
        JSON.stringify(after),
      ],
    );
    const distinct = new Set([...createdHandles, ...modifiedHandles, ...erasedHandles]);
    const structural =
      outcome.layerChanged || outcome.layoutChanged || outcome.xrefChanged || outcome.modelChanged !== null;
    const verb = outcomeVerb(outcome);
    await client.query(
      `insert into activity (drawing_id, actor, command, count, verb, at_epoch) values ($1, $2, $3, $4, $5, $6)`,
      [ctx.drawingId, ctx.actor, ctx.command, structural ? 0 : distinct.size, verb, epochMs],
    );
    if (ctx.accountId) {
      await client.query(`insert into undo_stack (drawing_id, account_id, version) values ($1, $2, $3)`, [
        ctx.drawingId,
        ctx.accountId,
        newVersion,
      ]);
    }
    return {
      version: newVersion,
      created: createdHandles,
      modified: modifiedHandles,
      erased: erasedHandles,
      locked: outcome.locked,
      history: overrides?.history ?? outcome.history,
      announcement: overrides?.announcement ?? outcome.announcement,
      bumped: true,
    };
  });
  return {
    version: result.version,
    created: result.created,
    modified: result.modified,
    erased: result.erased,
    locked: result.locked,
    objects: [],
    history: result.history,
    announcement: result.announcement,
  };
}

function outcomeVerb(outcome: CommandOutcome): string {
  if (outcome.created.length > 0 && outcome.modified.length === 0 && outcome.erased.length === 0) return "created";
  if (outcome.erased.length > 0 && outcome.created.length === 0 && outcome.modified.length === 0) return "erased";
  return "modified";
}

export interface VersionRecord {
  version: number;
  command: string;
  actor: string;
  created: string[];
  modified: string[];
  erased: string[];
  beforeState: StateSnapshot | null;
  afterState: StateSnapshot | null;
  undone: boolean;
}

export async function versionRecord(drawingId: string, version: number): Promise<VersionRecord | null> {
  const row = await db.one<{
    version: number;
    command: string;
    actor: string;
    created: string[];
    modified: string[];
    erased: string[];
    before_state: StateSnapshot | null;
    after_state: StateSnapshot | null;
    undone: boolean;
  }>(
    `select version, command, actor, created, modified, erased, before_state, after_state, undone
     from versions where drawing_id = $1 and version = $2`,
    [drawingId, version],
  );
  if (!row) return null;
  return {
    version: row.version,
    command: row.command,
    actor: row.actor,
    created: row.created ?? [],
    modified: row.modified ?? [],
    erased: row.erased ?? [],
    beforeState: row.before_state,
    afterState: row.after_state,
    undone: row.undone,
  };
}

export async function findUndoVersion(drawingId: string, accountId: string): Promise<number | null> {
  const row = await db.one<{ version: number }>(
    `select v.version from versions v
     join undo_stack u on u.drawing_id = v.drawing_id and u.version = v.version
     where v.drawing_id = $1 and u.account_id = $2 and v.undone = false
     order by v.version desc limit 1`,
    [drawingId, accountId],
  );
  return row?.version ?? null;
}

export async function findRedoVersion(drawingId: string, accountId: string): Promise<number | null> {
  const row = await db.one<{ version: number }>(
    `select v.version from versions v
     join undo_stack u on u.drawing_id = v.drawing_id and u.version = v.version
     where v.drawing_id = $1 and u.account_id = $2 and v.undone = true
     order by v.version asc limit 1`,
    [drawingId, accountId],
  );
  return row?.version ?? null;
}

export async function setUndone(drawingId: string, version: number, undone: boolean): Promise<void> {
  await db.run(`update versions set undone = $3 where drawing_id = $1 and version = $2`, [drawingId, version, undone]);
}

/** Restores the exact stored state snapshot, inside the caller's transaction. */
export async function applyStateSnapshot(client: PoolClient, drawingId: string, state: StateSnapshot): Promise<void> {
  await client.query(`delete from objects where drawing_id = $1`, [drawingId]);
  await client.query(`delete from layers where drawing_id = $1`, [drawingId]);
  for (const layer of state.layers) {
    await client.query(
      `insert into layers (drawing_id, name, name_lower, color, linetype, lineweight, is_on, frozen, locked, current, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        drawingId,
        layer.name,
        String(layer.name).toLowerCase(),
        layer.color,
        layer.linetype,
        layer.lineweight,
        layer.is_on ?? layer.on,
        layer.frozen,
        layer.locked,
        layer.current,
        layer.position,
      ],
    );
  }
  for (const obj of state.objects) {
    await client.query(
      `insert into objects (handle, drawing_id, layer, type, color, linetype, linetype_scale, lineweight, dimension_style, text_style, multileader_style, geometry, created_epoch)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        obj.handle,
        drawingId,
        obj.layer,
        obj.type,
        obj.props.color,
        obj.props.linetype,
        obj.props.linetype_scale,
        obj.props.lineweight,
        obj.props.dimension_style,
        obj.props.text_style,
        obj.props.multileader_style,
        JSON.stringify(obj.geometry),
        Date.now(),
      ],
    );
  }
  if (state.model) {
    await client.query(`update drawings set units = $2, plot_style = $3 where id = $1`, [
      drawingId,
      state.model.units,
      state.model.plot_style,
    ]);
  }
}

export async function activityFeed(drawingId: string, zone: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  const rows = await db.all<{ at_epoch: string; actor: string; command: string; count: string; verb: string }>(
    `select at_epoch, actor, command, count, verb from activity where drawing_id = $1 order by at_epoch desc, id desc limit $2`,
    [drawingId, limit],
  );
  return rows.map((r) => {
    const count = Number(r.count);
    return {
      at: new Date(Number(r.at_epoch)).toISOString(),
      actor: r.actor,
      command: r.command,
      count,
      verb: r.verb,
      text: `${formatTime(Number(r.at_epoch), zone)} · ${r.actor} · ${r.command} · ${count === 1 ? "1 object" : `${count} objects`} ${r.verb}`,
    };
  });
}
