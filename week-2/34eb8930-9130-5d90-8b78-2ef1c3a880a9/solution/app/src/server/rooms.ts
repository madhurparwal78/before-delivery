import { config } from "./config.js";
import { newId, one, pool, rows, transaction } from "./db.js";
import { notFound, storageUnavailable } from "./errors.js";
import { type Client, send } from "./hub.js";
import { personById, personObject, personOn, rolesOn } from "./people.js";
import { StorageError, getObject, objectKey, putObject } from "./storage.js";
import {
  applyFrame, blocksOf, closeSpan, cloneProposal, decisionOps, proposalFromStyles, emptyProposal, saveState, transformFrame,
  type Change, type ProposalState, type Span,
} from "../shared/model.js";
import type {
  Comment, CommentStatus, Decision, EditMode, Mark, Op, Person, PresenceState, Range, Role, SaveState, Suggestion, SuggestionStatus,
} from "../shared/types.js";

interface Presence { lastInput: number; state: PresenceState }

interface Room {
  id: string;
  proposal: ProposalState;
  revision: number;
  savedRevision: number;
  saveFailed: boolean;
  effects: Map<number, Change[]>;
  clients: Set<Client>;
  presence: Map<string, Presence>;
  carets: Map<string, { at: number; length: number }>;
  tail: Promise<unknown>;
  writing: Promise<void> | null;
  saveTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  deleted: boolean;
}

interface StoredSuggestion { id: string; kind: Span["kind"]; authorId: string; inserted: Range | null; deleted: Range | null; contentDeleted: boolean; status: "open"; createdAt: string }
interface StoredBody { documentId: string; revision: number; text: string; blocks: ReturnType<typeof blocksOf>; marks: Mark[]; suggestions: StoredSuggestion[] }
interface Closed { id: string; status: Exclude<SuggestionStatus, "open">; decidedBy: string }
interface OpRow { revision: number; author_id: string; kind: string; mode: EditMode; ops: Op[]; created: { id: string; createdAt: string }[]; closed: Closed[]; effects: Change[] }
interface ProposalRow { id: string; revision: number; saved_revision: number; save_failed: boolean; is_seed: boolean }

const rooms = new Map<string, Promise<Room>>();
const live = new Set<Room>();

export const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Every change to a proposal runs in its own queue, so the server decides one order per proposal. */
export function serial<T>(room: Room, work: () => Promise<T>): Promise<T> {
  const run = room.tail.then(work, work);
  room.tail = run.catch(() => undefined);
  return run;
}

export function roomIfLoaded(id: string): Promise<Room> | undefined {
  return rooms.get(id);
}

export function getRoom(id: string): Promise<Room> {
  let p = rooms.get(id);
  if (!p) {
    p = load(id);
    rooms.set(id, p);
    p.then((r) => { live.add(r); scheduleEviction(r); }, () => rooms.delete(id));
  }
  return p;
}

function spanFromStored(s: StoredSuggestion): Span {
  return { id: s.id, kind: s.kind, authorId: s.authorId, inserted: s.inserted, deleted: s.deleted, contentDeleted: s.contentDeleted, createdAt: s.createdAt };
}

function replay(proposal: ProposalState, r: OpRow): void {
  let k = 0;
  const ctx = { authorId: r.author_id, mode: r.mode, newId: () => r.created[k++].id, now: r.created[0]?.createdAt ?? "" };
  applyFrame(proposal, r.ops, ctx);
  for (const c of r.closed) closeSpan(proposal, c.id, c.status, ctx);
}

type Body = Pick<Room, "proposal" | "revision" | "savedRevision" | "saveFailed" | "effects">;

