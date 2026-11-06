// Workspace service: operation sequencing, conflicts, undo/redo, publish state.
// The server is the single writer: operations are applied to the stored document
// in arrival order; each accepted operation gets the next seq and is broadcast.
import { db } from './db.js';
import { applyOperation, findNodeEverywhere, findPageNode, type ApplyContext, type ApplyResult } from './operations.js';
import { HttpError, conflictError, notFound, forbiddenRole, invalid } from './errors.js';
import { newId } from './ids.js';
import type { Operation, StoredOperation } from './types.js';
import { deepClone } from './clone.js';
import type { WorkspaceDocument, DocumentNode, Role, Breakpoint } from '../shared/domain.js';

export interface WorkspaceRow { id: string; name: string; slug: string; document: WorkspaceDocument; seq: number }

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const res = await db.query<{ id: string; name: string; slug: string; document: WorkspaceDocument; seq: string }>(
    'SELECT id, name, slug, document, seq FROM workspaces WHERE id = $1', [workspaceId]);
  const row = res.rows[0];
  if (!row) return null;
  const doc = row.document;
  doc.seq = Number(row.seq);
  return { id: row.id, name: row.name, slug: row.slug, document: doc, seq: Number(row.seq) };
}

export async function saveDocument(workspaceId: string, doc: WorkspaceDocument, seq: number): Promise<void> {
  await db.query('UPDATE workspaces SET document = $1, seq = $2 WHERE id = $3', [JSON.stringify(doc), seq, workspaceId]);
}

