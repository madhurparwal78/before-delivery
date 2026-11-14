import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientFrame, Person, ServerFrame } from '../shared/types.ts';
import { applyChanges } from './changes.ts';
import { pool } from './db.ts';
import { Failure, changeDropped } from './errors.ts';
import { accessFor, loadForm, settle } from './forms.ts';
import { JSON_LIMIT, parseCookies, sameOrigin, storable } from './http.ts';
import {
  addPeer, enterPresence, leavePresence, presenceNow, removePeer, sendFrame, type Peer,
} from './hub.ts';
import { SESSION_COOKIE, userForSession, type User } from './auth.ts';
import { DEVICE_COOKIE, loadResponse } from './respondent.ts';
import { summarize } from './summary.ts';
import { valkeyUp } from './valkey.ts';

// The one WebSocket at /ws on the app's own port: builder changes and presence, the live summary, form state for
// respondents, and the moved notice (brief: API, Live updates over /ws).

const NOT_VISIBLE = 4404;
const PING_MS = 25_000;
const wss = new WebSocketServer({ noServer: true, maxPayload: JSON_LIMIT });

export function acceptUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const refuse = (): void => {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  };
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws' || !sameOrigin(req.headers.origin, req.headers.host)) return refuse();
  wss.handleUpgrade(req, socket, head, (ws) => connected(ws, req));
}

function connected(ws: WebSocket, req: IncomingMessage): void {
  const cookies = parseCookies(req.headers.cookie);
  const userLoaded = userForSession(cookies[SESSION_COOKIE]);
  let peer: Peer | null = null;
  let queue: Promise<void> = Promise.resolve();
  const ping = setInterval(() => ws.ping(), PING_MS);
  ws.on('message', (raw: RawData) => {
    queue = queue.then(async () => {
      try {
        const frame = JSON.parse(raw.toString('utf8')) as ClientFrame;
        if (!storable(frame)) throw new Error('Unstorable frame');
        const user = await userLoaded;
        if (frame.type === 'join') peer = await join(ws, frame, user, cookies[DEVICE_COOKIE]);
        else if (frame.type === 'change' && peer && peer.view === 'builder' && user) await change(peer, user, frame);
      } catch {
        ws.close(NOT_VISIBLE);
      }
    });
  });
  ws.on('close', () => {
    clearInterval(ping);
    queue = queue.then(async () => {
      if (!peer) return;
      removePeer(peer);
      await leavePresence(peer);
    });
  });
  ws.on('error', () => undefined);
}

const person = (user: User): Person => ({ id: user.id, name: user.name });

async function join(ws: WebSocket, frame: Extract<ClientFrame, { type: 'join' }>, user: User | null, device: string | undefined): Promise<Peer | null> {
  if ('response' in frame) {
    const row = await loadResponse(pool, String(frame.response));
    if (!row || !device || !row.devices.includes(device)) return refuseJoin(ws);
    const peer = addPeer(ws, 'response', row.form_id, null, row.id);
    sendFrame(peer, { type: 'joined', rev: 0, live: valkeyUp() });
    return peer;
  }
  if (!user) return refuseJoin(ws);
  const access = await accessFor(pool, user.id, String(frame.form));
  if (!access || (access.role === 'editor' && access.form.state === 'closed')) return refuseJoin(ws);
  const form = await settle(pool, await loadForm(pool, access.form.id) ?? access.form);
  const view = frame.view === 'summary' ? 'summary' : 'builder';
  const peer = addPeer(ws, view, form.id, person(user), null);
  sendFrame(peer, { type: 'joined', rev: form.rev, live: valkeyUp() });
  if (view === 'summary') sendFrame(peer, { type: 'summary', summary: await summarize(form.id) });
  else {
    await enterPresence(peer);
    sendFrame(peer, { type: 'presence', editors: await presenceNow(form.id) });
  }
  return peer;
}

function refuseJoin(ws: WebSocket): null {
  ws.close(NOT_VISIBLE);
  return null;
}

async function change(peer: Peer, user: User, frame: Extract<ClientFrame, { type: 'change' }>): Promise<void> {
  try {
    const result = await applyChanges(person(user), peer.formId, [frame.change]);
    const applied = result.applied[0];
    if (!applied || applied.seq === null) {
      sendFrame(peer, { type: 'refused', ref: frame.ref, error: changeDropped().toBody().error });
      return;
    }
    const ack: ServerFrame = { type: 'ack', ref: frame.ref, seq: applied.seq, conflict_with: applied.conflict_with };
    sendFrame(peer, ack);
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    sendFrame(peer, { type: 'refused', ref: frame.ref, error: error.toBody().error });
  }
}
