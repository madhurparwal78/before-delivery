// /v1/listen: the live streaming WebSocket and the SSE event stream.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Db } from './db';
import { errors } from './errors';
import type { SessionHub } from './hub';
import type { Storage } from './storage';
import type { Config } from './config';
import { principalForToken } from './auth';
import { checkText } from '../src-shared/text';
import { FIELD_MESSAGES } from '../src-shared/copy';
import { parseSidecar } from '../src-shared/vtt';
import { randomUUID } from 'node:crypto';
import { Storage as StorageKeys } from './storage';

const CLOSE_CODES = {
  closed: 1000,
  idle_closed: 4000,
  quota_halted: 4002,
  revoked: 4003,
} as const;

export class LiveServer {
  private wss: WebSocketServer;

  constructor(
    private db: Db,
    private hub: SessionHub,
    private storage: Storage,
    private cfg: Config,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Handles the /v1/listen upgrade, after plain-HTTP validation has passed. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onConnection(req, ws).catch(() => ws.close(1011, 'internal'));
    });
  }

  private async onConnection(req: IncomingMessage, ws: WebSocket): Promise<void> {
    const url = new URL(req.url ?? '/v1/listen', 'http://internal');
    const channels = url.searchParams.get('channels') === '2' ? 2 : 1;
    const principalId = (req as unknown as { __principal?: { key_id: string; project_id: string; org_id: string } }).__principal;
    if (!principalId) {
      ws.close(1011, 'unauthenticated');
      return;
    }
    const sessionId = randomUUID();
    const labelCheck = checkText(url.searchParams.get('label') ?? '', 0, 80);

    // The plan in force at the session's start (DP-51).
    const { rows: orgRows } = await this.db.query(`SELECT plan FROM orgs WHERE id=$1`, [principalId.org_id]);
    const plan = (orgRows[0].plan as 'pilot' | 'scale');
    await this.db.query(
      `INSERT INTO sessions (id, project_id, org_id, kind, source, label, channels, plan, key_id, state)
       VALUES ($1,$2,$3,'live','live',$4,$5,$6,$7,'connecting')`,
      [sessionId, principalId.project_id, principalId.org_id, labelCheck.ok ? labelCheck.value : '', channels, plan, principalId.key_id],
    );
    this.hub.register({
      id: sessionId, projectId: principalId.project_id, orgId: principalId.org_id,
      kind: 'live', label: labelCheck.ok ? labelCheck.value : '', channels, plan, keyId: principalId.key_id, cues: [],
    });
    ws.send(JSON.stringify({ type: 'session', session_id: sessionId }));
    ws.send(JSON.stringify({ type: 'state', state: 'connecting', close_reason: null }));

    // The live capture object must exist in storage before the session goes live.
    const keys = StorageKeys.sessionKeys(principalId.org_id, principalId.project_id, sessionId);
    try {
      await this.storage.put(keys.capture, Buffer.alloc(0), 'application/octet-stream');
      await this.hub.markLive(sessionId);
    } catch {
      await this.hub.finish(sessionId, 'closed', 'client', true);
      ws.close(1011, 'storage');
      return;
    }

    let sidecarSeen = false;
    let closed = false;
    const closeWith = (state: keyof typeof CLOSE_CODES) => {
      if (closed) return;
      closed = true;
      ws.close(CLOSE_CODES[state]);
    };

    const unsubscribe = this.hub.subscribe(sessionId, (ev) => {
      if (ev.type === 'state') {
        ws.send(JSON.stringify({ type: 'state', state: ev.state, close_reason: ev.close_reason }));
        if (ev.state in CLOSE_CODES) closeWith(ev.state as keyof typeof CLOSE_CODES);
      } else if (ev.type === 'segment') {
        ws.send(JSON.stringify({ type: 'segment', segment: ev.segment }));
      } else if (ev.type === 'quota') {
        // The WebSocket quota message is not a Quota object and has no server_time.
        ws.send(JSON.stringify({ type: 'quota', used_seconds: ev.quota.used_seconds, limit_seconds: ev.quota.limit_minutes * 60 }));
      }
    });

    const finishAndClose = async (state: 'closed' | 'idle_closed' | 'quota_halted' | 'revoked', reason: 'client' | 'disconnect' | null) => {
      if (this.hub.isTracked(sessionId)) {
        await this.persistCapture(sessionId, principalId);
        await this.hub.finish(sessionId, state, reason);
      }
    };

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (closed) return;
        if (data.length > 64000) {
          void finishAndClose('closed', 'client').finally(() => {
            try { ws.close(1009, 'message too big'); } catch { /* already closing */ }
          });
          return;
        }
        if (data.length % (2 * channels) !== 0) {
          void finishAndClose('closed', 'client').finally(() => {
            try { ws.close(1007, 'bad frame'); } catch { /* already closing */ }
          });
          return;
        }
        this.hub.feedLive(sessionId, data);
      } else {
        const text = data.toString('utf8');
        try {
          const msg = JSON.parse(text) as { type?: string; vtt?: string };
          if (msg.type === 'close') {
            void finishAndClose('closed', 'client');
            return;
          }
          if (msg.type === 'sidecar') {
            if (sidecarSeen) {
              ws.send(JSON.stringify({ type: 'error', error: 'sidecar_too_late' }));
              return;
            }
            sidecarSeen = true;
            if (typeof msg.vtt === 'string' && Buffer.byteLength(msg.vtt, 'utf8') <= 200000) {
              const cues = parseSidecar(msg.vtt);
              if (cues) {
                this.hub.applySidecar(sessionId, cues);
                void this.storage.put(keys.sidecar, Buffer.from(msg.vtt, 'utf8'), 'text/vtt; charset=utf-8');
              }
            }
            return;
          }
        } catch {
          // A non-JSON text message is ignored.
        }
      }
    });

    ws.on('close', () => {
      unsubscribe?.();
      void finishAndClose('closed', 'disconnect');
    });
    ws.on('error', () => {
      unsubscribe?.();
      void finishAndClose('closed', 'disconnect');
    });
  }

  private async persistCapture(sessionId: string, principal: { org_id: string; project_id: string }): Promise<void> {
    const chunks = this.hub.captureChunks(sessionId);
    if (chunks.length === 0) return;
    const data = Buffer.concat(chunks);
    const keys = StorageKeys.sessionKeys(principal.org_id, principal.project_id, sessionId);
    try {
      await this.storage.put(keys.capture, data, 'application/octet-stream');
    } catch {
      // Storage unavailable: the session still closes; its audio stays unavailable.
    }
  }
}