export async function memberRole(workspaceId: string, userId: string): Promise<Role | null> {
  const res = await db.query<{ role: Role }>('SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return res.rows[0]?.role ?? null;
}

export async function imageContext(workspaceId: string): Promise<{ confirmed: Set<string>; known: Set<string> }> {
  const res = await db.query<{ id: string; status: string }>('SELECT id, status FROM images WHERE workspace_id = $1', [workspaceId]);
  const confirmed = new Set<string>(), known = new Set<string>();
  for (const r of res.rows) { known.add(r.id); if (r.status === 'confirmed') confirmed.add(r.id); }
  return { confirmed, known };
}

// ---------------------------------------------------------------------------
// Undo bookkeeping: the pre-state of each reversible operation is stored in the
// log entry under `pre`, so undo restores the exact previous value, position or
// subtree (with the same ids).

interface PreState {
  // for set_style / set_prop: the previous value at that key (undefined = unset)
  prevValue?: unknown;
  // for delete_node / move_node: the removed subtree and its old place
  subtree?: DocumentNode;
  oldParentId?: string;
  oldIndex?: number;
}

export interface OpOutcome {
  op: Operation;
  seq: number;
  created?: Record<string, string>;
  conflictFor?: { userId: string; property: string; value: string; winnerName: string };
  affectsPages: boolean;
}

const STYLE_KINDS = new Set(['set_style', 'clear_style']);
const TOKEN_KINDS = new Set(['set_token', 'rename_token', 'delete_token']);
const NAME_KINDS = new Set(['rename_node', 'rename_page']);

function styleKey(op: Operation): string {
  return `${op.nodeId as string}:${op.breakpoint as string}:${op.property as string}`;
}

function sameKey(mine: Operation, theirs: Operation): boolean {
  if (STYLE_KINDS.has(mine.kind) && (theirs.kind === 'set_style' || theirs.kind === 'clear_style')) {
    return styleKey(mine) === styleKey(theirs);
  }
  if (mine.kind === 'set_prop' && theirs.kind === 'set_prop') {
    return mine.nodeId === theirs.nodeId && mine.prop === theirs.prop;
  }
  if (TOKEN_KINDS.has(mine.kind) && TOKEN_KINDS.has(theirs.kind)) {
    return mine.name === theirs.name;
  }
  if (NAME_KINDS.has(mine.kind) && (theirs.kind === 'rename_node' || theirs.kind === 'rename_page')) {
    return mine.nodeId === theirs.nodeId && mine.pageId === theirs.pageId;
  }
  if (mine.kind === 'put_entry' && (theirs.kind === 'put_entry' || theirs.kind === 'move_entry' || theirs.kind === 'delete_entry')) {
    return mine.entryId === theirs.entryId;
  }
  if ((mine.kind === 'move_node' || mine.kind === 'insert_node' || mine.kind === 'insert_instance' || mine.kind === 'delete_node' || mine.kind === 'duplicate_node') &&
      (theirs.kind === 'move_node' || theirs.kind === 'delete_node')) {
    return mine.nodeId === theirs.nodeId;
  }
  if ((mine.kind === 'move_node' || mine.kind === 'delete_node') && theirs.kind === 'insert_node') {
    return mine.nodeId === theirs.nodeId;
  }
  if (mine.kind === 'bind_prop' && theirs.kind === 'bind_prop') {
    return mine.nodeId === theirs.nodeId;
  }
  return false;
}

export interface HandleOpOptions {
  workspaceId: string;
  userId: string;
  userName: string;
  op: Operation;
  /** Restore ops are written by the restore route itself. */
  internalRestore?: boolean;
}

export async function handleOperation(ctx: HandleOpOptions): Promise<OpOutcome> {
  const { workspaceId, userId, userName, op } = ctx;
  const ws = await getWorkspace(workspaceId);
  if (!ws) throw notFound();
  const role = await memberRole(workspaceId, userId);
  if (!role) throw notFound();
  if (role === 'viewer') throw forbiddenRole();

  // replay: an opId already accepted from this sender returns the stored ack
  if (typeof op.opId === 'string' && op.opId.length >= 1 && op.opId.length <= 64) {
    const ack = await getAck(workspaceId, userId, op.opId);
    if (ack) return { op, seq: ack.seq, created: ack.created, affectsPages: true };
  }

  if (op.kind === 'undo') return undoOperation(ctx, ws);
  if (op.kind === 'redo') return redoOperation(ctx, ws);
  if (op.kind === 'restore') throw invalid({ kind: 'restore is written only by the restore route.' });

  // validate opId
  if (typeof op.opId !== 'string' || op.opId.length < 1 || op.opId.length > 64) {
    throw invalid({ opId: 'opId is 1 to 64 characters.' });
  }

  const images = await imageContext(workspaceId);
  const applyCtx: ApplyContext = { document: ws.document, confirmedImages: images.confirmed, knownImageIds: images.known };

  // an edit to a deleted node is refused with node_deleted
  const nodeId = op.nodeId as string | undefined;
  const NODE_OP = ['set_prop', 'set_style', 'clear_style', 'move_node', 'delete_node', 'duplicate_node', 'rename_node', 'bind_prop', 'create_component', 'detach_instance'];
  if (typeof nodeId === 'string' && NODE_OP.includes(op.kind)) {
    const found = findNodeEverywhere(ws.document, nodeId);
    if (!found) {
      const name = nodeNameOf(ws.document, op);
      throw conflictError('node_deleted', `${name} was deleted by someone else.`);
    }
  }

  // capture the pre-state for undo, then apply
  const pre = capturePreState(ws.document, op);
  const result = applyOperation(applyCtx, op);

  const seq = ws.seq + 1;
  ws.document.seq = seq;

  // same-property conflict: someone else set this key after my baseSeq
  let conflictFor: OpOutcome['conflictFor'] | undefined;
  const baseSeq = typeof op.baseSeq === 'number' ? op.baseSeq : 0;
  if (STYLE_KINDS.has(op.kind) || op.kind === 'set_prop' || TOKEN_KINDS.has(op.kind)) {
    const prior = await findPriorConflicting(workspaceId, userId, op);
    if (prior && prior.seq > baseSeq) {
      conflictFor = {
        userId: prior.userId, property: propertyOf(op),
        value: valueTextOf(op), winnerName: userName,
      };
    }
  }

  await saveDocument(workspaceId, ws.document, seq);
  const logged = stripBaseSeq(op);
  await logOperation(workspaceId, seq, logged, userId, userName, result.created, pre);
  await pushStack(workspaceId, userId, 'undo', seq);
  await setAck(workspaceId, userId, op.opId, { seq, created: result.created });

  await markPublishState(workspaceId, ws.document, op, seq);
  return { op, seq, created: result.created, conflictFor, affectsPages: result.affectsPages };
}

function valueTextOf(op: Operation): string {
  const v = op.value;
  if (v === undefined || v === null) return 'nothing';
  if (typeof v === 'object') return (v as { token: string }).token ?? 'nothing';
  if (typeof v === 'string') return v;
  return String(v);
}

function propertyOf(op: Operation): string {
  if (op.kind === 'set_style' || op.kind === 'clear_style') return op.property as string;
  if (op.kind === 'set_prop') return op.prop as string;
  if (TOKEN_KINDS.has(op.kind)) return op.name as string;
  return '';
}

/** The most recent operation by someone else that set the same key. */
async function findPriorConflicting(workspaceId: string, userId: string, op: Operation): Promise<{ seq: number; userId: string } | null> {
  const res = await db.query<{ seq: string; author_id: string; kind: string; op: Operation }>(
    'SELECT seq, author_id, kind, op FROM operations WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 200', [workspaceId]);
  for (const row of res.rows) {
    if (row.author_id === userId) continue;
    if (sameKey(op, row.op)) return { seq: Number(row.seq), userId: row.author_id };
  }
  return null;
}

function nodeNameOf(doc: WorkspaceDocument, op: Operation): string {
  const id = op.nodeId as string | undefined;
  if (id) {
    const n = findNodeEverywhere(doc, id);
    if (n) return n.name;
  }
  return 'That node';
}

function capturePreState(doc: WorkspaceDocument, op: Operation): PreState | undefined {
  const nodeId = op.nodeId as string | undefined;
  switch (op.kind) {
    case 'set_style': case 'clear_style': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      const prev = node?.styles?.[op.breakpoint as Breakpoint]?.[op.property as string];
      return { prevValue: deepCloneStyleValue(prev) };
    }
    case 'set_prop': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      return { prevValue: deepClone(node?.props?.[op.prop as string]) };
    }
    case 'rename_node': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      return { prevValue: node?.name };
    }
    case 'rename_page': {
      const page = doc.pages.find((p) => p.id === op.pageId);
      return { prevValue: page?.name };
    }
    case 'set_token': {
      const t = doc.tokens.find((x) => x.name === op.name);
      return { prevValue: t ? deepClone(t) : null };
    }
    case 'rename_token': case 'delete_token': {
      const t = doc.tokens.find((x) => x.name === op.name);
      return { prevValue: t ? deepClone(t) : null };
    }
    case 'move_node': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      if (!node) return undefined;
      const parent = findParentOf(doc, node.id);
      if (!parent) return undefined;
      return { oldParentId: parent.id, oldIndex: parent.children.findIndex((c) => c.id === node.id) };
    }
    case 'delete_node': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      if (!node) return undefined;
      const parent = findParentOf(doc, node.id);
      if (!parent) return undefined;
      return { subtree: deepClone(node), oldParentId: parent.id, oldIndex: parent.children.findIndex((c) => c.id === node.id) };
    }
    case 'insert_node': case 'insert_instance': return undefined;
    case 'put_entry': {
      const e = op.entryId ? doc.collection.entries.find((x) => x.id === op.entryId) : undefined;
      return { prevValue: e ? deepClone(e.values) : null };
    }
    case 'move_entry': {
      const e = doc.collection.entries.find((x) => x.id === op.entryId);
      return { prevValue: e ? deepClone(e.order) : null };
    }
    case 'delete_entry': {
      const e = doc.collection.entries.find((x) => x.id === op.entryId);
      return { prevValue: e ? deepClone(e) : null };
    }
    case 'bind_prop': {
      const node = nodeId ? findNodeEverywhere(doc, nodeId) : null;
      return { prevValue: node?.bind ? deepClone(node.bind) : null };
    }
    case 'set_fields': return { prevValue: deepClone(doc.collection.fields) };
    case 'duplicate_node': case 'create_component': case 'detach_instance': case 'delete_component':
    case 'add_page': return undefined;
    default: return undefined;
  }
}

