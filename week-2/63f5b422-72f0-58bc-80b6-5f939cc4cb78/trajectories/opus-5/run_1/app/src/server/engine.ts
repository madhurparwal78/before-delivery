import type { PoolClient } from 'pg';
import { applyOp, applyOps, type ApplyContext } from '../shared/apply.js';
import { notices } from '../shared/notices.js';
import { OpFailure, type Op, type PublicOp } from '../shared/ops.js';
import { allNodes, findNode } from '../shared/tree.js';
import type { PlinthDocument, StyleKey } from '../shared/types.js';
import { styleValueText } from '../shared/style.js';
import { pageFingerprints } from './fingerprint.js';
import { ApiError, fromOpFailure } from './errors.js';
import { newId } from './ids.js';
import { imageIndex } from './workspaces.js';
import { withTransaction } from './db.js';

export interface OpKeys {
  nodes: string[];
  styles: string[];
  props: string[];
  names: string[];
  tokens: string[];
  moves: string[];
  everything: boolean;
  removed?: string[];
  removedNames?: Record<string, string>;
}

interface StackEntry {
  seq: number;
  keys: OpKeys;
  inverse: Op[];
  subject: string;
}

export interface ConflictReport {
  userId: string;
  property: StyleKey;
  value: string;
}

export interface AcceptedOperation {
  seq: number;
  opId: string | null;
  kind: string;
  created: Record<string, string> | undefined;
  ids: string[];
  effects: Op[] | undefined;
  body: Record<string, unknown>;
  target: number | undefined;
  conflicts: ConflictReport[];
  replayed: boolean;
}

function emptyKeys(): OpKeys {
  return { nodes: [], styles: [], props: [], names: [], tokens: [], moves: [], everything: false };
}

/** What an operation touches, used for conflicts and undo skipping. */
export function keysOf(op: Op, doc: PlinthDocument): OpKeys {
  const keys = emptyKeys();
  switch (op.kind) {
    case 'set_style':
    case 'clear_style':
      keys.nodes.push(op.nodeId);
      keys.styles.push(`${op.nodeId}|${op.breakpoint}|${op.property}`);
      break;
    case 'set_prop':
      keys.nodes.push(op.nodeId);
      keys.props.push(`${op.nodeId}|${op.prop}`);
      break;
    case 'bind_prop':
      keys.nodes.push(op.nodeId);
      keys.props.push(`${op.nodeId}|${op.prop}`);
      break;
    case 'rename_node':
      keys.nodes.push(op.nodeId);
      keys.names.push(op.nodeId);
      break;
    case 'move_node':
      keys.nodes.push(op.nodeId);
      keys.moves.push(op.nodeId);
      break;
    case 'delete_node': {
      keys.nodes.push(op.nodeId);
      keys.moves.push(op.nodeId);
      const hit = findNode(doc, op.nodeId);
      if (hit) {
        const removed = allNodes(hit.node);
        keys.removed = removed.map((node) => node.id);
        keys.removedNames = Object.fromEntries(removed.map((node) => [node.id, node.name]));
      }
      break;
    }
    case 'restore_subtree':
      keys.nodes.push(op.node.id);
      keys.moves.push(op.node.id);
      break;
    case 'duplicate_node':
    case 'detach_instance':
    case 'create_component':
      keys.nodes.push(op.nodeId);
      break;
    case 'set_token':
    case 'delete_token':
      keys.tokens.push(op.name);
      break;
    case 'rename_token':
      keys.tokens.push(op.name, op.newName);
      break;
    case 'restore':
    case 'restore_doc':
      keys.everything = true;
      break;
    default:
      break;
  }
  return keys;
}

function keysClash(mine: OpKeys, theirs: OpKeys): boolean {
  if (theirs.everything || mine.everything) return true;
  const overlap = (a: string[], b: string[]): boolean => a.some((item) => b.includes(item));
  if (overlap(mine.styles, theirs.styles)) return true;
  if (overlap(mine.props, theirs.props)) return true;
  if (overlap(mine.names, theirs.names)) return true;
  if (overlap(mine.tokens, theirs.tokens)) return true;
  if (overlap(mine.nodes, theirs.moves)) return true;
  return false;
}

function subjectOf(op: Op, doc: PlinthDocument): string {
  switch (op.kind) {
    case 'set_token':
    case 'delete_token':
    case 'rename_token':
      return op.name;
    case 'set_style':
    case 'clear_style':
    case 'set_prop':
    case 'rename_node':
    case 'move_node':
    case 'delete_node':
    case 'duplicate_node':
    case 'bind_prop':
    case 'detach_instance':
    case 'create_component':
      return findNode(doc, op.nodeId)?.node.name ?? 'that node';
    default:
      return doc.name;
  }
}

