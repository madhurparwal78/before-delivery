import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_BODY_BYTES, type ClientFrame, type OpEntry, type PresenceEntry, type Role, type ServerFrame } from '../shared/types.js';
import { accessFor, touchRecent } from './access.js';
import { query } from './db.js';
import { applyOpFrame, applyReplaceAll, decideAll, decideSuggestion } from './edits.js';
import { AppError, forbidden, invalidFrame, notFound, socketCode, tooLarge } from './errors.js';
import { env } from './env.js';
import { broadcast, loadDocument, release, retain, setBroadcaster } from './livedoc.js';
import { modeFor, setStoredMode } from './modes.js';
import { personObject } from './people.js';
import { can, modeAllowed } from './permissions.js';
import { patchShare } from './shares.js';
import { originAllowed } from './http.js';
import { personForSession, SESSION_COOKIE, cookieValue } from './sessions.js';

interface Connection {
  id: string;
  socket: WebSocket;
  personId: string;
  documentId: string | null;
  role: Role | null;
  lastInputAt: number;
  lastSeenAt: number;
  presence: 'active' | 'idle';
}

const connections = new Map<string, Connection>();
const wss = new WebSocketServer({ noServer: true });

function send(connection: Connection, frame: ServerFrame): void {
  if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify(frame));
}

function inDocument(documentId: string): Connection[] {
  return [...connections.values()].filter((connection) => connection.documentId === documentId);
}

setBroadcaster({
  toDocument(documentId, frame, exceptSocketId) {
    for (const connection of inDocument(documentId)) {
      if (connection.id !== exceptSocketId) send(connection, frame);
    }
  },
  toPerson(personId, frame) {
    for (const connection of connections.values()) {
      if (connection.personId === personId) send(connection, frame);
    }
  },
  toPersonInDocument(documentId, personId, frame) {
    for (const connection of inDocument(documentId)) {
      if (connection.personId === personId) send(connection, frame);
    }
  },
  endAccess(documentId, personId, reason) {
    for (const connection of inDocument(documentId)) {
      if (personId !== null && connection.personId !== personId) continue;
      send(connection, { type: 'access_ended', reason });
      connection.socket.close();
    }
  },
});

function rawReject(socket: Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: code });
  socket.write(
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Unauthorized'}\r\n` +
      'content-type: application/json; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/api/socket') {
    rawReject(socket, 403, 'cross_origin');
    return;
  }
  if (request.headers.origin === undefined || !originAllowed(request)) {
    rawReject(socket, 403, 'cross_origin');
    return;
  }
  void (async () => {
    const person = await personForSession(cookieValue(request.headers.cookie, SESSION_COOKIE));
    if (!person) {
      rawReject(socket, 401, 'unauthenticated');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const connection: Connection = {
        id: randomBytes(12).toString('base64url'),
        socket: ws,
        personId: person.id,
        documentId: null,
        role: null,
        lastInputAt: Date.now(),
        lastSeenAt: Date.now(),
        presence: 'active',
      };
      connections.set(connection.id, connection);
      ws.on('message', (data: Buffer) => {
        void onMessage(connection, data);
      });
      ws.on('close', () => {
        void onClose(connection);
      });
      ws.on('error', () => undefined);
    });
  })();
}

async function onClose(connection: Connection): Promise<void> {
  connections.delete(connection.id);
  const documentId = connection.documentId;
  if (documentId === null) return;
  release(documentId);
  const stillOpen = inDocument(documentId).some((other) => other.personId === connection.personId);
  if (!stillOpen) {
    await query('delete from presence where document_id = $1 and person_id = $2', [documentId, connection.personId]).catch(
      () => undefined,
    );
    broadcast().toDocument(documentId, {
      type: 'presence',
      person: personObject(connection.personId, connection.role ?? undefined),
      state: 'left',
    });
  }
}

function errorFrame(ref: string, error: AppError): ServerFrame {
  const frame: ServerFrame = { type: 'error', ref, code: socketCode(error) };
  if (error.fields) frame.fields = error.fields;
  return frame;
}

async function roleFor(connection: Connection, documentId: string): Promise<Role> {
  const access = await accessFor(connection.personId, documentId);
  if (!access) throw notFound();
  connection.role = access.role;
  return access.role;
}

