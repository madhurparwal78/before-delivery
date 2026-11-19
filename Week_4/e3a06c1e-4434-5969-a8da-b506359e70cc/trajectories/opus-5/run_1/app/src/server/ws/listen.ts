import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { hashKeySecret } from '../auth.js';
import { openStreamConnection, query, queryOne } from '../db/pool.js';
import { parseSidecar } from '../domain/sidecar.js';
import { closeOpenSession, createRunner, runnerFor } from '../engine.js';
import { subscribe } from '../events.js';
import { ApiError, invalidKey, quotaExhausted, storageUnavailable, validationFailed } from '../http/errors.js';
import { json, type Router } from '../http/router.js';
import { objectExists, putObject, sessionKeys } from '../services/storage.js';
import { loadOrg, loadProject, type OrgRow, type ProjectRow } from '../store.js';
import { quotaOf } from '../routes/sessionroutes.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkText } from '../../shared/text.js';
import type { CloseReason, SessionState } from '../../shared/types.js';

const AUDIO_MESSAGE_LIMIT = 64_000;
const SIDECAR_MESSAGE_LIMIT = 200_000;

const closeCodes: Record<string, number> = {
  closed: 1000,
  idle_closed: 4000,
  quota_halted: 4002,
  revoked: 4003,
};

const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });

const refuse = (socket: Duplex, error: ApiError): void => {
  const body = Buffer.from(JSON.stringify(error.body()), 'utf8');
  socket.write(
    `HTTP/1.1 ${error.status} ${error.code}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
  );
  socket.write(body);
  socket.destroy();
};

interface Accepted {
  readonly sessionId: string;
  readonly project: ProjectRow;
  readonly org: OrgRow;
  readonly keyId: string;
  readonly channels: number;
  readonly label: string;
}

/** Everything that can refuse the stream is decided before the upgrade, as plain HTTP. */
const checkListen = async (req: IncomingMessage, search: URLSearchParams): Promise<Accepted> => {
  const header = req.headers.authorization ?? '';
  const match = /^Token (.+)$/i.exec(header.trim());
  if (match === null) throw invalidKey();
  const keyRow = await queryOne<{ id: string; project_id: string }>(
    'select id, project_id from api_keys where key_hash = $1 and revoked_at is null',
    [hashKeySecret(match[1] as string)],
  );
  if (keyRow === null) throw invalidKey();
  const project = await loadProject(keyRow.project_id);
  if (project === null) throw invalidKey();
  const org = await loadOrg(project.org_id);
  if (org === null) throw invalidKey();

  const quota = await quotaOf(project, new Date());
  if (quota.exhausted) throw quotaExhausted();

  const rawChannels = search.get('channels');
  const rawSampleRate = search.get('sample_rate');
  const label = checkText(search.get('label') ?? '', 0, 80);
  const fields: Record<string, string> = {};
  if (rawChannels !== null && rawChannels !== '1' && rawChannels !== '2') fields.channels = fieldCopy.channels;
  if (rawSampleRate !== null && rawSampleRate !== '16000') fields.sample_rate = fieldCopy.sampleRate;
  if (!label.ok) fields.label = fieldCopy.label;
  if (Object.keys(fields).length > 0) throw validationFailed(fields);

  const sessionId = randomUUID();
  await objectExists(sessionKeys(org.id, project.id, sessionId).capture);

  return {
    sessionId,
    project,
    org,
    keyId: keyRow.id,
    channels: rawChannels === '2' ? 2 : 1,
    label: label.value,
  };
};

type MessageHandler = (data: Buffer, isBinary: boolean) => void;

/**
 * Tracks a socket from the moment it is upgraded, so messages and a drop that
 * land while the session is still being set up are not lost.
 */
interface Lifecycle {
  closed: boolean;
  code: number;
  queued: { data: Buffer; isBinary: boolean }[];
  onMessage: MessageHandler | null;
  onClose: ((code: number) => void) | null;
}

const attach = async (ws: WebSocket, accepted: Accepted, lifecycle: Lifecycle): Promise<void> => {
  const { sessionId, project, org, keyId, channels, label } = accepted;
  await putObject(sessionKeys(org.id, project.id, sessionId).capture, Buffer.alloc(0));
  await query(
    `insert into sessions (id, project_id, org_id, kind, source, label, state, channels, plan, key_id)
     values ($1, $2, $3, 'live', 'live', $4, 'connecting', $5, $6, $7)`,
    [sessionId, project.id, org.id, label, channels, org.plan, keyId],
  );
  const runner = createRunner({
    sessionId,
    projectId: project.id,
    orgId: org.id,
    channels,
    plan: org.plan,
    source: 'live',
    keyId,
  });

  const client = await openStreamConnection(sessionId);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    unsubscribe();
    void client.end().catch(() => undefined);
  };

  const send = (payload: unknown): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  const unsubscribe = subscribe(sessionId, (event) => {
    if (event.type === 'state') {
      send({ type: 'state', state: event.state, close_reason: event.close_reason });
      const code = closeCodes[event.state];
      if (code !== undefined) {
        ws.close(code);
        release();
      }
      return;
    }
    if (event.type === 'segment') send({ type: 'segment', segment: event.segment });
    if (event.type === 'quota')
      send({
        type: 'quota',
        used_seconds: event.quota.used_seconds,
        limit_seconds: event.quota.limit_minutes * 60,
      });
  });

  send({ type: 'session', session_id: sessionId });
  send({ type: 'state', state: 'connecting' satisfies SessionState, close_reason: null });

  let sidecarAllowed = true;

  const endAs = (state: 'closed' | 'idle_closed', reason: CloseReason | null): void => {
    void closeOpenSession(sessionId, state, reason);
  };

  const onMessage = (data: Buffer, isBinary: boolean): void => {
    if (isBinary) {
      sidecarAllowed = false;
      if (data.length > AUDIO_MESSAGE_LIMIT) {
        ws.close(1009);
        endAs('closed', 'client');
        return;
      }
      if (data.length % (2 * channels) !== 0) {
        ws.close(1007);
        endAs('closed', 'client');
        return;
      }
      runner.ingest(data, true);
      return;
    }
    let parsed: { type?: string; vtt?: string };
    try {
      parsed = JSON.parse(data.toString('utf8')) as { type?: string; vtt?: string };
    } catch {
      sidecarAllowed = false;
      return;
    }
    if (parsed.type === 'close') {
      endAs('closed', 'client');
      return;
    }
    if (parsed.type !== 'sidecar') {
      sidecarAllowed = false;
      return;
    }
    if (!sidecarAllowed) {
      send({ type: 'error', error: 'sidecar_too_late' });
      return;
    }
    sidecarAllowed = false;
    const vtt = typeof parsed.vtt === 'string' ? parsed.vtt : '';
    if (Buffer.byteLength(vtt, 'utf8') > SIDECAR_MESSAGE_LIMIT) return;
    const cues = parseSidecar(vtt);
    if (cues === null) return;
    runner.setCues(cues);
    void (async () => {
      await putObject(sessionKeys(org.id, project.id, sessionId).sidecar, Buffer.from(vtt, 'utf8')).catch(
        () => undefined,
      );
      await query('update sessions set has_sidecar = true where id = $1', [sessionId]);
    })();
  };

  /** A dropped live socket ends its session as closed with reason disconnect. */
  const onClose = (code: number): void => {
    release();
    if (runnerFor(sessionId) !== undefined)
      endAs('closed', code === 1009 || code === 1007 ? 'client' : 'disconnect');
  };

  lifecycle.onClose = onClose;
  lifecycle.onMessage = onMessage;
  if (lifecycle.closed) {
    onClose(lifecycle.code);
    return;
  }
  for (const message of lifecycle.queued) onMessage(message.data, message.isBinary);
  lifecycle.queued.length = 0;

  const keys = sessionKeys(org.id, project.id, sessionId);
  if (await objectExists(keys.capture).catch(() => false)) await runner.goLive();
  else endAs('closed', 'disconnect');
  if (lifecycle.closed) onClose(lifecycle.code);
};

/** Without an Upgrade header the same checks run, so refusals are readable as plain HTTP. */
export const registerListenRoute = (router: Router): void => {
  router.add('GET', '/v1/listen', async (ctx) => {
    await checkListen(ctx.req, ctx.search);
    return json(426, {
      error: 'upgrade_required',
      message: 'Connect to /v1/listen over a WebSocket.',
    });
  });
};

export const handleListenUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/v1/listen') {
    socket.destroy();
    return;
  }
  void (async () => {
    let accepted: Accepted;
    try {
      accepted = await checkListen(req, url.searchParams);
    } catch (error) {
      refuse(socket, error instanceof ApiError ? error : storageUnavailable());
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const lifecycle: Lifecycle = { closed: false, code: 1006, queued: [], onMessage: null, onClose: null };
      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (lifecycle.onMessage === null) lifecycle.queued.push({ data, isBinary });
        else lifecycle.onMessage(data, isBinary);
      });
      const noteClose = (code: number): void => {
        if (lifecycle.closed) return;
        lifecycle.closed = true;
        lifecycle.code = code;
        lifecycle.onClose?.(code);
      };
      ws.on('close', noteClose);
      ws.on('error', () => noteClose(1006));
      void attach(ws, accepted, lifecycle).catch(() => {
        ws.close(1011);
      });
    });
  })();
};