function deepCloneStyleValue(v: unknown): unknown {
  return v === undefined ? undefined : deepClone(v);
}

export function findParentOf(doc: WorkspaceDocument, nodeId: string): DocumentNode | null {
  const visit = (node: DocumentNode): DocumentNode | null => {
    for (const c of node.children) {
      if (c.id === nodeId) return node;
      const p = visit(c);
      if (p) return p;
    }
    return null;
  };
  for (const page of doc.pages) {
    if (page.root.id === nodeId) return null;
    const p = visit(page.root);
    if (p) return p;
  }
  for (const comp of doc.components) {
    if (comp.root.id === nodeId) return null;
    const p = visit(comp.root);
    if (p) return p;
  }
  return null;
}

async function getAck(workspaceId: string, userId: string, opId: string): Promise<{ seq: number; created?: Record<string, string> } | null> {
  const res = await db.query<{ response: { seq: number; created?: Record<string, string> } }>(
    'SELECT response FROM op_acks WHERE workspace_id = $1 AND author_id = $2 AND op_id = $3',
    [workspaceId, userId, opId]);
  return res.rows[0]?.response ?? null;
}

async function setAck(workspaceId: string, userId: string, opId: string, response: { seq: number; created?: Record<string, string> }): Promise<void> {
  await db.query(
    'INSERT INTO op_acks (workspace_id, author_id, op_id, response) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [workspaceId, userId, opId, JSON.stringify(response)]);
}

async function logOperation(
  workspaceId: string, seq: number, op: Operation, authorId: string, authorName: string,
  created: Record<string, string> | undefined, pre?: PreState,
): Promise<void> {
  await db.query(
    'INSERT INTO operations (workspace_id, seq, op_id, author_id, author_name, kind, op, created) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [workspaceId, seq, typeof op.opId === 'string' ? op.opId : null, authorId, authorName, op.kind,
      JSON.stringify({ ...op, ...(pre ? { pre } : {}) }), created ? JSON.stringify(created) : null]);
}