async function markActive(connection: Connection): Promise<void> {
  connection.lastInputAt = Date.now();
  connection.lastSeenAt = Date.now();
  if (connection.documentId === null) return;
  await query(
    `insert into presence (document_id, person_id, state, last_input_at, last_seen_at)
     values ($1, $2, 'active', now(), now())
     on conflict (document_id, person_id) do update set state = 'active', last_input_at = now(), last_seen_at = now()`,
    [connection.documentId, connection.personId],
  );
  if (connection.presence === 'idle') {
    connection.presence = 'active';
    broadcast().toDocument(connection.documentId, {
      type: 'presence',
      person: personObject(connection.personId, connection.role ?? undefined),
      state: 'active',
    });
  }
}

async function handleJoin(connection: Connection, frame: Extract<ClientFrame, { type: 'join' }>): Promise<void> {
  if (connection.documentId !== null) throw new AppError(409, 'conflict');
  if (typeof frame.documentId !== 'string') throw invalidFrame();
  const access = await accessFor(connection.personId, frame.documentId);
  if (!access) throw notFound();
  const document = await loadDocument(frame.documentId);
  connection.documentId = frame.documentId;
  connection.role = access.role;
  retain(frame.documentId);
  await touchRecent(connection.personId, frame.documentId);
  const mode = await modeFor(frame.documentId, connection.personId, access.role);
  await markActive(connection);
  const seen = new Set<string>([connection.personId]);
  const people: PresenceEntry[] = [];
  for (const other of inDocument(frame.documentId)) {
    if (seen.has(other.personId)) continue;
    seen.add(other.personId);
    const otherAccess = await accessFor(other.personId, frame.documentId);
    people.push({
      person: personObject(other.personId, otherAccess?.role),
      state: other.presence,
    });
  }
  send(connection, {
    type: 'joined',
    ref: frame.ref,
    documentId: frame.documentId,
    revision: document.meta.revision,
    role: access.role,
    mode,
    accessEndsAt: access.accessEndsAt,
    people,
  });
  const from = typeof frame.revision === 'number' ? frame.revision : document.meta.revision;
  const pending = await query<{ revision: number; author_id: string; ops: OpEntry[] }>(
    'select revision, author_id, ops from operations where document_id = $1 and revision > $2 order by revision',
    [frame.documentId, from],
  );
  for (const row of pending.rows) {
    send(connection, {
      type: 'op',
      revision: row.revision,
      authorId: row.author_id,
      mode: 'editing',
      ops: row.ops,
    });
  }
  broadcast().toDocument(
    frame.documentId,
    { type: 'presence', person: personObject(connection.personId, access.role), state: 'active' },
    connection.id,
  );
}