/** SSE: /api/sessions/<id>/events. Each stream holds one dedicated, labelled connection. */
export async function handleEvents(
  db: Db,
  hub: SessionHub,
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
  sessionId: string,
): Promise<void> {
  // One dedicated, labelled connection for as long as the stream stays open.
  const client = await db.connect();
  await client.query("SELECT set_config('application_name', $1, false)", [`lowfield-stream:${sessionId}`]);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    try { client.release(); } catch { /* already released */ }
  };
  req.on('close', finish);
  res.on('close', finish);

  const send = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      finish();
    }
  };

  // Initial state so a freshly opened stream knows where things stand.
  const { rows } = await client.query(`SELECT state, close_reason, audio_ms, frame FROM sessions WHERE id=$1`, [sessionId]);
  if (rows.length > 0) {
    send('state', { state: rows[0].state, close_reason: rows[0].close_reason });
  }

  const unsubscribe = hub.subscribe(sessionId, (ev) => {
    if (ev.type === 'state') {
      send('state', { state: ev.state, close_reason: ev.close_reason });
      if (ev.state === 'closed' || ev.state === 'idle_closed' || ev.state === 'quota_halted' || ev.state === 'revoked') {
        send('done', {});
        finish();
      }
    } else if (ev.type === 'frame') {
      send('frame', { frame: ev.frame, audio_ms: ev.audio_ms, peak_bin: ev.peak_bin, bins: ev.bins });
    } else if (ev.type === 'segment') {
      send('segment', { segment: ev.segment });
    } else if (ev.type === 'quota') {
      send('quota', { quota: ev.quota });
    } else if (ev.type === 'correction') {
      send('correction', { segment: ev.segment, wer: ev.wer });
    }
  });
  if (!unsubscribe) {
    // The session isn't tracked (already ended): the stream ends after the final state event.
    send('done', {});
    finish();
    return;
  }
  req.on('close', () => unsubscribe());
}
