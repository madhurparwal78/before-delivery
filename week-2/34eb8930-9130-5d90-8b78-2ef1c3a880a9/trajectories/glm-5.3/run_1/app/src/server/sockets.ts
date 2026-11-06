import type { Pool } from 'pg';
import type { WebSocket } from 'ws';
import { config } from './config.js';
import { acceptOpFrame, broadcastDoc, decideAll, decideSuggestion, enqueue, liveDocs, replaceAll, type LiveDoc } from './store.js';
import {
  accessFor, addNotice, docRoles, personById, saveMode, storedMode, type NoticeRecord, type PersonObject, type PersonRow,
} from './service.js';
import { allowedModes, clampMode, roleCan, type DomainRole, type Mode } from '../domain/types.js';
import type { Op } from '../domain/ot.js';

/** Converts internal text deltas to the wire op shapes clients understand. */
function toWireOps(ops: { ins?: string; del?: number; at?: number; mark?: string; value?: unknown; length?: number; style?: string }[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    if ('ins' in op && op.ins !== undefined) out.push({ insert: op.ins, at: op.at ?? 0 });
    else if ('del' in op && op.del !== undefined) out.push({ delete: op.del, at: op.at ?? 0 });
    else if ('mark' in op && op.mark !== undefined) out.push({ mark: op.mark as 'bold', value: op.value as boolean, at: op.at ?? 0, length: op.length ?? 0 });
    else if ('style' in op && op.style !== undefined) out.push({ style: op.style as 'title', at: op.at ?? 0 });
  }
  return out;
}

export type ClientFrame = {
  type: string;
  ref: string;
  documentId?: string;
  revision?: number;
  baseRevision?: number;
  mode?: Mode;
  ops?: Op[];
  at?: number;
  length?: number;
  find?: string;
  replace?: string;
  matchCase?: boolean;
  suggestionId?: string;
  decision?: 'accept' | 'reject';
  shareId?: string;
  role?: DomainRole;
  endsAt?: string | null;
};

export type SocketHandle = {
  send: (frame: unknown) => void;
  personId: string;
  joinedDocId: string | null;
  ws: WebSocket;
  doc: LiveDoc | null;
};

/** Every socket of a person, joined or not, keyed by person id. */
const personSockets = new Map<string, Set<SocketHandle>>();

export function socketsOf(personId: string): Set<SocketHandle> {
  return personSockets.get(personId) ?? new Set();
}

export function registerSocket(personId: string, handle: SocketHandle): void {
  const set = personSockets.get(personId) ?? new Set();
  set.add(handle);
  personSockets.set(personId, set);
}

export function unregisterSocket(handle: SocketHandle): void {
  const set = personSockets.get(handle.personId);
  if (set) {
    set.delete(handle);
    if (set.size === 0) personSockets.delete(handle.personId);
  }
  if (handle.doc && handle.joinedDocId) {
    const doc = handle.doc;
    const sockets = doc.joined.get(handle.personId);
    if (sockets) {
      sockets.delete(handle);
      if (sockets.size === 0) doc.joined.delete(handle.personId);
    }
    doc.presence.delete(handle.personId);
    for (const [, s] of doc.joined) {
      for (const sock of s) sock.send({ type: 'presence', person: presencePerson(handle.personId, doc), state: 'left' });
    }
  }
}

export function pushNotice(personId: string, notice: NoticeRecord): void {
  for (const s of socketsOf(personId)) {
    s.send({ type: 'notice', notice });
    s.send({ type: 'lists_changed' });
  }
}

export function listsChangedFor(personIds: Iterable<string>): void {
  for (const pid of personIds) {
    for (const s of socketsOf(pid)) s.send({ type: 'lists_changed' });
  }
}

function presencePerson(personId: string, doc: LiveDoc): PersonObject {
  // colour and name are attached by the caller via a cache on the doc
  const cached = presenceCache.get(`${doc.id}:${personId}`);
  if (cached) return cached;
  return { personId, displayName: 'Unknown', colour: '#666666' };
}