/** Rebuilding a proposal (Services): its latest stored object plus the operations recorded after it. */
async function readBody(id: string): Promise<Body> {
  const row = await one<ProposalRow>("SELECT id, revision, saved_revision, save_failed, is_seed FROM proposals WHERE id = $1", [id]);
  if (!row) throw notFound();
  let proposal = emptyProposal();
  let base = 0;
  if (row.is_seed || row.saved_revision > 0) {
    if (row.saved_revision === 0) throw storageUnavailable();
    let raw: string | null;
    try { raw = await getObject(objectKey(id)); } catch (e) {
      if (e instanceof StorageError) throw storageUnavailable();
      throw e;
    }
    if (raw === null) throw storageUnavailable();
    const body = JSON.parse(raw) as StoredBody;
    proposal = proposalFromStyles(body.text, body.blocks.map((b) => b.style));
    proposal.marks = body.marks;
    proposal.spans = body.suggestions.map(spanFromStored);
    base = body.revision;
  }
  const effects = new Map<number, Change[]>();
  for (const r of await rows<OpRow>("SELECT revision, author_id, kind, mode, ops, created, closed, effects FROM ops WHERE proposal_id = $1 AND revision > $2 ORDER BY revision", [id, base])) {
    replay(proposal, r);
    effects.set(r.revision, r.effects);
  }
  const anchors = await rows<{ id: string; anchor: Range | null }>(
    "SELECT id, anchor FROM comments WHERE proposal_id = $1 AND parent_id IS NULL ORDER BY created_at, id", [id]);
  proposal.anchors = anchors.map((a) => ({ id: a.id, range: a.anchor }));
  return { proposal, revision: Math.max(row.revision, base), savedRevision: row.saved_revision, saveFailed: row.save_failed, effects };
}

async function load(id: string): Promise<Room> {
  return {
    id, ...(await readBody(id)),
    clients: new Set(), presence: new Map(), carets: new Map(), tail: Promise.resolve(), writing: null, saveTimer: null, retryTimer: null, deleted: false,
  };
}

/**
 * Opening a proposal (snapshot or join). While anyone has it open the server serves its live body;
 * when nobody has it open, the body is rebuilt from its stored object, so an unreachable store answers 503.
 */
export async function openRoom(id: string): Promise<Room> {
  const loaded = rooms.get(id);
  const room = await getRoom(id);
  if (!loaded) return room;
  return serial(room, async () => {
    if (room.clients.size === 0) {
      const body = await readBody(id);
      room.proposal = body.proposal;
      room.revision = body.revision;
      room.effects = body.effects;
      room.savedRevision = Math.max(room.savedRevision, body.savedRevision);
    }
    return room;
  });
}

/** A room nobody has open is dropped from memory once its body is saved; until then it keeps retrying the write. */
function scheduleEviction(room: Room): void {
  setTimeout(() => {
    if (room.clients.size || room.writing || room.saveTimer || room.retryTimer || room.savedRevision < room.revision || room.deleted) {
      if (!room.deleted) scheduleEviction(room);
      return;
    }
    void serial(room, async () => {
      if (room.clients.size) return;
      rooms.delete(room.id);
      live.delete(room);
    });
  }, 5000).unref();
}

export function forget(room: Room): void {
  rooms.delete(room.id);
  live.delete(room);
}

// ---- Save state (Business rules, Save state; Services, Writes and Failures)

export function saveStateOf(room: Room): SaveState {
  return saveState(room.savedRevision, room.revision, room.saveFailed, true);
}

/** The stored body object (Services, Object storage): open suggestions carry `authorId`. */
export function storedBody(proposalId: string, revision: number, proposal: ProposalState): string {
  const body: StoredBody = {
    documentId: proposalId, revision, text: proposal.text, blocks: blocksOf(proposal), marks: proposal.marks,
    suggestions: proposal.spans.map((s) => ({ ...s, status: "open" })),
  };
  return JSON.stringify(body);
}

function objectBody(room: Room): string {
  return storedBody(room.id, room.revision, room.proposal);
}

function scheduleSave(room: Room, delay = 100): void {
  if (room.deleted || room.writing || room.saveTimer || room.retryTimer) return;
  room.saveTimer = setTimeout(() => { room.saveTimer = null; room.writing = write(room).finally(() => { room.writing = null; }); }, delay);
}

