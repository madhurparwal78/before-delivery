import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, apiError, sha256Hex, readJsonBody } from './http.js';
import { getObject } from './storage.js';

// The response is recorded during the request transaction and sent only after it commits,
// so a client never sees a result that the server has not committed.
export class DeferredResponse {
  status = 0;
  headers: Record<string, string> = {};
  body: Buffer | null = null;
  downloadKey: string | null = null;
  downloadStream: (() => Promise<NodeJS.ReadableStream>) | null = null;
  destroyed = false;
  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status;
    Object.assign(this.headers, headers);
    return this;
  }
  end(body?: unknown): this {
    if (body instanceof Buffer) this.body = body;
    else if (typeof body === 'string') this.body = Buffer.from(body, 'utf8');
    return this;
  }
  destroy(): this { this.destroyed = true; return this; }
  setHeader(k: string, v: string): void { this.headers[k] = v; }
}

export async function flushDeferred(deferred: DeferredResponse, res: ServerResponse, req: IncomingMessage): Promise<void> {
  if (deferred.destroyed) { res.destroy(); return; }
  if (deferred.downloadKey && deferred.downloadStream) {
    try {
      const stream = await deferred.downloadStream();
      res.writeHead(deferred.status, deferred.headers);
      stream.pipe(res);
      stream.on('error', () => { res.destroy(); });
      req.on('close', () => { (stream as unknown as { destroy(): void }).destroy(); });
    } catch {
      if (!res.headersSent) {
        sendJson(res, 503, { error: 'storage_unavailable', message: 'Storage is unavailable. Try again in a moment.' }, { 'Retry-After': '30' });
      } else {
        res.destroy();
      }
    }
    return;
  }
  const headers = { ...deferred.headers };
  if (deferred.body && !('Content-Length' in headers)) headers['Content-Length'] = String(deferred.body.length);
  res.writeHead(deferred.status, headers);
  res.end(deferred.body ?? Buffer.alloc(0));
}
import { currentSession, userProjection, isSafePath } from './auth.js';
import { inTx } from './db.js';
import type { SessionUser } from './auth.js';
import { isClient, missionProjection, holidayProjection, alertProjection } from './api-utils.js';
import { handleSignIn } from './handlers-session.js';
import { handleFixes, handleLineStartEnd } from './handlers-ingest.js';
import {
  handleVesselsList, handleVesselGet, handleVesselPatch, handleAfloat, handleRecovered,
  handleServiceCreate, handleServiceList, handleVesselFixes,
} from './handlers-vessels.js';
import {
  handlePlanPreview, handleCreateMission, handleMissionTransition, handleAssignments,
  handleCoverageGet, handleCoverageCsv, handleTracks, handleInfillQueue,
  handleInfillOrderGet, handleInfillOrderPut, handleHistory, handleHandover, handleHold,
  handleResume, handleGeofencePut, handleRerun, handleFlagCreate,
} from './handlers-missions.js';
import {
  handleFileUpload, handleFileDownload, handleUploadCreate, handleUploadPart,
} from './handlers-lines.js';
import { storageStatus } from './storage.js';
import { mailStatus } from './mail.js';
import { isoT } from './api-utils.js';

function methodNotAllowed(): never {
  throw apiError(404, 'not_found', 'That page does not exist or is not shared with you.');
}

export const api = {
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!pathname.startsWith('/api/') && pathname !== '/api') return false;
    const deferred = new DeferredResponse();
    try {
      await inTx(async (c) => {
        await route(c, req, deferred, pathname);
      });
      await flushDeferred(deferred, res, req);
      return true;
    } catch (e) {
      const err = e as { status?: number; code?: string; message?: string; extra?: Record<string, unknown> };
      if (deferred.destroyed) { res.destroy(); return true; }
      if (err.status && err.code && typeof err.message === 'string' && !res.headersSent) {
        sendJson(res, err.status, { error: err.code, message: err.message, ...(err.extra ?? {}) },
          err.status === 503 ? { 'Retry-After': '30' } :
          err.status === 429 && err.extra && 'retry_at' in err.extra
            ? { 'Retry-After': String(Math.max(1, Math.ceil((new Date(String(err.extra.retry_at)).getTime() - Date.now()) / 1000))) }
            : {});
      } else if (!res.headersSent) {
        console.error('API error', e);
        sendJson(res, 500, { error: 'internal', message: 'Something went wrong on the server.' });
      } else {
        res.destroy();
      }
      return true;
    }
  },
};