const presenceCache = new Map<string, PersonObject>();

export async function refreshPresenceCache(pool: Pool, doc: LiveDoc): Promise<void> {
  const roles = await docRoles(pool, doc.id);
  for (const [pid, role] of roles) {
    const person = await personById(pool, pid);
    if (person) presenceCache.set(`${doc.id}:${pid}`, { personId: pid, displayName: person.display_name, colour: person.colour, role });
  }
}

/** Sends the access-ended frame to a person's open sockets on a doc, then closes them (DP-34, DP-37, DP-38). */
export async function broadcastAccessEnded(doc: LiveDoc, reason: 'expired' | 'removed' | 'deleted', personIds: string[] | null): Promise<void> {
  const targets = personIds ?? [...doc.joined.keys()];
  for (const pid of targets) {
    for (const s of doc.joined.get(pid) ?? []) {
      s.send({ type: 'access_ended', reason });
    }
    for (const s of socketsOf(pid)) {
      s.send({ type: 'lists_changed' });
    }
    const set = doc.joined.get(pid);
    if (set) {
      for (const s of set) {
        try {
          (s.ws ?? { close: () => undefined }).close();
        } catch {
          // already closed
        }
      }
      doc.joined.delete(pid);
      doc.presence.delete(pid);
    }
  }
}

export type SocketContext = {
  pool: Pool;
  person: PersonRow;
  handle: SocketHandle;
};