async function write(room: Room): Promise<void> {
  if (room.deleted) return;
  const revision = room.revision;
  const body = objectBody(room);
  try {
    await putObject(objectKey(room.id), body);
    if (room.deleted) return;
    room.savedRevision = Math.max(room.savedRevision, revision);
    room.saveFailed = false;
    await pool.query("UPDATE proposals SET saved_revision = GREATEST(saved_revision, $2), save_failed = false WHERE id = $1", [room.id, revision]);
    broadcast(room, { type: "saved", revision });
  } catch {
    if (room.deleted) return;
    room.saveFailed = true;
    await pool.query("UPDATE proposals SET save_failed = true WHERE id = $1", [room.id]).catch(() => undefined);
    broadcast(room, { type: "save_failed", revision: room.revision });
    room.retryTimer = setTimeout(() => { room.retryTimer = null; scheduleSave(room, 0); }, 5000);
    return;
  }
  if (room.revision > room.savedRevision) setImmediate(() => scheduleSave(room, 0));
}

export async function stopSaving(room: Room): Promise<void> {
  room.deleted = true;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  if (room.retryTimer) clearTimeout(room.retryTimer);
  room.saveTimer = room.retryTimer = null;
  await room.writing;
}

export function resumeSaving(room: Room): void {
  room.deleted = false;
  if (room.revision > room.savedRevision) scheduleSave(room, 0);
}

// ---- Fan-out

export function broadcast(room: Room, frame: object, except?: Client): void {
  for (const c of room.clients) if (c !== except) send(c, frame);
}

// ---- Cards

function suggestionObject(s: Span, author: Person, status: SuggestionStatus = "open"): Suggestion {
  return { id: s.id, kind: s.kind, author, inserted: s.inserted, deleted: s.deleted, contentDeleted: s.contentDeleted, status, createdAt: s.createdAt };
}

export async function suggestionCard(s: Span, roles: Map<string, Role>): Promise<Suggestion> {
  return suggestionObject(s, await personOn(s.authorId, roles));
}

interface CommentRow { id: string; parent_id: string | null; author_id: string; body: string; mentions: string[]; anchor: Range | null; content_deleted: boolean; status: CommentStatus; created_at: Date }

export async function commentCards(room: Room, roles: Map<string, Role>, only?: string): Promise<Comment[]> {
  const list = await rows<CommentRow>(
    `SELECT id, parent_id, author_id, body, mentions, anchor, content_deleted, status, created_at FROM comments
      WHERE proposal_id = $1 ${only ? "AND (id = $2 OR parent_id = $2)" : ""} ORDER BY created_at, id`,
    only ? [room.id, only] : [room.id]);
  const anchors = new Map(room.proposal.anchors.map((a) => [a.id, a.range]));
  const top: Comment[] = [];
  const byId = new Map<string, Comment>();
  for (const r of list) {
    const author = await personOn(r.author_id, roles);
    if (r.parent_id) {
      byId.get(r.parent_id)?.replies.push({ id: r.id, author, body: r.body, createdAt: iso(r.created_at) });
      continue;
    }
    const anchor = anchors.has(r.id) ? anchors.get(r.id) ?? null : r.anchor;
    const c: Comment = {
      id: r.id, author, body: r.body, mentions: await Promise.all(r.mentions.map((m) => personOn(m, roles))),
      anchor, contentDeleted: r.content_deleted || anchor === null, status: r.status, replies: [], createdAt: iso(r.created_at),
    };
    byId.set(r.id, c);
    top.push(c);
  }
  return top;
}

// ---- Revisions

interface Revision {
  authorId: string;
  kind: "op" | "decision" | "replace_all";
  mode: EditMode;
  ops: Op[];
  created: Span[];
  withdrawn: Span[];
  closed: Closed[];
  changes: Change[];
}

