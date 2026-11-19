import type { PoolClient } from 'pg';
import {
  type DiagramDocument,
  type Page,
  type Role,
  findLayer,
  findPage,
  pagesInOrder,
} from '../shared/document.js';
import type { Operation, OperationRequest } from '../shared/operation.js';
import type { User } from './auth.js';
import { transaction } from './db.js';
import {
  canEdit,
  lockDiagram,
  registerObjectIds,
  requireKnownIds,
  saveOutageActive,
} from './diagrams.js';
import {
  type EngineOutcome,
  type Inverse,
  DOCUMENT_FIELD,
  OperationRefusal,
  applyInverse,
  applyOperation,
  layersTouchedByInverse,
  rerouteEveryPage,
  shapeOfField,
} from '../shared/engine.js';
import { ApiError, conflict, forbiddenRole, invalidRequest, notFound, saveUnavailable } from './errors.js';
import { newId } from './ids.js';
import { broadcast, sendToUser } from './hub.js';
import { loadVersion, restoreVersionRecord } from './versions.js';

export interface OperationResponse {
  opId: string;
  seq: number;
  ids: Record<string, string>;
  rerouted: string[];
}

interface OperationRow extends Record<string, unknown> {
  seq: number;
  payload: Operation;
  response: OperationResponse;
  inverse: Inverse;
  changed_fields: string[];
  actor_id: string;
  kind: string;
}

/** The ids an operation names, which must have belonged to this diagram. */
export function referencedIds(op: Operation): string[] {
  switch (op.kind) {
    case 'add_shape':
      return [op.page, op.layer];
    case 'update_shape':
      return [op.shape, ...(op.set.layer === undefined ? [] : [op.set.layer])];
    case 'update_shapes':
      return op.shapes.flatMap((e) => [e.shape, ...(e.set.layer === undefined ? [] : [e.set.layer])]);
    case 'delete_shape':
      return [op.shape];
    case 'add_connector':
      return [op.page, op.from.shape, op.to.shape];
    case 'delete_connector':
      return [op.connector];
    case 'delete_shapes':
    case 'duplicate_shapes':
    case 'reorder_shape':
    case 'group_shapes':
      return op.shapes;
    case 'ungroup_shapes':
      return op.groups;
    case 'rename_page':
    case 'reorder_page':
    case 'delete_page':
      return [op.page];
    case 'add_layer':
      return [op.page];
    case 'rename_layer':
    case 'reorder_layer':
      return [op.layer];
    case 'set_layer_flag':
      return [op.layer];
    case 'restore_version':
      return [op.version];
    case 'add_page':
    case 'undo':
    case 'redo':
      return [];
  }
}

function sameOperation(a: Operation, b: Operation): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Key order must not decide whether two copies of an operation are the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.map(([k, v]) => [k, canonical(v)]);
  }
  return value;
}

async function loadStacks(
  client: PoolClient,
  diagramId: string,
  userId: string,
): Promise<{ undo: number[]; redo: number[] }> {
  const result = await client.query<{ undo: number[]; redo: number[] }>(
    `INSERT INTO undo_stacks (diagram_id, user_id) VALUES ($1, $2)
     ON CONFLICT (diagram_id, user_id) DO UPDATE SET diagram_id = excluded.diagram_id
     RETURNING undo, redo`,
    [diagramId, userId],
  );
  const row = result.rows[0];
  return { undo: row?.undo ?? [], redo: row?.redo ?? [] };
}

async function saveStacks(
  client: PoolClient,
  diagramId: string,
  userId: string,
  stacks: { undo: number[]; redo: number[] },
): Promise<void> {
  await client.query(
    'UPDATE undo_stacks SET undo = $3, redo = $4 WHERE diagram_id = $1 AND user_id = $2',
    [diagramId, userId, JSON.stringify(stacks.undo), JSON.stringify(stacks.redo)],
  );
}

/** The person who last set any of these fields after `afterSeq`, if it was not the actor. */
async function laterWriter(
  client: PoolClient,
  diagramId: string,
  fields: readonly string[],
  afterSeq: number,
  actorId: string,
): Promise<{ actorId: string; name: string; field: string } | null> {
  if (fields.length === 0) return null;
  const result = await client.query<{ actor_id: string; name: string; field: string }>(
    `SELECT w.actor_id, u.name, w.field
       FROM field_writers w JOIN users u ON u.id = w.actor_id
      WHERE w.diagram_id = $1 AND w.seq > $2 AND w.actor_id <> $3
        AND (w.field = ANY($4) OR w.field = $5)
      ORDER BY w.seq DESC LIMIT 1`,
    [diagramId, afterSeq, actorId, fields, DOCUMENT_FIELD],
  );
  const row = result.rows[0];
  return row ? { actorId: row.actor_id, name: row.name, field: row.field } : null;
}