async function route(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, pathname: string): Promise<boolean> {
  const method = req.method ?? 'GET';
  const seg = pathname.slice('/api/'.length).split('/').filter(Boolean);

  // ---------- unauthenticated ----------
  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok' });
    return true;
  }
  if (pathname === '/api/session' && method === 'POST') {
    await handleSignIn(req, res);
    return true;
  }
  if (seg[0] === 'ingest') {
    if (seg[1] === 'fixes' && method === 'POST' && seg.length === 2) {
      await handleFixes(c, req, res);
      return true;
    }
    if (seg[1] === 'lines' && seg[3] === 'start' && method === 'POST' && seg.length === 4) {
      await handleLineStartEnd(c, req, res, seg[2]!, 'start');
      return true;
    }
    if (seg[1] === 'lines' && seg[3] === 'end' && method === 'POST' && seg.length === 4) {
      await handleLineStartEnd(c, req, res, seg[2]!, 'end');
      return true;
    }
    methodNotAllowed();
  }

  // ---------- session ----------
  const session = await currentSession(c, req);
  if (!session) {
    sendJson(res, 401, { error: 'unauthenticated', message: 'Sign in to continue' });
    return true;
  }
  const user: SessionUser = session;

  if (pathname === '/api/session/refresh' && method === 'POST') {
    const token = parseCookieToken(req);
    await c.query(`UPDATE sessions SET expires_at = now() + interval '12 hours' WHERE id = $1 AND revoked = false`, [tokenHash(token)]);
    sendJson(res, 204, {});
    return true;
  }
  if (pathname === '/api/session' && method === 'DELETE') {
    const token = parseCookieToken(req);
    await c.query(`UPDATE sessions SET revoked = true WHERE id = $1`, [tokenHash(token)]);
    sendJson(res, 204, {});
    return true;
  }
  if (pathname === '/api/me' && method === 'GET') {
    sendJson(res, 200, userProjection(user));
    return true;
  }
  if (pathname === '/api/me' && method === 'PATCH') {
    const body = await readJson(req);
    if (body.units !== 'metric' && body.units !== 'imperial') {
      throw apiError(422, 'validation', 'Some fields need attention', { errors: { units: 'Choose metric or imperial' } });
    }
    await c.query(`UPDATE users SET units = $2 WHERE id = $1`, [user.id, body.units]);
    sendJson(res, 200, userProjection({ ...user, units: body.units }));
    return true;
  }
  if (pathname === '/api/me/last-screen' && method === 'PUT') {
    const body = await readJson(req);
    if (typeof body.path !== 'string' || !isSafePath(body.path, user)) {
      throw apiError(422, 'validation', 'Some fields need attention', { errors: { path: 'Send a screen address this role may open' } });
    }
    await c.query(`UPDATE users SET last_screen = $2 WHERE id = $1`, [user.id, body.path]);
    sendJson(res, 204, {});
    return true;
  }
  if (pathname === '/api/status' && method === 'GET') {
    sendJson(res, 200, { storage: storageStatus(), mail: mailStatus() });
    return true;
  }
  if (pathname === '/api/client-orgs' && method === 'GET') {
    if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
    const r = await c.query(`SELECT id, name, time_zone FROM client_orgs ORDER BY id`);
    sendJson(res, 200, r.rows);
    return true;
  }

  // ---------- vessels ----------
  if (pathname === '/api/vessels' && method === 'GET') {
    await handleVesselsList(c, res, user);
    return true;
  }
  if (seg[0] === 'vessels' && seg.length >= 2) {
    const vesselId = seg[1]!;
    if (seg.length === 2 && method === 'GET') { await handleVesselGet(c, res, user, vesselId); return true; }
    if (seg.length === 2 && method === 'PATCH') { await handleVesselPatch(c, req, res, user, vesselId); return true; }
    if (seg.length === 3 && seg[2] === 'afloat' && method === 'POST') { await handleAfloat(c, req, res, user, vesselId); return true; }
    if (seg.length === 3 && seg[2] === 'recovered' && method === 'POST') { await handleRecovered(c, req, res, user, vesselId); return true; }
    if (seg.length === 3 && seg[2] === 'services' && method === 'POST') { await handleServiceCreate(c, req, res, user, vesselId); return true; }
    if (seg.length === 3 && seg[2] === 'services' && method === 'GET') { await handleServiceList(c, res, user, vesselId); return true; }
    if (seg.length === 3 && seg[2] === 'fixes' && method === 'GET') { await handleVesselFixes(c, req, res, user, vesselId); return true; }
    methodNotAllowed();
  }

  // ---------- missions ----------
  if (pathname === '/api/missions' && method === 'GET') {
    const r = await c.query(
      isClient(user)
        ? `SELECT * FROM missions WHERE client_org_id = $1 ORDER BY survey_date DESC, lower(name), id`
        : `SELECT * FROM missions ORDER BY survey_date DESC, lower(name), id`,
      isClient(user) ? [user.client_org_id] : []);
    const out = [];
    for (const m of r.rows) out.push(await missionProjection(c, m, isClient(user)));
    sendJson(res, 200, out);
    return true;
  }
  if (pathname === '/api/plan-preview' && method === 'POST') {
    await handlePlanPreview(c, req, res);
    return true;
  }
  if (pathname === '/api/missions' && method === 'POST') {
    await handleCreateMission(c, req, res, user);
    return true;
  }
  if (seg[0] === 'missions' && seg.length >= 2) {
    const missionId = seg[1]!;
    if (seg.length === 2 && method === 'GET') {
      const m = (await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId])).rows[0];
      if (!m || (isClient(user) && m.client_org_id !== user.client_org_id)) {
        throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
      }
      sendJson(res, 200, await missionProjection(c, m, isClient(user)));
      return true;
    }
    if (seg.length === 3 && seg[2] === 'lines' && method === 'GET') {
      const { requireMission, missionLineRows, lineProjection } = await import('./api-utils.js');
      await requireMission(c, user, missionId);
      const lines = await missionLineRows(c, missionId);
      const nameById = new Map<string, string>();
      for (const l of lines) {
        if (l.vessel_id && !nameById.has(l.vessel_id)) {
          nameById.set(l.vessel_id, (await c.query(`SELECT name FROM vessels WHERE id = $1`, [l.vessel_id])).rows[0]!.name);
        }
      }
      sendJson(res, 200, lines.map(l => lineProjection(l, l.vessel_id ? nameById.get(l.vessel_id) ?? null : null)));
      return true;
    }
    if (seg.length === 3 && seg[2] === 'assignments' && method === 'POST') {
      await handleAssignments(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'transitions' && method === 'POST') {
      await handleMissionTransition(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'coverage' && method === 'GET') {
      await handleCoverageGet(c, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'coverage.csv' && method === 'GET') {
      await handleCoverageCsv(c, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'tracks' && method === 'GET') {
      await handleTracks(c, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'holidays' && method === 'GET') {
      const { requireMission } = await import('./api-utils.js');
      await requireMission(c, user, missionId);
      sendJson(res, 200, await holidayProjection(c, missionId, isClient(user)));
      return true;
    }
    if (seg.length === 3 && seg[2] === 'history' && method === 'GET') {
      await handleHistory(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'handover' && method === 'POST') {
      await handleHandover(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'hold' && method === 'POST') {
      await handleHold(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'resume' && method === 'POST') {
      await handleResume(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'geofence' && method === 'PUT') {
      await handleGeofencePut(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'report' && method === 'GET') {
      await handleReportRead(c, req, res, user, missionId);
      return true;
    }
    if (seg.length === 5 && seg[2] === 'holidays' && seg[4] === 'infill' && method === 'POST') {
      await handleInfillQueue(c, req, res, user, missionId, seg[3]!);
      return true;
    }
    if (seg.length === 5 && seg[2] === 'vessels' && (seg[4] === 'infill-order')) {
      if (method === 'GET') { await handleInfillOrderGet(c, res, user, missionId, seg[3]!); return true; }
      if (method === 'PUT') { await handleInfillOrderPut(c, req, res, user, missionId, seg[3]!); return true; }
      methodNotAllowed();
    }
    if (seg.length === 5 && seg[2] === 'lines' && seg[4] === 'rerun' && method === 'POST') {
      await handleRerun(c, req, res, user, missionId, seg[3]!);
      return true;
    }
    if (seg.length === 5 && seg[2] === 'lines' && seg[4] === 'flags' && method === 'POST') {
      await handleFlagCreate(c, req, res, user, missionId, seg[3]!);
      return true;
    }
    methodNotAllowed();
  }

  // ---------- alerts ----------
  if (pathname === '/api/alerts' && method === 'GET') {
    if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
    const status = new URL(req.url ?? '', 'http://x').searchParams.get('status') ?? 'open';
    const r = status === 'all'
      ? await c.query(`SELECT a.*, v.name AS vessel_name FROM alerts a JOIN vessels v ON v.id = a.vessel_id ORDER BY a.raised_at DESC, a.id`)
      : await c.query(`SELECT a.*, v.name AS vessel_name FROM alerts a JOIN vessels v ON v.id = a.vessel_id WHERE a.state <> 'Closed' ORDER BY a.raised_at DESC, a.id`);
    const out = [];
    for (const a of r.rows) out.push(await alertProjection(c, a));
    sendJson(res, 200, out);
    return true;
  }
  if (seg[0] === 'alerts' && seg[2] === 'ack' && method === 'POST' && seg.length === 3) {
    if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
    const r = await c.query(`SELECT * FROM alerts WHERE id = $1 FOR UPDATE`, [seg[1]!]);
    if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
    const a = r.rows[0]!;
    const { recordEvent } = await import('./core.js');
    if (a.state === 'Active') {
      await c.query(`UPDATE alerts SET state = 'Acknowledged', acknowledged_at = now(), acknowledged_by = $2, acknowledged_by_name = $3 WHERE id = $1`,
        [a.id, user.id, user.name]);
      await c.query(`INSERT INTO alert_history (alert_id, state, at, by) VALUES ($1,'Acknowledged', now(), $2)`, [a.id, user.name]);
      await recordEvent(c, a.mission_id, 'alert', user.name, `${a.heading} Acknowledged`);
    } else if (a.state === 'Rectified') {
      await c.query(`UPDATE alerts SET state = 'Closed', acknowledged_at = now(), acknowledged_by = $2, acknowledged_by_name = $3 WHERE id = $1`,
        [a.id, user.id, user.name]);
      await c.query(`INSERT INTO alert_history (alert_id, state, at, by) VALUES ($1,'Closed', now(), $2)`, [a.id, user.name]);
      await recordEvent(c, a.mission_id, 'alert', user.name, `${a.heading} Closed`);
    }
    const a2 = (await c.query(`SELECT a.*, v.name AS vessel_name FROM alerts a JOIN vessels v ON v.id = a.vessel_id WHERE a.id = $1`, [seg[1]!])).rows[0]!;
    sendJson(res, 200, await alertProjection(c, a2));
    return true;
  }

  // ---------- flags ----------
  if (pathname === '/api/flags' && method === 'GET') {
    if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
    const state = new URL(req.url ?? '', 'http://x').searchParams.get('state') ?? 'open';
    const r = await c.query(
      state === 'all'
        ? `SELECT f.*, m.name AS mission_name, l.label AS line_label, o.name AS org_name, u.name AS by_name
           FROM flags f JOIN missions m ON m.id = f.mission_id JOIN lines l ON l.id = f.line_id
           JOIN client_orgs o ON o.id = m.client_org_id JOIN users u ON u.id = f.by
           ORDER BY f.at DESC`
        : `SELECT f.*, m.name AS mission_name, l.label AS line_label, o.name AS org_name, u.name AS by_name
           FROM flags f JOIN missions m ON m.id = f.mission_id JOIN lines l ON l.id = f.line_id
           JOIN client_orgs o ON o.id = m.client_org_id JOIN users u ON u.id = f.by
           WHERE f.state = 'Open' ORDER BY f.at DESC`);
    sendJson(res, 200, r.rows.map((f: Record<string, unknown>) => ({
      id: f.id, mission_id: f.mission_id, mission_name: f.mission_name,
      line_id: f.line_id, line_label: f.line_label,
      comment: f.comment, by: f.by_name, at: isoT(new Date(f.at as string)),
      state: f.state, reply: f.reply, client_name: f.org_name,
    })));
    return true;
  }
  if (seg[0] === 'flags' && seg[2] === 'reply' && method === 'POST' && seg.length === 3) {
    if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 1 || text.length > 500) {
      throw apiError(422, 'validation', 'Some fields need attention', { errors: { text: 'Write a reply of 1 to 500 characters' } });
    }
    const r = await c.query(`SELECT * FROM flags WHERE id = $1 FOR UPDATE`, [seg[1]!]);
    if (r.rows.length === 0) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
    const f = r.rows[0]!;
    if (f.state === 'Answered') throw apiError(409, 'flag_answered', 'This flag has already been answered');
    await c.query(`UPDATE flags SET state = 'Answered', reply = $2, replied_at = now() WHERE id = $1`, [f.id, text]);
    const m = (await c.query(`SELECT m.name FROM missions m WHERE m.id = $1`, [f.mission_id])).rows[0]!;
    const l = (await c.query(`SELECT label FROM lines WHERE id = $1`, [f.line_id])).rows[0]!;
    const reviewer = (await c.query(`SELECT email FROM users WHERE id = $1`, [f.by])).rows[0]!;
    const { emailOutbox } = await import('./mail.js');
    await emailOutbox.queueFlagReply(c, f.id, f.mission_id, m.name, l.label, text, reviewer.email);
    const f2 = (await c.query(`SELECT * FROM flags WHERE id = $1`, [f.id])).rows[0]!;
    sendJson(res, 200, {
      id: f2.id, line_label: l.label, comment: f2.comment, by: f2.by,
      at: isoT(new Date(f2.at as string)), state: f2.state, reply: f2.reply,
    });
    return true;
  }

  // ---------- lines ----------
  if (seg[0] === 'lines' && seg.length >= 2) {
    const lineId = seg[1]!;
    if (seg.length === 3 && seg[2] === 'file' && method === 'PUT') {
      await handleFileUpload(c, req, res, user, lineId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'file' && method === 'GET') {
      await handleFileDownload(c, req, res, user, lineId);
      return true;
    }
    if (seg.length === 3 && seg[2] === 'uploads' && method === 'POST') {
      await handleUploadCreate(c, req, res, user, lineId);
      return true;
    }
    if (seg.length === 4 && seg[2] === 'uploads' && method === 'PUT') {
      await handleUploadPart(c, req, res, user, lineId, seg[3]!);
      return true;
    }
    methodNotAllowed();
  }

  sendJson(res, 404, { error: 'not_found', message: 'That page does not exist or is not shared with you.' });
  return true;
}

async function handleReportRead(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, missionId: string): Promise<void> {
  const { requireMission } = await import('./api-utils.js');
  await requireMission(c, user, missionId);
  // Storage check right after step 4: before any 409
  if (storageStatus() === 'down') {
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  const stored = (await c.query(`SELECT bytes, sha256 FROM mission_report WHERE mission_id = $1`, [missionId])).rows[0];
  const mission = (await c.query(`SELECT report_state FROM missions WHERE id = $1`, [missionId])).rows[0]!;
  if (mission.report_state !== 'Ready' || !stored) {
    throw apiError(409, 'report_not_ready', 'The coverage report is not ready yet');
  }
  const bytes = Buffer.from(stored.bytes as Uint8Array);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': String(bytes.length),
    'X-Content-SHA256': stored.sha256 as string,
  });
  res.end(bytes);
}

function tokenHash(token: string): string { return sha256Hex(token); }

function parseCookieToken(req: IncomingMessage): string {
  const raw = req.headers['cookie'];
  if (typeof raw !== 'string') return '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'swathdeck_session') return rest.join('=');
  }
  return '';
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return await readJsonBody(req, 64000) as Record<string, unknown>;
}