function logBody(op: Op): Record<string, unknown> {
  const body = { ...op } as Record<string, unknown>;
  delete body['kind'];
  return body;
}

interface StackRow {
  undo: StackEntry[];
  redo: StackEntry[];
}

/** A skipped undo drops its operation from the stack even though nothing changed. */
class SkippedUndo extends ApiError {
  readonly fromUndoStack: boolean;

  constructor(message: string, fromUndoStack: boolean) {
    super(409, 'undo_skipped', message);
    this.fromUndoStack = fromUndoStack;
  }
}

async function loadStacks(
  client: PoolClient,
  workspaceId: string,
  userId: string,
): Promise<StackRow> {
  const result = await client.query<{ undo: StackEntry[]; redo: StackEntry[] }>(
    'select undo, redo from undo_stacks where workspace_id = $1 and user_id = $2 for update',
    [workspaceId, userId],
  );
  const row = result.rows[0];
  return { undo: row?.undo ?? [], redo: row?.redo ?? [] };
}

async function saveStacks(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  stacks: StackRow,
): Promise<void> {
  await client.query(
    `insert into undo_stacks (workspace_id, user_id, undo, redo) values ($1, $2, $3, $4)
     on conflict (workspace_id, user_id) do update set undo = $3, redo = $4`,
    [workspaceId, userId, JSON.stringify(stacks.undo), JSON.stringify(stacks.redo)],
  );
}

interface OperationRow {
  seq: string;
  author_id: string;
  keys: OpKeys;
  kind: string;
}

async function laterOperations(
  client: PoolClient,
  workspaceId: string,
  afterSeq: number,
): Promise<OperationRow[]> {
  const result = await client.query<OperationRow>(
    'select seq, author_id, keys, kind from operations where workspace_id = $1 and seq > $2 order by seq asc',
    [workspaceId, afterSeq],
  );
  return result.rows;
}

export interface SubmitRequest {
  workspaceId: string;
  userId: string;
  opId: string;
  baseSeq: number;
  body: PublicOp;
}

interface Prepared {
  effects: Op[] | undefined;
  created: Record<string, string> | undefined;
  target: number | undefined;
  keys: OpKeys;
  logKind: string;
  logFields: Record<string, unknown>;
  stacks: StackRow;
}

export interface RestoreRequest {
  workspaceId: string;
  userId: string;
  versionId: string;
  versionName: string;
  document: PlinthDocument;
}

async function writeOperation(
  client: PoolClient,
  params: {
    workspaceId: string;
    seq: number;
    opId: string | null;
    kind: string;
    userId: string;
    body: Record<string, unknown>;
    ids: string[];
    created: Record<string, string> | undefined;
    effects: Op[] | undefined;
    keys: OpKeys;
    target: number | undefined;
  },
): Promise<string> {
  const result = await client.query<{ at: string }>(
    `insert into operations
       (workspace_id, seq, op_id, kind, author_id, body, ids, created, effects, keys, target)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning at`,
    [
      params.workspaceId,
      params.seq,
      params.opId,
      params.kind,
      params.userId,
      JSON.stringify(params.body),
      JSON.stringify(params.ids),
      params.created === undefined ? null : JSON.stringify(params.created),
      params.effects === undefined ? null : JSON.stringify(params.effects),
      JSON.stringify(params.keys),
      params.target ?? null,
    ],
  );
  return result.rows[0]!.at;
}

async function updatePublishStates(
  client: PoolClient,
  workspaceId: string,
  before: Map<string, string>,
  after: Map<string, string>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const [pageId, fingerprint] of after) {
    if (before.get(pageId) !== fingerprint) changed.push(pageId);
  }
  for (const pageId of before.keys()) {
    if (!after.has(pageId)) changed.push(pageId);
  }
  if (changed.length > 0) {
    await client.query(
      `update page_publish set state = 'live_changed'
       where workspace_id = $1 and page_id = any($2::text[]) and state = 'live'`,
      [workspaceId, changed],
    );
  }
  return changed;
}

async function conflictsFor(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  baseSeq: number,
  keys: OpKeys,
  body: PublicOp,
): Promise<ConflictReport[]> {
  if (body.kind !== 'set_style' && body.kind !== 'clear_style') return [];
  const earlier = await laterOperations(client, workspaceId, baseSeq);
  const losers = new Set<string>();
  for (const row of earlier) {
    if (row.author_id === userId) continue;
    const theirs = row.keys ?? emptyKeys();
    if ((theirs.styles ?? []).some((key) => keys.styles.includes(key))) losers.add(row.author_id);
  }
  const value = body.kind === 'set_style' ? styleValueText(body.value) : 'nothing';
  return [...losers].map((loser) => ({ userId: loser, property: body.property, value }));
}