function stripBaseSeq(op: Operation): Operation {
  const copy = { ...op } as Record<string, unknown>;
  delete copy.baseSeq;
  return copy as unknown as Operation;
}

export async function listOperations(workspaceId: string, since: number): Promise<StoredOperation[]> {
  const res = await db.query<{ seq: string; op_id: string | null; kind: string; author_id: string; author_name: string; at: Date; op: Record<string, unknown> }>(
    'SELECT seq, op_id, kind, author_id, author_name, at, op FROM operations WHERE workspace_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT 500',
    [workspaceId, since]);
  return res.rows.map((r) => {
    const op = { ...r.op } as Record<string, unknown>;
    delete op.pre;
    return {
      seq: Number(r.seq), opId: r.op_id, kind: r.kind as StoredOperation['kind'],
      author: { id: r.author_id, name: r.author_name }, at: r.at.toISOString(), op: op as unknown as Operation,
    };
  });
}

// ---- undo / redo ---------------------------------------------------------

async function topOfStack(workspaceId: string, userId: string, kind: 'undo' | 'redo'): Promise<number | null> {
  const res = await db.query<{ seq: string }>(
    'SELECT seq FROM undo_stacks WHERE workspace_id = $1 AND user_id = $2 AND kind = $3 ORDER BY seq DESC LIMIT 1',
    [workspaceId, userId, kind]);
  return res.rows[0] ? Number(res.rows[0].seq) : null;
}

async function popStack(workspaceId: string, userId: string, kind: 'undo' | 'redo', seq: number): Promise<void> {
  await db.query('DELETE FROM undo_stacks WHERE workspace_id = $1 AND user_id = $2 AND kind = $3 AND seq = $4',
    [workspaceId, userId, kind, seq]);
}