/** The single socket frame handler. Every frame passes through the same role and visibility checks. */
export async function handleFrame(ctx: SocketContext, frame: ClientFrame): Promise<void> {
  const { pool, person, handle } = ctx;
  const send = handle.send;
  const replyError = (code: string, fields?: Record<string, string>): void => send({ type: 'error', ref: frame.ref, code, ...(fields ? { fields } : {}) });
  const reply = (payload: Record<string, unknown>): void => send({ type: 'ack', ref: frame.ref, ...payload });

  if (frame.type === 'join') {
    if (handle.joinedDocId) return replyError('conflict');
    const documentId = frame.documentId;
    if (!documentId) return replyError('invalid');
    const access = await accessFor(pool, documentId, person.person_id);
    if (!access) return replyError('not_found');
    const loaded = await import('./store.js');
    const result = await loaded.loadDocument(pool, documentId);
    if (!result.ok) return replyError(result.reason === 'storage_unavailable' ? 'invalid' : 'not_found');
    const doc = result.doc;
    if (!doc.joined.has(person.person_id)) doc.joined.set(person.person_id, new Set());
    doc.joined.get(person.person_id)!.add(handle);
    doc.presence.set(person.person_id, { lastInput: Date.now(), lastSeen: Date.now(), state: 'active' });
    handle.joinedDocId = documentId;
    handle.doc = doc;
    const mode = await storedMode(pool, documentId, person.person_id, access.role);
    await refreshPresenceCache(pool, doc);
    const people: { person: PersonObject; state: 'active' | 'idle' }[] = [];
    for (const [pid, p] of doc.presence) {
      if (pid === person.person_id) continue;
      people.push({ person: presencePerson(pid, doc), state: p.state });
    }
    send({
      type: 'joined',
      ref: frame.ref,
      documentId,
      revision: doc.model.revision,
      role: access.role,
      mode,
      accessEndsAt: access.endsAt,
      people,
    });
    // replay op frames after the given revision
    const since = frame.revision ?? doc.model.revision;
    for (const h of doc.history) {
      if (h.revision > since) {
        const deltaRow = await pool.query(`SELECT delta FROM revisions WHERE document_id = $1 AND revision = $2`, [documentId, h.revision]);
        if (deltaRow.rowCount) {
          const delta = (deltaRow.rows[0] as { delta: { authorId: string; mode: Mode; textOps: [] } }).delta;
          send({ type: 'op', revision: h.revision, authorId: delta.authorId, mode: delta.mode, ops: toWireOps(delta.textOps) });
        }
      }
    }
    // tell everyone else the person is here
    for (const [pid, sockets] of doc.joined) {
      if (pid === person.person_id) continue;
      for (const s of sockets) s.send({ type: 'presence', person: presencePerson(person.person_id, doc), state: 'active' });
    }
    return;
  }

  if (frame.type === 'heartbeat') {
    const doc = handle.doc;
    if (doc && handle.joinedDocId) {
      const p = doc.presence.get(person.person_id);
      if (p) p.lastSeen = Date.now();
    }
    return reply({});
  }

  if (frame.type === 'notice_read') {
    return reply({});
  }

  const doc = handle.doc;
  if (!doc || !handle.joinedDocId) return replyError('not_joined');

  // re-check access on every frame: shares can end between frames (DP-35, DP-37)
  const access = await accessFor(pool, doc.id, person.person_id);
  if (!access) {
    await broadcastAccessEnded(doc, 'removed', [person.person_id]);
    return replyError('not_found');
  }

  const markInput = (): void => {
    const p = doc.presence.get(person.person_id);
    if (p && p.state === 'idle') {
      p.state = 'active';
      for (const [otherId, sockets] of doc.joined) {
        if (otherId === person.person_id) continue;
        for (const s of sockets) s.send({ type: 'presence', person: presencePerson(person.person_id, doc), state: 'active' });
      }
    }
    if (p) {
      p.lastInput = Date.now();
      p.lastSeen = Date.now();
    }
  };

  switch (frame.type) {
    case 'op': {
      const mode = frame.mode;
      const ops = frame.ops ?? [];
      if (mode !== 'editing' && mode !== 'suggesting') return replyError('invalid');
      const permission = mode === 'editing' ? 'edit' : 'suggest';
      if (!roleCan(access.role, permission)) return replyError('forbidden');
      if (mode === 'editing' && !allowedModes(access.role).includes('editing')) return replyError('forbidden');
      markInput();
      await enqueue(doc, async () => {
        const result = await acceptOpFrame(pool, doc, person.person_id, access.role, mode, ops, frame.baseRevision ?? doc.model.revision);
        if (!result.ok) {
          send({ type: 'error', ref: frame.ref, code: result.error, ...(result.fields ? { fields: result.fields } : {}) });
          return;
        }
        const outcome = result.outcome;
        const wireOps = toWireOps(outcome.broadcast);
        // to every other joined socket
        for (const [, sockets] of doc.joined) {
          for (const s of sockets) {
            if (s === handle) continue;
            s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode, ops: wireOps });
          }
        }
        // card frames for the suggestion events
        await refreshPresenceCache(pool, doc);
        for (const ev of outcome.delta.suggestionOps) {
          if ('created' in ev) {
            const authorObj = presencePerson(person.person_id, doc);
            broadcastDoc(doc, { type: 'card_added', card: { ...ev.created, author: authorObj, kind: ev.created.kind } });
          } else if ('changed' in ev) {
            const sug = doc.model.suggestions.find((s) => s.id === ev.changed.id);
            if (sug) broadcastDoc(doc, { type: 'card_changed', card: { ...sug, author: presencePerson(sug.authorId, doc) } });
          }
        }
        for (const closedId of outcome.closedIds) {
          const sug = doc.model.suggestions.find((s) => s.id === closedId);
          broadcastDoc(doc, { type: 'card_closed', cardId: closedId, status: 'rejected', decidedBy: presencePerson(person.person_id, doc) });
          void sug;
        }
        send({ type: 'ack', ref: frame.ref, revision: doc.model.revision });
      });
      return;
    }
    case 'mode': {
      const mode = frame.mode;
      if (mode !== 'editing' && mode !== 'suggesting' && mode !== 'viewing') return replyError('invalid');
      if (!allowedModes(access.role).includes(mode)) return replyError('forbidden');
      await saveMode(pool, doc.id, person.person_id, mode);
      markInput();
      return reply({});
    }
    case 'caret': {
      markInput();
      for (const [otherId, sockets] of doc.joined) {
        if (otherId === person.person_id) continue;
        for (const s of sockets) s.send({ type: 'caret', person: presencePerson(person.person_id, doc), at: frame.at ?? 0, length: frame.length ?? 0 });
      }
      return reply({});
    }
    case 'replace_all': {
      const mode = frame.mode;
      if (mode !== 'editing' && mode !== 'suggesting') return replyError('invalid');
      const permission = mode === 'editing' ? 'edit' : 'suggest';
      if (!roleCan(access.role, permission)) return replyError('forbidden');
      if (typeof frame.find !== 'string' || typeof frame.replace !== 'string') return replyError('invalid');
      markInput();
      await enqueue(doc, async () => {
        const result = await replaceAll(pool, doc, person.person_id, access.role, mode, frame.find!, frame.replace!, frame.matchCase === true);
        if ('error' in result) {
          send({ type: 'error', ref: frame.ref, code: result.error });
          return;
        }
        const outcome = result.outcome;
        const wireOps = toWireOps(outcome.broadcast);
        for (const [, sockets] of doc.joined) {
          for (const s of sockets) {
            if (s === handle) continue;
            s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode, ops: wireOps });
          }
        }
        await refreshPresenceCache(pool, doc);
        for (const ev of outcome.delta.suggestionOps) {
          if ('created' in ev) {
            broadcastDoc(doc, { type: 'card_added', card: { ...ev.created, author: presencePerson(person.person_id, doc), kind: ev.created.kind } });
          }
        }
        send({ type: 'ack', ref: frame.ref, revision: doc.model.revision, count: outcome.delta.suggestionOps.filter((e) => 'created' in e).length });
      });
      return;
    }
    case 'decide': {
      if (!roleCan(access.role, 'decide')) return replyError('forbidden');
      if (frame.decision !== 'accept' && frame.decision !== 'reject') return replyError('invalid');
      markInput();
      await enqueue(doc, async () => {
        const result = await decideSuggestion(pool, doc, frame.suggestionId!, frame.decision!, person.person_id);
        if (!result) {
          // first decision wins: this one was dropped without an error (DP-22)
          const sug = doc.model.suggestions.find((s) => s.id === frame.suggestionId);
          send({ type: 'ack', ref: frame.ref, revision: doc.model.revision, applied: false, status: sug?.status ?? 'rejected' });
          return;
        }
        await refreshPresenceCache(pool, doc);
        const decidedBy = presencePerson(person.person_id, doc);
        broadcastDoc(doc, { type: 'card_closed', cardId: frame.suggestionId, status: result.status, decidedBy }, undefined);
        // the text change reaches other screens as an op frame
        const wireOps = toWireOps(result.delta.textOps);
        for (const [, sockets] of doc.joined) {
          for (const s of sockets) {
            if (s === handle) continue;
            s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode: 'editing', ops: wireOps });
          }
        }
        send({ type: 'ack', ref: frame.ref, revision: doc.model.revision, applied: true, status: result.status });
      });
      return;
    }
    case 'decide_all': {
      if (!roleCan(access.role, 'decide')) return replyError('forbidden');
      if (frame.decision !== 'accept' && frame.decision !== 'reject') return replyError('invalid');
      markInput();
      await enqueue(doc, async () => {
        const result = await decideAll(pool, doc, frame.decision!, person.person_id);
        await refreshPresenceCache(pool, doc);
        const decidedBy = presencePerson(person.person_id, doc);
        for (const sid of result.suggestionIds) {
          broadcastDoc(doc, { type: 'card_closed', cardId: sid, status: frame.decision === 'accept' ? 'accepted' : 'rejected', decidedBy }, undefined);
        }
        const wireOps = toWireOps(result.delta.textOps);
        for (const [, sockets] of doc.joined) {
          for (const s of sockets) {
            if (s === handle) continue;
            s.send({ type: 'op', revision: doc.model.revision, authorId: person.person_id, mode: 'editing', ops: wireOps });
          }
        }
        send({ type: 'ack', ref: frame.ref, revision: doc.model.revision, count: result.count });
      });
      return;
    }
    case 'share': {
      if (access.role !== 'owner') return replyError('forbidden');
      const loaded = await import('./service.js');
      const endsAt = frame.endsAt === undefined ? undefined : frame.endsAt;
      if (frame.role !== undefined && frame.role !== 'editor' && frame.role !== 'commenter' && frame.role !== 'viewer') {
        return replyError('invalid', { role: 'Choose Editor, Commenter or Viewer.' });
      }
      if (endsAt !== undefined && endsAt !== null) {
        const t = Date.parse(endsAt);
        if (Number.isNaN(t) || t <= Date.now() || t > Date.now() + 365 * 24 * 3600 * 1000) {
          return replyError('invalid', { endsAt: t <= Date.now() ? 'Pick an end time in the future.' : 'Pick an end time within a year.' });
        }
      }
      try {
        const updated = await loaded.updateShare(pool, doc, frame.shareId!, frame.role, endsAt ?? undefined);
        if (updated.roleChanged && updated.granteeId) {
          await notifyRoleChange(pool, doc, updated.granteeId, updated.role as DomainRole);
        }
        listsChangedFor([updated.granteeId ?? ''].filter(Boolean));
        return reply({});
      } catch (err) {
        const e = err as { status?: number; code?: string; fields?: Record<string, string> };
        return replyError(e.code === 'share_ended' ? 'conflict' : e.code === 'not_found' ? 'not_found' : 'invalid', e.fields);
      }
    }
    default:
      return replyError('invalid');
  }
}