async function prepare(
  client: PoolClient,
  doc: PlinthDocument,
  request: SubmitRequest,
  ctx: ApplyContext,
): Promise<Prepared> {
  const stacks = await loadStacks(client, request.workspaceId, request.userId);
  if (request.body.kind === 'undo' || request.body.kind === 'redo') {
    const isUndo = request.body.kind === 'undo';
    const stack = isUndo ? stacks.undo : stacks.redo;
    const entry = stack.pop();
    if (!entry) {
      throw new ApiError(
        409,
        isUndo ? 'nothing_to_undo' : 'nothing_to_redo',
        isUndo ? notices.nothingToUndo : notices.nothingToRedo,
      );
    }
    const later = await laterOperations(client, request.workspaceId, entry.seq);
    const blocker = later.find(
      (row) => row.author_id !== request.userId && keysClash(entry.keys, row.keys ?? emptyKeys()),
    );
    if (blocker) {
      const authorName = await authorNameOf(client, blocker.author_id);
      throw new SkippedUndo(notices.cantUndo(authorName, entry.subject), isUndo);
    }
    const inverse = applyOps(doc, entry.inverse, ctx);
    const next: StackEntry = {
      seq: 0,
      keys: entry.keys,
      inverse,
      subject: entry.subject,
    };
    if (isUndo) stacks.redo.push(next);
    else stacks.undo.push(next);
    return {
      effects: entry.inverse,
      created: undefined,
      target: entry.seq,
      keys: entry.keys,
      logKind: request.body.kind,
      logFields: {},
      stacks,
    };
  }
  const keys = keysOf(request.body, doc);
  const subject = subjectOf(request.body, doc);
  const result = applyOp(doc, request.body, ctx);
  stacks.redo = [];
  stacks.undo.push({ seq: 0, keys, inverse: result.inverse, subject });
  return {
    effects: undefined,
    created: result.created,
    target: undefined,
    keys,
    logKind: request.body.kind,
    logFields: logBody(request.body),
    stacks,
  };
}