/**
 * Records who set each field and reports the authors whose earlier edit this operation
 * overwrote, so each of them hears the replaced notice once.
 */
async function recordFieldWriters(
  client: PoolClient,
  diagramId: string,
  fields: readonly string[],
  actor: User,
  seq: number,
): Promise<{ userId: string; shape: string | null }[]> {
  if (fields.length === 0) return [];
  const previous = await client.query<{ field: string; actor_id: string }>(
    'SELECT field, actor_id FROM field_writers WHERE diagram_id = $1 AND field = ANY($2)',
    [diagramId, fields],
  );
  const overwritten = new Map<string, string | null>();
  for (const row of previous.rows) {
    if (row.actor_id === actor.id) continue;
    if (!overwritten.has(row.actor_id)) overwritten.set(row.actor_id, shapeOfField(row.field));
  }
  await client.query(
    `INSERT INTO field_writers (diagram_id, field, actor_id, seq)
     SELECT $1, f, $2, $3 FROM unnest($4::text[]) AS f
     ON CONFLICT (diagram_id, field) DO UPDATE SET actor_id = excluded.actor_id, seq = excluded.seq`,
    [diagramId, actor.id, seq, fields],
  );
  return [...overwritten].map(([userId, shape]) => ({ userId, shape }));
}

interface Applied {
  response: OperationResponse;
  broadcastKind: string;
  pages: Page[];
  removedPages: string[];
  order: { id: string; order: number }[];
  versionName: string | undefined;
  replaced: { userId: string; shape: string | null }[];
  skipped: { by: string; shape: string | null } | null;
  anchorChanges: { comment: string; anchored: boolean }[];
}

function pagePayload(doc: DiagramDocument, touched: readonly string[]): Page[] {
  const unique = [...new Set(touched)];
  return unique
    .map((id) => findPage(doc, id))
    .filter((page): page is Page => page !== undefined)
    .map((page) => structuredClone(page) as Page);
}

/**
 * Applies one operation: allocates its sequence number, stores it with the inverse that
 * undo needs, and reports what to broadcast. Operations on one diagram apply one at a
 * time, because the diagram row is locked for the whole transaction.
 */
export async function runOperation(
  diagramId: string,
  actor: User,
  request: OperationRequest,
): Promise<OperationResponse> {
  await requireKnownIds(diagramId, referencedIds(request.op));
  try {
    return await run(diagramId, actor, request);
  } catch (error) {
    throw error instanceof OperationRefusal ? apiErrorFor(error) : error;
  }
}

/** Maps an engine refusal onto the published API error for that state. */
function apiErrorFor(refusal: OperationRefusal): ApiError {
  switch (refusal.code) {
    case 'not_found':
      return notFound();
    case 'invalid':
      return invalidRequest(refusal.fields ?? {});
    default:
      return conflict(refusal.code, refusal.message);
  }
}