/** Records one revision in PostgreSQL, then makes it live and schedules the body write. */
async function commit(room: Room, next: ProposalState, rev: Revision): Promise<number> {
  const revision = room.revision + 1;
  const closed = [...rev.closed, ...rev.withdrawn.map((s): Closed => ({ id: s.id, status: "rejected", decidedBy: s.authorId }))];
  await transaction(async (c) => {
    await c.query("INSERT INTO ops (proposal_id, revision, author_id, kind, mode, ops, created, closed, effects) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      room.id, revision, rev.authorId, rev.kind, rev.mode, JSON.stringify(rev.ops),
      JSON.stringify(rev.created.map((s) => ({ id: s.id, createdAt: s.createdAt }))), JSON.stringify(closed), JSON.stringify(rev.changes),
    ]);
    await c.query("UPDATE proposals SET revision = $2, updated_at = now() WHERE id = $1", [room.id, revision]);
    for (const s of rev.created) {
      await c.query("INSERT INTO suggestions (id, proposal_id, author_id, kind, inserted, deleted, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'open',$7)",
        [s.id, room.id, s.authorId, s.kind, JSON.stringify(s.inserted), JSON.stringify(s.deleted), s.createdAt]);
    }
    for (const x of closed) {
      await c.query("UPDATE suggestions SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1", [x.id, x.status, x.decidedBy]);
    }
    await c.query(
      `UPDATE suggestions s SET kind = x.kind, inserted = x.inserted, deleted = x.deleted, content_deleted = x.cd
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, kind text, inserted jsonb, deleted jsonb, cd boolean) WHERE s.id = x.id`,
      [JSON.stringify(next.spans.map((s) => ({ id: s.id, kind: s.kind, inserted: s.inserted, deleted: s.deleted, cd: s.contentDeleted })))]);
    await c.query(
      `UPDATE comments c SET anchor = x.anchor, content_deleted = c.content_deleted OR x.anchor IS NULL
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, anchor jsonb) WHERE c.id = x.id`,
      [JSON.stringify(next.anchors.map((a) => ({ id: a.id, anchor: a.range })))]);
  });
  room.proposal = next;
  room.revision = revision;
  room.effects.set(revision, rev.changes);
  scheduleSave(room);
  return revision;
}

async function effectsSince(room: Room, base: number): Promise<Change[][]> {
  const missing: number[] = [];
  for (let r = base + 1; r <= room.revision; r++) if (!room.effects.has(r)) missing.push(r);
  if (missing.length) {
    for (const r of await rows<{ revision: number; effects: Change[] }>("SELECT revision, effects FROM ops WHERE proposal_id = $1 AND revision = ANY($2)", [room.id, missing])) {
      room.effects.set(r.revision, r.effects);
    }
  }
  const out: Change[][] = [];
  for (let r = base + 1; r <= room.revision; r++) out.push(room.effects.get(r) ?? []);
  return out;
}

/** Card frames after a revision: added, changed, closed (suggestions) and comments whose anchor text is gone. */
async function cardFrames(room: Room, before: ProposalState, rev: Revision, decidedBy?: Person): Promise<object[]> {
  const roles = await rolesOn(room.id);
  const frames: object[] = [];
  for (const s of rev.created) {
    const live = room.proposal.spans.find((x) => x.id === s.id);
    if (live) frames.push({ type: "card_added", card: await suggestionCard(live, roles) });
  }
  const old = new Map(before.spans.map((s) => [s.id, s]));
  const createdIds = new Set(rev.created.map((s) => s.id));
  for (const s of room.proposal.spans) {
    const was = old.get(s.id);
    if (!was || createdIds.has(s.id)) continue;
    const len = (r: Range | null): number => r?.length ?? -1;
    if (was.kind !== s.kind || was.contentDeleted !== s.contentDeleted || len(was.inserted) !== len(s.inserted) || len(was.deleted) !== len(s.deleted)) {
      frames.push({ type: "card_changed", card: await suggestionCard(s, roles) });
    }
  }
  for (const s of rev.withdrawn) {
    frames.push({ type: "card_closed", cardId: s.id, status: "rejected", decidedBy: await personOn(s.authorId, roles) });
  }
  for (const c of rev.closed) {
    frames.push({ type: "card_closed", cardId: c.id, status: c.status, decidedBy: decidedBy ?? await personOn(c.decidedBy, roles) });
  }
  const oldAnchors = new Map(before.anchors.map((a) => [a.id, a.range]));
  for (const a of room.proposal.anchors) {
    if (a.range === null && oldAnchors.get(a.id)) {
      const [card] = await commentCards(room, roles, a.id);
      if (card) frames.push({ type: "card_changed", card });
    }
  }
  return frames;
}