async function pushStack(workspaceId: string, userId: string, kind: 'undo' | 'redo', seq: number): Promise<void> {
  await db.query('INSERT INTO undo_stacks (workspace_id, user_id, kind, seq) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [workspaceId, userId, kind, seq]);
}

interface LoggedRow { op: Operation; kind: string; author_id: string; author_name: string; pre?: PreState }

async function getLogged(workspaceId: string, seq: number): Promise<LoggedRow | null> {
  const res = await db.query<{ op: Record<string, unknown>; kind: string; author_id: string; author_name: string }>(
    'SELECT op, kind, author_id, author_name FROM operations WHERE workspace_id = $1 AND seq = $2', [workspaceId, seq]);
  const row = res.rows[0];
  if (!row) return null;
  const op = row.op as unknown as Operation;
  const pre = (row.op as { pre?: PreState }).pre;
  return { op, kind: row.kind, author_id: row.author_id, author_name: row.author_name, pre };
}

/** Returns the blocking author's name, or null when the undo may proceed. */
async function undoBlockedBy(workspaceId: string, userId: string, targetSeq: number, targetOp: Operation, targetKind: string): Promise<string | null> {
  const res = await db.query<{ author_id: string; author_name: string; kind: string; op: Record<string, unknown> }>(
    'SELECT author_id, author_name, kind, op FROM operations WHERE workspace_id = $1 AND seq > $2 ORDER BY seq ASC',
    [workspaceId, targetSeq]);
  const targetIsRestore = targetKind === 'restore';
  for (const r of res.rows) {
    if (r.author_id === userId) continue;
    if (targetIsRestore) return r.author_name;
    if (sameKey(targetOp, r.op as unknown as Operation)) return r.author_name;
    // a delete of the same node blocks undoes of things inside it
    if (r.kind === 'delete_node' && targetOp.nodeId && subtreeContainsId(r.op, targetOp.nodeId as string)) return r.author_name;
  }
  return null;
}

function subtreeContainsId(op: Record<string, unknown>, nodeId: string): boolean {
  // the delete's pre.subtree holds the removed ids
  const pre = (op as { pre?: { subtree?: DocumentNode } }).pre;
  if (!pre?.subtree) return false;
  return nodeContainsId(pre.subtree, nodeId) || pre.subtree.id === nodeId;
}

function nodeContainsId(node: DocumentNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((c) => nodeContainsId(c, id));
}

async function undoOperation(ctx: HandleOpOptions, ws: WorkspaceRow): Promise<OpOutcome> {
  const { workspaceId, userId, userName } = ctx;
  const target = await topOfStack(workspaceId, userId, 'undo');
  if (target === null) throw conflictError('nothing_to_undo', 'Nothing to undo.');
  const row = await getLogged(workspaceId, target);
  if (!row) { await popStack(workspaceId, userId, 'undo', target); throw conflictError('nothing_to_undo', 'Nothing to undo.'); }

  setNameLookupDoc(ws.document);
  const blocked = await undoBlockedBy(workspaceId, userId, target, row.op, row.kind);
  if (blocked) {
    await popStack(workspaceId, userId, 'undo', target);
    throw conflictError('undo_skipped', `Can't undo: ${blocked} changed ${row.kind === 'undo' ? 'it' : undoTargetName(row)} after you.`);
  }

  applyInverse(ws.document, row);

  const seq = ws.seq + 1;
  ws.document.seq = seq;
  await saveDocument(workspaceId, ws.document, seq);
  await popStack(workspaceId, userId, 'undo', target);
  await pushStack(workspaceId, userId, 'redo', seq);
  const logged: Operation = { opId: ctx.op.opId as string, kind: 'undo', target, baseSeq: 0 };
  await logOperation(workspaceId, seq, logged, userId, userName, undefined);
  await setAck(workspaceId, userId, ctx.op.opId as string, { seq });
  await markPublishState(workspaceId, ws.document, logged, seq);
  return { op: logged, seq, affectsPages: true };
}

function undoTargetName(row: LoggedRow): string {
  if (TOKEN_KINDS.has(row.kind)) return (row.op.name as string) ?? 'it';
  if (row.kind === 'rename_page') return (row.op.name as string) ?? 'it';
  const nodeId = row.op.nodeId as string | undefined;
  if (!nodeId) return 'it';
  const ref = findPageNode(latestDocForNames(), nodeId);
  return ref?.node.name ?? 'it';
}

/** The workspace document is passed by the caller for name lookups in notices. */
let nameLookupDoc: WorkspaceDocument | null = null;
export function setNameLookupDoc(doc: WorkspaceDocument | null): void { nameLookupDoc = doc; }
function latestDocForNames(): WorkspaceDocument {
  return nameLookupDoc ?? ({ pages: [], components: [] } as unknown as WorkspaceDocument);
}

async function redoOperation(ctx: HandleOpOptions, ws: WorkspaceRow): Promise<OpOutcome> {
  const { workspaceId, userId, userName } = ctx;
  const undoTarget = await topOfStack(workspaceId, userId, 'redo');
  if (undoTarget === null) throw conflictError('nothing_to_redo', 'Nothing to redo.');
  const undoRow = await getLogged(workspaceId, undoTarget);
  if (!undoRow || undoRow.kind !== 'undo') {
    await popStack(workspaceId, userId, 'redo', undoTarget);
    throw conflictError('nothing_to_redo', 'Nothing to redo.');
  }
  const originalSeq = undoRow.op.target as number;
  const original = await getLogged(workspaceId, originalSeq);
  if (!original) {
    await popStack(workspaceId, userId, 'redo', undoTarget);
    throw conflictError('nothing_to_redo', 'Nothing to redo.');
  }
  setNameLookupDoc(ws.document);
  const blocked = await undoBlockedBy(workspaceId, userId, originalSeq, original.op, original.kind);
  if (blocked) {
    await popStack(workspaceId, userId, 'redo', undoTarget);
    throw conflictError('undo_skipped', `Can't undo: ${blocked} changed ${original.kind === 'undo' ? 'it' : undoTargetName(original)} after you.`);
  }
  const images = await imageContext(workspaceId);
  const applyCtx: ApplyContext = { document: ws.document, confirmedImages: images.confirmed, knownImageIds: images.known };
  const result = applyOperation(applyCtx, { ...original.op, opId: original.op.opId, baseSeq: ws.seq });
  const seq = ws.seq + 1;
  ws.document.seq = seq;
  await saveDocument(workspaceId, ws.document, seq);
  await popStack(workspaceId, userId, 'redo', undoTarget);
  const logged: Operation = { opId: ctx.op.opId as string, kind: 'redo', target: undoTarget, baseSeq: 0 };
  await logOperation(workspaceId, seq, logged, userId, userName, result.created);
  await setAck(workspaceId, userId, ctx.op.opId as string, { seq });
  await markPublishState(workspaceId, ws.document, logged, seq);
  return { op: logged, seq, created: result.created, affectsPages: true };
}

/** Undo a logged operation using its stored pre-state. */
function applyInverse(doc: WorkspaceDocument, row: LoggedRow): void {
  const pre = row.pre;
  const op = row.op;
  switch (row.kind) {
    case 'set_style': case 'clear_style': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      if (!node) return;
      const bp = op.breakpoint as Breakpoint;
      if (!node.styles[bp]) node.styles[bp] = {};
      if (pre?.prevValue === undefined) delete node.styles[bp]![op.property as string];
      else node.styles[bp]![op.property as string] = pre.prevValue as never;
      return;
    }
    case 'set_prop': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      if (!node) return;
      if (pre?.prevValue === undefined || pre.prevValue === null) delete node.props[op.prop as string];
      else node.props[op.prop as string] = pre.prevValue;
      return;
    }
    case 'rename_node': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      if (node && typeof pre?.prevValue === 'string') node.name = pre.prevValue;
      return;
    }
    case 'rename_page': {
      const page = doc.pages.find((p) => p.id === op.pageId);
      if (page && typeof pre?.prevValue === 'string') { page.name = pre.prevValue; page.root.name = pre.prevValue; }
      return;
    }
    case 'set_token': case 'rename_token': case 'delete_token': {
      const prev = pre?.prevValue as { name: string; kind: 'color' | 'size'; value: string | number; unit?: 'px' | 'rem' } | null;
      const currentName = row.kind === 'rename_token' ? (op.newName as string) : (op.name as string);
      doc.tokens = doc.tokens.filter((t) => t.name !== currentName);
      if (prev) doc.tokens.push({ ...prev });
      if (row.kind === 'rename_token' && prev) {
        // references were rewritten to newName; put them back
        rewriteRefs(doc, currentName, prev.name);
      }
      if (row.kind === 'delete_token' && prev) {
        // references were already pointing at the token; nothing was rewritten
      }
      return;
    }
    case 'move_node': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      const oldParent = pre?.oldParentId ? findNodeEverywhere(doc, pre.oldParentId) : null;
      if (!node || !oldParent || pre?.oldIndex === undefined) return;
      const curParent = findParentOf(doc, node.id);
      if (curParent) {
        const i = curParent.children.findIndex((c) => c.id === node.id);
        if (i !== -1) curParent.children.splice(i, 1);
      }
      oldParent.children.splice(Math.min(pre.oldIndex, oldParent.children.length), 0, node);
      return;
    }
    case 'delete_node': {
      const subtree = pre?.subtree;
      const oldParent = pre?.oldParentId ? findNodeEverywhere(doc, pre.oldParentId) : null;
      if (!subtree || !oldParent || pre?.oldIndex === undefined) return;
      oldParent.children.splice(Math.min(pre.oldIndex, oldParent.children.length), 0, deepClone(subtree));
      return;
    }
    case 'insert_node': case 'insert_instance': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      if (!node) return;
      const parent = findParentOf(doc, node.id);
      if (!parent) return;
      const i = parent.children.findIndex((c) => c.id === node.id);
      if (i !== -1) parent.children.splice(i, 1);
      return;
    }
    case 'duplicate_node': {
      const copyId = op.__copyId as string | undefined;
      if (copyId) {
        const parent = findParentOf(doc, copyId);
        const copy = findNodeEverywhere(doc, copyId);
        if (parent && copy) {
          const i = parent.children.findIndex((c) => c.id === copyId);
          if (i !== -1) parent.children.splice(i, 1);
        }
      }
      return;
    }
    case 'put_entry': {
      if (op.entryId === undefined) {
        // undo the creation: remove the newest entry created by this op
        const createdId = op.__entryId as string | undefined;
        const idx = createdId ? doc.collection.entries.findIndex((e) => e.id === createdId) : -1;
        if (idx !== -1) doc.collection.entries.splice(idx, 1);
      } else {
        const e = doc.collection.entries.find((x) => x.id === op.entryId);
        if (e && pre?.prevValue) e.values = deepClone(pre.prevValue as Record<string, string>);
      }
      return;
    }
    case 'move_entry': {
      const e = doc.collection.entries.find((x) => x.id === op.entryId);
      if (e && typeof pre?.prevValue === 'number') {
        const sorted = [...doc.collection.entries].sort((a, b) => a.order - b.order);
        const from = sorted.findIndex((x) => x.id === e.id);
        sorted.splice(from, 1);
        sorted.splice(Math.min(pre.prevValue, sorted.length), 0, e);
        sorted.forEach((x, i) => { x.order = i; });
      }
      return;
    }
    case 'delete_entry': {
      const prev = pre?.prevValue as { id: string; order: number; values: Record<string, string> } | null;
      if (prev) doc.collection.entries.push(deepClone(prev));
      const sorted = [...doc.collection.entries].sort((a, b) => a.order - b.order);
      sorted.forEach((e, i) => { e.order = i; });
      return;
    }
    case 'bind_prop': {
      const node = findNodeEverywhere(doc, op.nodeId as string);
      if (!node) return;
      const prev = pre?.prevValue as Record<string, string> | null;
      if (prev) node.bind = deepClone(prev);
      else delete node.bind;
      return;
    }
    case 'set_fields': {
      if (pre?.prevValue) doc.collection.fields = deepClone(pre.prevValue as never);
      return;
    }
    default: return;
  }
}