async function handleFrame(connection: Connection, frame: ClientFrame): Promise<void> {
  if (frame.type === 'join') {
    await handleJoin(connection, frame);
    return;
  }
  const documentId = connection.documentId;
  if (documentId === null) throw new AppError(400, 'not_joined');
  const role = await roleFor(connection, documentId);

  switch (frame.type) {
    case 'heartbeat': {
      connection.lastSeenAt = Date.now();
      send(connection, { type: 'ack', ref: frame.ref });
      return;
    }
    case 'caret': {
      if (typeof frame.at !== 'number' || typeof frame.length !== 'number' || frame.at < 0 || frame.length < 0) {
        throw invalidFrame();
      }
      await markActive(connection);
      send(connection, { type: 'ack', ref: frame.ref });
      broadcast().toDocument(
        documentId,
        { type: 'caret', person: personObject(connection.personId, role), at: frame.at, length: frame.length },
        connection.id,
      );
      return;
    }
    case 'mode': {
      if (frame.mode !== 'editing' && frame.mode !== 'suggesting' && frame.mode !== 'viewing') throw invalidFrame();
      if (!modeAllowed(role, frame.mode)) throw forbidden();
      await setStoredMode(documentId, connection.personId, frame.mode);
      await markActive(connection);
      send(connection, { type: 'ack', ref: frame.ref });
      return;
    }
    case 'op': {
      if (frame.mode !== 'editing' && frame.mode !== 'suggesting') throw invalidFrame();
      if (!can(role, frame.mode === 'editing' ? 'edit' : 'suggest')) throw forbidden();
      const document = await loadDocument(documentId);
      await markActive(connection);
      const revision = await document.serial(() =>
        applyOpFrame(document, connection.personId, frame.mode, frame.baseRevision, frame.ops, connection.id),
      );
      send(connection, { type: 'ack', ref: frame.ref, revision });
      return;
    }
    case 'replace_all': {
      if (frame.mode !== 'editing' && frame.mode !== 'suggesting') throw invalidFrame();
      if (!can(role, frame.mode === 'editing' ? 'edit' : 'suggest')) throw forbidden();
      const document = await loadDocument(documentId);
      await markActive(connection);
      const result = await document.serial(() =>
        applyReplaceAll(document, connection.personId, frame.mode, frame.baseRevision, frame.find, frame.replace, frame.matchCase),
      );
      send(connection, { type: 'ack', ref: frame.ref, revision: result.revision, count: result.count });
      return;
    }
    case 'decide': {
      if (!can(role, 'decide')) throw forbidden();
      if (frame.decision !== 'accept' && frame.decision !== 'reject') throw invalidFrame();
      if (typeof frame.suggestionId !== 'string') throw invalidFrame();
      const document = await loadDocument(documentId);
      const result = await document.serial(() =>
        decideSuggestion(document, connection.personId, frame.suggestionId, frame.decision),
      );
      send(connection, {
        type: 'ack',
        ref: frame.ref,
        revision: result.revision,
        applied: result.applied,
        status: result.status,
      });
      return;
    }
    case 'decide_all': {
      if (!can(role, 'decide')) throw forbidden();
      if (frame.decision !== 'accept' && frame.decision !== 'reject') throw invalidFrame();
      const document = await loadDocument(documentId);
      const result = await document.serial(() => decideAll(document, connection.personId, frame.decision));
      send(connection, { type: 'ack', ref: frame.ref, revision: result.revision, count: result.count });
      return;
    }
    case 'share': {
      if (!can(role, 'own')) throw forbidden();
      if (typeof frame.shareId !== 'string') throw invalidFrame();
      const document = await loadDocument(documentId);
      const input: { role?: unknown; endsAt?: unknown } = {};
      if (frame.role !== undefined) input.role = frame.role;
      if (frame.endsAt !== undefined) input.endsAt = frame.endsAt;
      await patchShare(document, frame.shareId, input);
      send(connection, { type: 'ack', ref: frame.ref });
      return;
    }
    default:
      throw invalidFrame();
  }
}

async function onMessage(connection: Connection, data: Buffer): Promise<void> {
  if (data.length > MAX_BODY_BYTES) {
    send(connection, errorFrame('', tooLarge()));
    return;
  }
  let frame: ClientFrame;
  try {
    frame = JSON.parse(data.toString('utf8')) as ClientFrame;
  } catch {
    send(connection, errorFrame('', invalidFrame()));
    return;
  }
  const ref = typeof frame?.ref === 'string' ? frame.ref : '';
  if (typeof frame?.type !== 'string') {
    send(connection, errorFrame(ref, invalidFrame()));
    return;
  }
  if (connection.documentId === null && frame.type !== 'join') {
    send(connection, errorFrame(ref, new AppError(400, 'not_joined')));
    return;
  }
  try {
    await handleFrame(connection, frame);
  } catch (error) {
    if (error instanceof AppError) {
      send(connection, errorFrame(ref, error));
      return;
    }
    process.stderr.write(`frame failed: ${String(error)}\n`);
    send(connection, errorFrame(ref, invalidFrame()));
  }
}

/** Idle and left presence, decided on the server's clock. */
export function startPresenceSweep(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (connection.documentId === null) continue;
      if (now - connection.lastSeenAt > 45_000) {
        connection.socket.close();
        continue;
      }
      if (connection.presence === 'active' && now - connection.lastInputAt > env.presenceIdleSeconds * 1_000) {
        connection.presence = 'idle';
        void query("update presence set state = 'idle' where document_id = $1 and person_id = $2", [
          connection.documentId,
          connection.personId,
        ]).catch(() => undefined);
        broadcast().toDocument(connection.documentId, {
          type: 'presence',
          person: personObject(connection.personId, connection.role ?? undefined),
          state: 'idle',
        });
      }
    }
  }, 1_000);
}