interface OpFrame { baseRevision: number; mode: EditMode; ops: Op[] }

/** An op frame from a socket: transformed past every later change, applied, recorded, fanned out. */
export async function applyOps(room: Room, client: Client, ref: string, f: OpFrame): Promise<void> {
  let ops = f.ops;
  for (const changes of await effectsSince(room, f.baseRevision)) ops = transformFrame(ops, f.mode, changes).ops;
  const next = cloneProposal(room.proposal);
  const now = iso(new Date());
  const result = applyFrame(next, ops, { authorId: client.personId, mode: f.mode, newId, now });
  const before = room.proposal;
  const rev: Revision = { authorId: client.personId, kind: "op", mode: f.mode, ops, created: result.created, withdrawn: result.withdrawn, closed: [], changes: result.changes };
  const revision = await commit(room, next, rev);
  send(client, { type: "ack", ref, revision });
  broadcast(room, { type: "op", revision, authorId: client.personId, mode: f.mode, ops }, client);
  for (const frame of await cardFrames(room, before, rev)) broadcast(room, frame);
}

/** Replace all (Business rules, Suggestions), recorded as one revision. */
export async function applyReplaceAll(room: Room, authorId: string, mode: EditMode, ops: Op[]): Promise<number> {
  const next = cloneProposal(room.proposal);
  const result = applyFrame(next, ops, { authorId, mode, newId, now: iso(new Date()) });
  const before = room.proposal;
  const rev: Revision = { authorId, kind: "replace_all", mode, ops, created: result.created, withdrawn: result.withdrawn, closed: [], changes: result.changes };
  const revision = await commit(room, next, rev);
  broadcast(room, { type: "op", revision, authorId, mode, ops });
  for (const frame of await cardFrames(room, before, rev)) broadcast(room, frame);
  return revision;
}

interface DecisionResult { suggestionId: string; status: Exclude<SuggestionStatus, "open">; applied: boolean; decidedBy: Person; revision: number }

/**
 * First decision wins (Business rules, Decisions): runs inside the proposal's queue, so the first
 * decision the server receives for an open card applies and every later one reports the winner.
 */
export async function decideOne(room: Room, deciderId: string, suggestionId: string, decision: Decision): Promise<DecisionResult> {
  const row = await one<{ status: SuggestionStatus; decided_by: string | null }>("SELECT status, decided_by FROM suggestions WHERE id = $1 AND proposal_id = $2", [suggestionId, room.id]);
  if (!row) throw notFound();
  const roles = await rolesOn(room.id);
  const span = room.proposal.spans.find((s) => s.id === suggestionId);
  if (row.status !== "open" || !span) {
    return { suggestionId, status: row.status === "accepted" ? "accepted" : "rejected", applied: false, decidedBy: await personOn(row.decided_by ?? deciderId, roles), revision: room.revision };
  }
  const status = decision === "accept" ? "accepted" : "rejected";
  const revision = await settle(room, deciderId, [span], decision);
  return { suggestionId, status, applied: true, decidedBy: await personOn(deciderId, roles), revision };
}

/** Accept all and Reject all: every card still open when the server processes it. */
export async function decideAll(room: Room, deciderId: string, decision: Decision): Promise<{ count: number; suggestionIds: string[]; revision: number }> {
  const open = [...room.proposal.spans];
  const revision = await settle(room, deciderId, open, decision);
  return { count: open.length, suggestionIds: open.map((s) => s.id), revision };
}