function rewriteRefs(doc: WorkspaceDocument, from: string, to: string): void {
  const visit = (node: DocumentNode) => {
    for (const bp of ['desktop', 'tablet', 'phone'] as Breakpoint[]) {
      const styles = node.styles[bp];
      if (!styles) continue;
      for (const [k, v] of Object.entries(styles)) {
        if (typeof v === 'object' && v !== null && (v as { token: string }).token === from) {
          styles[k] = { token: to };
        }
      }
    }
    for (const c of node.children) visit(c);
  };
  for (const page of doc.pages) visit(page.root);
  for (const comp of doc.components) visit(comp.root);
}

// ---- publish state -------------------------------------------------------

interface PublishRow { id: string; page_id: string; workspace_id: string; seq: string; state: string }

async function markPublishState(workspaceId: string, doc: WorkspaceDocument, op: Operation, seq: number): Promise<void> {
  const pages = await pagesAffected(workspaceId, doc, op);
  if (pages.length === 0) return;
  for (const pageId of pages) {
    await db.query(
      'UPDATE publishes SET state = \'live_changed\' WHERE page_id = $1 AND state = \'live\'',
      [pageId]);
  }
}

async function pagesAffected(workspaceId: string, doc: WorkspaceDocument, op: Operation): Promise<string[]> {
  // any live page that this op touches becomes live_changed
  const res = await db.query<{ page_id: string }>('SELECT page_id FROM publishes WHERE workspace_id = $1 AND state = \'live\'', [workspaceId]);
  const livePages = res.rows.map((r) => r.page_id);
  if (livePages.length === 0) return [];

  const tokenUsed = TOKEN_KINDS.has(op.kind) ? op.name as string : null;
  const componentId = op.componentId as string | undefined;

  const out: string[] = [];
  for (const page of doc.pages) {
    if (!livePages.includes(page.id)) continue;
    if (op.pageId === page.id || (op.nodeId && pageContains(page.root, op.nodeId as string))) { out.push(page.id); continue; }
    if (tokenUsed && pageUsesToken(page.root, tokenUsed)) { out.push(page.id); continue; }
    if (componentId && pageHasComponent(page.root, componentId)) { out.push(page.id); continue; }
    if (['set_fields', 'put_entry', 'move_entry', 'delete_entry'].includes(op.kind) && pageHasCollectionList(page.root)) { out.push(page.id); continue; }
  }
  // page-level ops (tokens, components, collection) touch every live page that uses them
  if (TOKEN_KINDS.has(op.kind) || componentId || ['set_fields', 'put_entry', 'move_entry', 'delete_entry'].includes(op.kind)) {
    return out;
  }
  if (op.kind === 'undo' || op.kind === 'redo') {
    // conservative: any live page that changed
    return livePages;
  }
  return out;
}