/** Role changes take effect at once (DP-31): clamp the stored mode and tell the person's open sockets. */
export async function notifyRoleChange(pool: Pool, doc: LiveDoc, granteeId: string, newRole: DomainRole): Promise<void> {
  const oldMode = await storedMode(pool, doc.id, granteeId, newRole);
  const mode = clampMode(newRole, oldMode);
  await saveMode(pool, doc.id, granteeId, mode);
  const docRow = await personById(pool, granteeId);
  void docRow;
  const notice = await addNotice(pool, granteeId, 'role_changed', doc, await personById(pool, doc.ownerId), newRole, `Your access to ${doc.title} changed to ${roleWord(newRole)}`);
  pushNotice(granteeId, notice);
  for (const s of doc.joined.get(granteeId) ?? []) {
    s.send({ type: 'role_changed', role: newRole, mode });
  }
}

function roleWord(role: DomainRole): string {
  return role === 'owner' ? 'Owner' : role === 'editor' ? 'Editor' : role === 'commenter' ? 'Commenter' : 'Viewer';
}

/** The presence sweep: marks idle people, drops silent sockets, and ends expired access (DP-13, DP-35). */
export function startSweep(pool: Pool): NodeJS.Timeout {
  return setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const doc of liveDocs.values()) {
        for (const [pid, p] of doc.presence) {
          if (now - p.lastInput > config.presenceIdleSeconds * 1000 && p.state === 'active') {
            p.state = 'idle';
            for (const [oid, sockets] of doc.joined) {
              if (oid === pid) continue;
              for (const s of sockets) s.send({ type: 'presence', person: presencePerson(pid, doc), state: 'idle' });
            }
          }
          if (now - p.lastSeen > 45_000) {
            for (const s of doc.joined.get(pid) ?? []) {
              try {
                (s.ws ?? { close: () => undefined }).close();
              } catch {
                // already closed
              }
            }
            doc.joined.delete(pid);
            doc.presence.delete(pid);
            for (const [, sockets] of doc.joined) {
              for (const sock of sockets) sock.send({ type: 'presence', person: presencePerson(pid, doc), state: 'left' });
            }
          }
        }
        // expired shares close open tabs within one second of the server's clock
        for (const pid of [...doc.joined.keys()]) {
          if (pid === doc.ownerId) continue;
          const access = await accessFor(pool, doc.id, pid);
          if (!access) {
            await broadcastAccessEnded(doc, 'expired', [pid]);
          }
        }
      }
    })();
  }, 500);
}