/** An edit to a node another person deleted is refused and explained. */
async function deletedNodeRefusal(
  client: PoolClient,
  request: SubmitRequest,
): Promise<ApiError | undefined> {
  const body = request.body as { nodeId?: string };
  const nodeId = body.nodeId;
  if (typeof nodeId !== 'string') return undefined;
  const result = await client.query<{ author_id: string; keys: OpKeys }>(
    `select author_id, keys from operations
     where workspace_id = $1 and kind = 'delete_node'
       and keys -> 'removed' @> to_jsonb($2::text)
     order by seq desc limit 1`,
    [request.workspaceId, nodeId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const name = row.keys.removedNames?.[nodeId] ?? 'That node';
  const author = await authorNameOf(client, row.author_id);
  return new ApiError(409, 'node_deleted', notices.deletedBy(name, author));
}

async function authorNameOf(client: PoolClient, userId: string): Promise<string> {
  const result = await client.query<{ name: string }>('select name from users where id = $1', [
    userId,
  ]);
  return result.rows[0]?.name ?? 'Someone';
}

async function dropTopOfStack(
  workspaceId: string,
  userId: string,
  fromUndoStack: boolean,
): Promise<void> {
  await withTransaction(async (client) => {
    const stacks = await loadStacks(client, workspaceId, userId);
    if (fromUndoStack) stacks.undo.pop();
    else stacks.redo.pop();
    await saveStacks(client, workspaceId, userId, stacks);
  });
}

/** Numbers, applies, logs and returns one operation. */
export async function submitOperation(request: SubmitRequest): Promise<AcceptedOperation> {
  try {
    return await runSubmit(request);
  } catch (error) {
    if (error instanceof SkippedUndo) {
      await dropTopOfStack(request.workspaceId, request.userId, error.fromUndoStack);
    }
    throw error;
  }
}

async function runSubmit(request: SubmitRequest): Promise<AcceptedOperation> {
  const images = await imageIndex(request.workspaceId);
  return withTransaction(async (client) => {
    const replay = await client.query<{
      seq: string;
      created: Record<string, string> | null;
      ids: string[];
      effects: Op[] | null;
      kind: string;
      body: Record<string, unknown>;
      target: string | null;
    }>(
      `select seq, created, ids, effects, kind, body, target from operations
       where workspace_id = $1 and author_id = $2 and op_id = $3`,
      [request.workspaceId, request.userId, request.opId],
    );
    const stored = replay.rows[0];
    if (stored) {
      return {
        seq: Number(stored.seq),
        opId: request.opId,
        kind: stored.kind,
        created: stored.created ?? undefined,
        ids: stored.ids,
        effects: stored.effects ?? undefined,
        body: stored.body,
        target: stored.target === null ? undefined : Number(stored.target),
        conflicts: [],
        replayed: true,
      };
    }
    const locked = await client.query<{ doc: PlinthDocument; seq: string }>(
      'select doc, seq from workspaces where id = $1 for update',
      [request.workspaceId],
    );
    const row = locked.rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'Not found.');
    const doc: PlinthDocument = { ...row.doc, seq: Number(row.seq) };
    const before = pageFingerprints(doc);
    const issued: string[] = [];
    const ctx: ApplyContext = {
      newId: (prefix) => {
        const id = newId(prefix);
        issued.push(id);
        return id;
      },
      images,
    };
    let prepared: Prepared;
    try {
      prepared = await prepare(client, doc, request, ctx);
    } catch (error) {
      const failure = error instanceof OpFailure ? fromOpFailure(error) : error;
      if (failure instanceof ApiError && failure.status === 404) {
        const deleted = await deletedNodeRefusal(client, request);
        if (deleted) throw deleted;
      }
      throw failure;
    }
    const seq = Number(row.seq) + 1;
    const stacks = prepared.stacks;
    const top = (request.body.kind === 'undo' ? stacks.redo : stacks.undo).at(-1);
    if (top) top.seq = seq;
    await saveStacks(client, request.workspaceId, request.userId, stacks);
    doc.seq = seq;
    await client.query('update workspaces set doc = $2, seq = $3 where id = $1', [
      request.workspaceId,
      JSON.stringify(doc),
      seq,
    ]);
    const conflicts = await conflictsFor(
      client,
      request.workspaceId,
      request.userId,
      request.baseSeq,
      prepared.keys,
      request.body,
    );
    await writeOperation(client, {
      workspaceId: request.workspaceId,
      seq,
      opId: request.opId,
      kind: prepared.logKind,
      userId: request.userId,
      body:
        prepared.target === undefined
          ? prepared.logFields
          : { ...prepared.logFields, target: prepared.target },
      ids: issued,
      created: prepared.created,
      effects: prepared.effects,
      keys: prepared.keys,
      target: prepared.target,
    });
    await updatePublishStates(
      client,
      request.workspaceId,
      before,
      pageFingerprints(doc),
    );
    return {
      seq,
      opId: request.opId,
      kind: prepared.logKind,
      created: prepared.created,
      ids: issued,
      effects: prepared.effects,
      body: { kind: prepared.logKind, ...prepared.logFields },
      target: prepared.target,
      conflicts,
      replayed: false,
    };
  });
}

/** A restore is one accepted operation written only by the restore route. */
export async function submitRestore(request: RestoreRequest): Promise<AcceptedOperation> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ doc: PlinthDocument; seq: string }>(
      'select doc, seq from workspaces where id = $1 for update',
      [request.workspaceId],
    );
    const row = locked.rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'Not found.');
    const doc: PlinthDocument = { ...row.doc, seq: Number(row.seq) };
    const before = pageFingerprints(doc);
    const images = await imageIndex(request.workspaceId);
    const issued: string[] = [];
    const ctx: ApplyContext = {
      newId: (prefix) => {
        const id = newId(prefix);
        issued.push(id);
        return id;
      },
      images,
    };
    const effect: Op = { kind: 'restore_doc', document: request.document };
    const result = applyOp(doc, effect, ctx);
    const seq = Number(row.seq) + 1;
    doc.seq = seq;
    await client.query('update workspaces set doc = $2, seq = $3, name = $4, slug = $5 where id = $1', [
      request.workspaceId,
      JSON.stringify(doc),
      seq,
      doc.name,
      doc.slug,
    ]);
    const keys: OpKeys = { ...emptyKeys(), everything: true };
    const stacks = await loadStacks(client, request.workspaceId, request.userId);
    stacks.redo = [];
    stacks.undo.push({ seq, keys, inverse: result.inverse, subject: request.versionName });
    await saveStacks(client, request.workspaceId, request.userId, stacks);
    await writeOperation(client, {
      workspaceId: request.workspaceId,
      seq,
      opId: null,
      kind: 'restore',
      userId: request.userId,
      body: { versionId: request.versionId, versionName: request.versionName },
      ids: issued,
      created: undefined,
      effects: [effect],
      keys,
      target: undefined,
    });
    await updatePublishStates(client, request.workspaceId, before, pageFingerprints(doc));
    return {
      seq,
      opId: null,
      kind: 'restore',
      created: undefined,
      ids: issued,
      effects: [effect],
      body: {
        kind: 'restore',
        versionId: request.versionId,
        versionName: request.versionName,
      },
      target: undefined,
      conflicts: [],
      replayed: false,
    };
  });
}