function pageContains(node: DocumentNode, nodeId: string): boolean {
  if (node.id === nodeId) return true;
  return node.children.some((c) => pageContains(c, nodeId));
}

function pageUsesToken(node: DocumentNode, name: string): boolean {
  for (const bp of ['desktop', 'tablet', 'phone'] as Breakpoint[]) {
    const styles = node.styles[bp];
    if (!styles) continue;
    for (const v of Object.values(styles)) {
      if (typeof v === 'object' && v !== null && (v as { token: string }).token === name) return true;
    }
  }
  return node.children.some((c) => pageUsesToken(c, name));
}

function pageHasComponent(node: DocumentNode, componentId: string): boolean {
  if (node.shared?.componentId === componentId) return true;
  return node.children.some((c) => pageHasComponent(c, componentId));
}

function pageHasCollectionList(node: DocumentNode): boolean {
  if (node.type === 'collection_list') return true;
  return node.children.some((c) => pageHasCollectionList(c));
}

export async function publishStateOf(pageId: string): Promise<{ state: 'not_published' | 'live' | 'live_changed' | 'unpublished'; publishId: string | null; publishedSeq: number | null; url: string | null }> {
  const res = await db.query<{ id: string; state: string; seq: string }>(
    'SELECT id, state, seq FROM publishes WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1', [pageId]);
  const row = res.rows[0];
  if (!row) return { state: 'not_published', publishId: null, publishedSeq: null, url: null };
  if (row.state === 'live') {
    return { state: 'live', publishId: row.id, publishedSeq: Number(row.seq), url: null };
  }
  if (row.state === 'live_changed') {
    return { state: 'live_changed', publishId: row.id, publishedSeq: Number(row.seq), url: null };
  }
  if (row.state === 'unpublished') {
    return { state: 'unpublished', publishId: null, publishedSeq: null, url: null };
  }
  return { state: 'not_published', publishId: null, publishedSeq: null, url: null };
}

export function liveUrl(workspaceSlug: string, pageSlug: string): string {
  return `/p/${workspaceSlug}/${pageSlug}`;
}

// ---- seed helpers --------------------------------------------------------

export function newWorkspaceDocument(name: string, slug: string): WorkspaceDocument {
  return {
    id: '', name, slug, seq: 0,
    tokens: [
      { name: 'ink', kind: 'color', value: 'black' },
      { name: 'paper', kind: 'color', value: 'white' },
      { name: 'space-md', kind: 'size', value: 16, unit: 'px' },
      { name: 'size-xl', kind: 'size', value: 40, unit: 'px' },
    ],
    pages: [],
    components: [],
    collection: { name: 'Entries', fields: [], entries: [] },
  };
}

export { newId };