async function settle(room: Room, deciderId: string, spans: Span[], decision: Decision): Promise<number> {
  const next = cloneProposal(room.proposal);
  // A suggestion holding another one's text settles first, so the decisions never split each other.
  const start = (s: Span): number => (s.deleted ?? s.inserted)?.at ?? -1;
  const order = spans.map((s) => s.id).sort((a, b) => start(next.spans.find((s) => s.id === a) as Span) - start(next.spans.find((s) => s.id === b) as Span));
  const ops: Op[] = [];
  const changes: Change[] = [];
  const created: Span[] = [];
  const status = decision === "accept" ? "accepted" : "rejected";
  const ctx = { authorId: deciderId, mode: "editing" as const, newId, now: iso(new Date()) };
  for (const id of order) {
    const s = next.spans.find((x) => x.id === id);
    if (!s) continue;
    const these = decisionOps(s, decision, next.spans);
    changes.push(...applyFrame(next, these, ctx).changes);
    ops.push(...these);
    created.push(...closeSpan(next, id, status, ctx));
  }
  const before = room.proposal;
  const rev: Revision = {
    authorId: deciderId, kind: "decision", mode: "editing", ops, created, withdrawn: [],
    closed: order.map((id) => ({ id, status, decidedBy: deciderId })), changes,
  };
  const revision = await commit(room, next, rev);
  broadcast(room, { type: "op", revision, authorId: deciderId, mode: "editing", ops });
  const decider = personObject(await personById(deciderId), (await rolesOn(room.id)).get(deciderId));
  for (const frame of await cardFrames(room, before, rev, decider)) broadcast(room, frame);
  return revision;
}

// ---- Presence (Business rules, Idle carets)

const SILENT_MS = 45000;

export async function presenceFrame(room: Room, personId: string, state: PresenceState): Promise<object> {
  return { type: "presence", person: await personOn(personId, await rolesOn(room.id)), state };
}

async function setPresence(room: Room, personId: string, state: PresenceState): Promise<void> {
  const p = room.presence.get(personId);
  if (p) p.state = state;
  try {
    await pool.query(
      "INSERT INTO presence (proposal_id, person_id, state, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (proposal_id, person_id) DO UPDATE SET state = $3, updated_at = now()",
      [room.id, personId, state]);
    const frame = await presenceFrame(room, personId, state);
    for (const c of room.clients) if (c.personId !== personId) send(c, frame);
  } catch {
    // the database is unreachable: presence is recorded again on the next change
  }
}

/** Input (op, caret or mode frame) makes a person active; heartbeats do not count. */
export function touch(room: Room, personId: string): void {
  const p = room.presence.get(personId);
  if (!p) return;
  p.lastInput = Date.now();
  if (p.state !== "active") void setPresence(room, personId, "active");
}

export async function enter(room: Room, client: Client): Promise<void> {
  room.clients.add(client);
  const p = room.presence.get(client.personId);
  if (p) { p.lastInput = Date.now(); if (p.state !== "active") await setPresence(room, client.personId, "active"); return; }
  room.presence.set(client.personId, { lastInput: Date.now(), state: "active" });
  await setPresence(room, client.personId, "active");
}

export async function leave(room: Room, client: Client): Promise<void> {
  room.clients.delete(client);
  if ([...room.clients].some((c) => c.personId === client.personId)) return;
  room.presence.delete(client.personId);
  room.carets.delete(client.personId);
  await pool.query("DELETE FROM presence WHERE proposal_id = $1 AND person_id = $2", [room.id, client.personId]).catch(() => undefined);
  if (!room.deleted) {
    const frame = await presenceFrame(room, client.personId, "left").catch(() => null);
    if (frame) broadcast(room, frame);
  }
}

export function presenceSweep(): void {
  const now = Date.now();
  for (const room of live) {
    for (const [personId, p] of room.presence) {
      const quiet = [...room.clients].filter((c) => c.personId === personId).every((c) => now - c.lastFrameAt >= SILENT_MS);
      if (quiet && p.state !== "left") void setPresence(room, personId, "left");
      else if (!quiet && p.state === "active" && now - p.lastInput >= config.idleMs) void setPresence(room, personId, "idle");
    }
  }
}

export function othersPresent(room: Room, personId: string): { personId: string; state: "active" | "idle" }[] {
  return [...room.presence].filter(([id, p]) => id !== personId && p.state !== "left").map(([id, p]) => ({ personId: id, state: p.state === "idle" ? "idle" : "active" }));
}