async function run(
  diagramId: string,
  actor: User,
  request: OperationRequest,
): Promise<OperationResponse> {
  const applied = await transaction<Applied | OperationResponse>(async (client) => {
    const diagram = await lockDiagram(client, diagramId);
    const roleResult = await client.query<{ role: Role }>(
      'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2',
      [diagramId, actor.id],
    );
    const role = roleResult.rows[0]?.role;
    if (role === undefined) throw forbiddenRole();

    const replay = await client.query<OperationRow>(
      'SELECT payload, response FROM operations WHERE diagram_id = $1 AND actor_id = $2 AND op_id = $3',
      [diagramId, actor.id, request.opId],
    );
    const stored = replay.rows[0];
    if (stored) {
      if (sameOperation(stored.payload, request.op)) return stored.response;
      throw conflict('op_conflict', 'That operation id was used for a different change.');
    }

    if (!canEdit(role)) throw forbiddenRole();
    if (await saveOutageActive(diagramId)) throw saveUnavailable();

    const doc = diagram.document;
    const pageIdsBefore = doc.pages.map((p) => p.id);
    const stacks = await loadStacks(client, diagramId, actor.id);

    const resolved = await resolveOperation(client, diagramId, actor, doc, request.op, stacks);

    if (resolved.kind === 'nothing') {
      await saveStacks(client, diagramId, actor.id, stacks);
      return { opId: request.opId, seq: diagram.seq, ids: {}, rerouted: [] };
    }
    if (resolved.kind === 'skipped') {
      await saveStacks(client, diagramId, actor.id, stacks);
      return {
        response: { opId: request.opId, seq: diagram.seq, ids: {}, rerouted: [] },
        broadcastKind: request.op.kind,
        pages: [],
        removedPages: [],
        order: [],
        versionName: undefined,
        replaced: [],
        skipped: { by: resolved.by, shape: resolved.shape },
        anchorChanges: [],
      } satisfies Applied;
    }

    const outcome = resolved.outcome;
    const seq = diagram.seq + 1;
    doc.seq = seq;

    const pageIdsAfter = doc.pages.map((p) => p.id);
    const removedPages = pageIdsBefore.filter((id) => !pageIdsAfter.includes(id));

    const anchorChanges = await applyCommentAnchoring(client, diagramId, outcome);

    await client.query(
      'UPDATE diagrams SET document = $2, seq = $3, updated_at = now() WHERE id = $1',
      [diagramId, JSON.stringify(doc), seq],
    );
    const response: OperationResponse = {
      opId: request.opId,
      seq,
      ids: outcome.ids,
      rerouted: outcome.rerouted,
    };
    await client.query(
      `INSERT INTO operations (diagram_id, seq, op_id, actor_id, kind, payload, response, inverse, changed_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        diagramId,
        seq,
        request.opId,
        actor.id,
        request.op.kind,
        JSON.stringify(request.op),
        JSON.stringify(response),
        JSON.stringify(outcome.inverse),
        JSON.stringify(outcome.changedFields),
      ],
    );
    await registerObjectIds(client, diagramId, outcome.created);
    const replaced = await recordFieldWriters(client, diagramId, outcome.changedFields, actor, seq);

    if (request.op.kind === 'undo') {
      stacks.redo.push(seq);
    } else if (request.op.kind === 'redo') {
      stacks.undo.push(seq);
    } else {
      stacks.undo.push(seq);
      stacks.redo.length = 0;
    }
    await saveStacks(client, diagramId, actor.id, stacks);

    const versionName =
      request.op.kind === 'restore_version'
        ? await restoreVersionRecord(client, diagramId, actor, request.op.version, doc, seq)
        : undefined;

    return {
      response,
      broadcastKind: request.op.kind,
      pages: pagePayload(doc, outcome.touchedPages),
      removedPages,
      order: pagesInOrder(doc).map((p) => ({ id: p.id, order: p.order })),
      versionName,
      replaced,
      skipped: null,
      anchorChanges,
    } satisfies Applied;
  });

  if (!('response' in applied)) return applied;

  if (applied.skipped) {
    throw new UndoSkipped(applied.skipped.by, applied.skipped.shape);
  }

  broadcast(diagramId, {
    t: 'op',
    seq: applied.response.seq,
    actor: { id: actor.id, name: actor.name },
    kind: applied.broadcastKind,
    pages: applied.pages,
    removedPages: applied.removedPages,
    order: applied.order,
    rerouted: applied.response.rerouted,
    ...(applied.versionName === undefined ? {} : { versionName: applied.versionName }),
  });
  for (const target of applied.replaced) {
    sendToUser(diagramId, target.userId, { t: 'replaced', by: actor.name, shape: target.shape });
  }
  if (applied.anchorChanges.length > 0 || applied.broadcastKind === 'restore_version') {
    broadcast(diagramId, { t: 'comments' });
  }
  if (applied.versionName !== undefined) broadcast(diagramId, { t: 'versions' });
  return applied.response;
}

/** An undo that someone else's later edit has made impossible. */
export class UndoSkipped extends Error {
  readonly by: string;
  readonly shape: string | null;

  constructor(by: string, shape: string | null) {
    super('That change cannot be undone.');
    this.by = by;
    this.shape = shape;
  }
}

async function commentAnchors(
  client: PoolClient,
  diagramId: string,
): Promise<{ id: string; shape: string; anchored: boolean }[]> {
  const result = await client.query<{ id: string; shape_id: string; anchored: boolean }>(
    'SELECT id, shape_id, anchored FROM comments WHERE diagram_id = $1 AND parent_id IS NULL',
    [diagramId],
  );
  return result.rows.map((r) => ({ id: r.id, shape: r.shape_id, anchored: r.anchored }));
}

/** A deleted shape keeps its comments unanchored; anything that brings it back anchors them. */
async function applyCommentAnchoring(
  client: PoolClient,
  diagramId: string,
  outcome: EngineOutcome,
): Promise<{ comment: string; anchored: boolean }[]> {
  const changes: { comment: string; anchored: boolean }[] = [];
  for (const [shapes, anchored] of [
    [outcome.unanchoredShapes, false],
    [outcome.anchoredShapes, true],
  ] as const) {
    if (shapes.length === 0) continue;
    const result = await client.query<{ id: string }>(
      `UPDATE comments SET anchored = $3
        WHERE diagram_id = $1 AND shape_id = ANY($2) AND anchored <> $3 RETURNING id`,
      [diagramId, shapes, anchored],
    );
    for (const row of result.rows) changes.push({ comment: row.id, anchored });
  }
  return changes;
}

type Resolved =
  | { kind: 'applied'; outcome: EngineOutcome }
  | { kind: 'skipped'; by: string; shape: string | null }
  | { kind: 'nothing' };

async function resolveOperation(
  client: PoolClient,
  diagramId: string,
  actor: User,
  doc: DiagramDocument,
  op: Operation,
  stacks: { undo: number[]; redo: number[] },
): Promise<Resolved> {
  if (op.kind === 'undo' || op.kind === 'redo') {
    return resolveUndo(client, diagramId, actor, doc, op.kind, stacks);
  }
  const version = op.kind === 'restore_version' ? await loadVersion(diagramId, op.version) : undefined;
  return {
    kind: 'applied',
    outcome: applyOperation(doc, op, {
      mintId: newId,
      versionDocument: () => version?.document,
      comments: await commentAnchors(client, diagramId),
    }),
  };
}

/**
 * Undo and redo both put back the state before one stored operation. An undo whose fields
 * someone else has since changed is skipped and its entry is dropped from the stack.
 */
async function resolveUndo(
  client: PoolClient,
  diagramId: string,
  actor: User,
  doc: DiagramDocument,
  kind: 'undo' | 'redo',
  stacks: { undo: number[]; redo: number[] },
): Promise<Resolved> {
  const stack = kind === 'undo' ? stacks.undo : stacks.redo;
  for (;;) {
    const seq = stack.pop();
    if (seq === undefined) return { kind: 'nothing' };
    const result = await client.query<OperationRow>(
      'SELECT inverse, changed_fields, kind FROM operations WHERE diagram_id = $1 AND seq = $2',
      [diagramId, seq],
    );
    const row = result.rows[0];
    if (!row) continue;

    const blocker = await laterWriter(client, diagramId, row.changed_fields, seq, actor.id);
    if (blocker) {
      return { kind: 'skipped', by: blocker.name, shape: shapeOfField(blocker.field) };
    }

    const lockedLayer = layersTouchedByInverse(doc, row.inverse)
      .map((layerId) => {
        const page = doc.pages.find((p) => findLayer(p, layerId));
        return page ? findLayer(page, layerId) : undefined;
      })
      .find((layer) => layer?.locked === true);
    if (lockedLayer) {
      const locker = await laterWriter(
        client,
        diagramId,
        [`layer:${lockedLayer.id}:locked`],
        0,
        actor.id,
      );
      return { kind: 'skipped', by: locker?.name ?? actor.name, shape: firstShapeOf(row.inverse) };
    }

    const before: Inverse = {
      pages: (row.inverse.pages ?? [])
        .map((page) => findPage(doc, page.id))
        .filter((page): page is Page => page !== undefined)
        .map((page) => structuredClone(page) as Page),
      createdPages: (row.inverse.pages ?? [])
        .filter((page) => !findPage(doc, page.id))
        .map((page) => page.id),
      pageOrder: doc.pages.map((p) => ({ id: p.id, order: p.order })),
      layerOrder: doc.pages.flatMap((p) => p.layers.map((l) => ({ page: p.id, layer: l.id, order: l.order }))),
      commentAnchors: (await commentAnchors(client, diagramId)).map((c) => ({
        comment: c.id,
        anchored: c.anchored,
      })),
    };

    const touched = applyInverse(doc, row.inverse);
    const comments = await commentAnchors(client, diagramId);
    const anchoredShapes: string[] = [];
    const unanchoredShapes: string[] = [];
    for (const comment of comments) {
      const exists = doc.pages.some((page) => page.shapes.some((s) => s.id === comment.shape));
      (exists ? anchoredShapes : unanchoredShapes).push(comment.shape);
    }
    const outcome: EngineOutcome = {
      ids: {},
      rerouted: rerouteEveryPage(doc),
      inverse: before,
      changedFields: row.changed_fields,
      created: [],
      unanchoredShapes,
      anchoredShapes,
      touchedPages: [...new Set([...touched, ...doc.pages.map((p) => p.id)])],
    };
    return { kind: 'applied', outcome };
  }
}

function firstShapeOf(inverse: Inverse): string | null {
  for (const page of inverse.pages ?? []) {
    const shape = page.shapes[0];
    if (shape) return shape.id;
  }
  return null;
}


