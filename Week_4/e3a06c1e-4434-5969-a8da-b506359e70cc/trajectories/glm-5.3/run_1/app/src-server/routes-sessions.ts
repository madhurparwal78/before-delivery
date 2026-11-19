// Session start (console + /v1), session reads, events, spectrum, audio, close, search.

import { randomUUID } from 'node:crypto';
import { errors, ApiError } from './errors';
import { json, route, type Ctx, type Route } from './router';
import { readJson, readMultipart, MULTIPART_BODY_LIMIT } from './body';
import { requireAction, requireProjectVisible, visibleProjectIds } from './access';
import { principalForToken } from './auth';
import { checkText, normaliseText, splitWords } from '../src-shared/text';
import { UPLOAD_STATUS, FIELD_MESSAGES, KEYS_STATUS } from '../src-shared/copy';
import { parseWav, toneFixture } from '../src-shared/audio';
import { parseSidecar, type SidecarCue } from '../src-shared/vtt';
import {
  iso, sessionObject, loadSessionRow, requireSessionVisible, loadSegmentRow,
  segmentObject, sessionWer, SESSION_COLUMNS,
} from './api';
import { Storage } from './storage';
import { beginIdempotent, finishIdempotent, fingerprint } from './idempotency';
import type { Session } from '../src-shared/protocol';

const AUDIO_MAX = 50000000;
const SIDECAR_MAX = 200000;
const MULTIPART_TOTAL = 50400000;

export async function startSession(ctx: Ctx, opts: {
  projectId: string;
  orgId: string;
  keyId: string;
  source: 'tone' | 'upload' | 'live';
  label: string;
  channels: number;
  audio?: Buffer;
  sidecar?: Buffer;
  idempotencyKey?: string;
  plan: 'pilot' | 'scale';
}): Promise<{ status: number; body: unknown }> {
  const sessionId = randomUUID();
  const cues: SidecarCue[] = [];
  let wav: Buffer | null = null;

  if (opts.source === 'upload') {
    if (!opts.audio) throw errors.validation({ audio: UPLOAD_STATUS.audioError });
    if (opts.audio.length > AUDIO_MAX) throw errors.validation({ audio: UPLOAD_STATUS.tooLarge });
    const parsed = parseWav(opts.audio);
    if (!parsed) throw errors.validation({ audio: UPLOAD_STATUS.audioError });
    wav = opts.audio;
    opts.channels = parsed.channels;
  } else if (opts.source === 'tone') {
    wav = Buffer.from(toneFixture());
    opts.channels = 1;
  }
  if (opts.sidecar) {
    if (opts.sidecar.length > SIDECAR_MAX) throw errors.validation({ sidecar: UPLOAD_STATUS.sidecarError });
    const parsed = parseSidecar(opts.sidecar.toString('utf8'));
    if (!parsed) throw errors.validation({ sidecar: UPLOAD_STATUS.sidecarError });
    cues.push(...parsed);
  }

  // Quota refusal comes after validation, before storage (DP-35).
  const { rows: proj } = await ctx.db.query(`SELECT monthly_quota_minutes FROM projects WHERE id=$1`, [opts.projectId]);
  const quota = await ctx.hub.quotaFor(opts.projectId, proj[0].monthly_quota_minutes as number);
  if (quota.exhausted) throw errors.tooMany('quota_exhausted', 'This project\u2019s quota is used up.');

  // A replay's capture object must exist in storage before the session row is created.
  const keys = Storage.sessionKeys(opts.orgId, opts.projectId, sessionId);
  if (opts.source === 'upload') await ctx.storage.put(keys.upload, wav!, 'audio/wav');
  if (opts.source === 'tone') await ctx.storage.put(keys.upload, wav!, 'audio/wav');
  if (opts.sidecar) await ctx.storage.put(keys.sidecar, opts.sidecar, 'text/vtt; charset=utf-8');

  await ctx.db.query(
    `INSERT INTO sessions (id, project_id, org_id, kind, source, label, channels, plan, key_id, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'connecting')`,
    [sessionId, opts.projectId, opts.orgId, opts.source === 'live' ? 'live' : 'replay', opts.source, opts.label, opts.channels, opts.plan, opts.keyId],
  );
  ctx.hub.register({
    id: sessionId, projectId: opts.projectId, orgId: opts.orgId,
    kind: opts.source === 'live' ? 'live' : 'replay', label: opts.label,
    channels: opts.channels, plan: opts.plan, keyId: opts.keyId, cues,
  });

  if (opts.source !== 'live') {
    await ctx.hub.markLive(sessionId);
    const parsed = parseWav(wav!);
    if (parsed) ctx.hub.startReplay(sessionId, parsed.samples, parsed.channels);
  }

  const row = await loadSessionRow(ctx.db, sessionId);
  return { status: 201, body: { session: sessionObject(row!) } };
}

export function sessionRoutes(): Route[] {
  return [
    route('POST', '/api/projects/:project_id/sessions', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'runSessions');
      const projectId = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, projectId);
      const form = await readMultipart(ctx.req);
      const keyId = form.fields['key_id'] ?? '';
      const source = form.fields['source'] ?? '';
      const labelRaw = form.fields['label'] ?? '';
      const idempotencyKey = ctx.req.headers['idempotency-key'];

      const fields: Record<string, string> = {};
      if (keyId === '') fields.key_id = UPLOAD_STATUS.keyError;
      if (source !== 'tone' && source !== 'upload') fields.source = FIELD_MESSAGES.source;
      const labelCheck = checkText(labelRaw, 0, 80);
      if (!labelCheck.ok) fields.label = FIELD_MESSAGES.label;
      if (idempotencyKey !== undefined) {
        const kc = checkText(String(idempotencyKey), 1, 100);
        if (!kc.ok) fields.idempotency_key = FIELD_MESSAGES.idempotencyKey;
      }
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const { rows: keyRows } = await ctx.db.query(`SELECT id, revoked_at FROM api_keys WHERE id=$1 AND project_id=$2`, [keyId, projectId]);
      if (keyRows.length === 0) throw errors.notFound();
      if (keyRows[0].revoked_at !== null) throw errors.conflict('key_revoked', 'Choose an active API key.');

      if (source === 'upload' && !form.files['audio']) {
        throw errors.validation({ audio: UPLOAD_STATUS.audioError });
      }

      const { rows: org } = await ctx.db.query(`SELECT plan FROM orgs WHERE id=$1`, [member.org_id]);
      const plan = (org[0].plan as 'pilot' | 'scale');

      const startLabel = (labelCheck as { value: string }).value;
      const fp = fingerprint([
        'POST', `/api/projects/${projectId}/sessions`, keyId, source, startLabel,
        form.files['audio']?.data ?? Buffer.alloc(0), form.files['sidecar']?.data ?? Buffer.alloc(0), plan,
      ]);
      const result = await runWithIdempotency(ctx, member.id, idempotencyKey, fp, async () => {
        return startSession(ctx, {
          projectId, orgId: member.org_id, keyId,
          source: source as 'tone' | 'upload', label: startLabel,
          channels: 1,
          audio: form.files['audio']?.data,
          sidecar: form.files['sidecar']?.data,
          plan,
        });
      });
      if (result.replayed && result.stored) {
        const stored = result.stored;
        ctx.res.writeHead(stored.status, { 'Content-Type': stored.contentType, 'Content-Length': stored.body.length });
        ctx.res.end(stored.body);
        return;
      }
      json(ctx, result.status, result.body);
    }),

    route('GET', '/api/projects/:project_id/sessions', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const projectId = ctx.url.pathname.split('/')[3];
      await requireProjectVisible(ctx.db, member, projectId);
      const stateFilter = ctx.url.searchParams.get('state');
      const { rows } = await ctx.db.query(
        `SELECT ${SESSION_COLUMNS},
                (SELECT count(*)::int FROM segments sg WHERE sg.session_id = sessions.id AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements(sg.machine_words) w WHERE (w->>'confidence')::numeric < 0.85)) AS flagged_segments
           FROM sessions WHERE project_id=$1 ${stateFilter ? 'AND state=$2' : ''} ORDER BY started_at DESC`,
        stateFilter ? [projectId, stateFilter] : [projectId],
      );
      const sessions = [];
      for (const r of rows) {
        const row = r as unknown as import('./api').SessionRow;
        row.wer = await sessionWer(ctx.db, row.id);
        sessions.push(sessionObject(row));
      }
      json(ctx, 200, { sessions });
    }),

    route('GET', '/api/sessions/search', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'searchSessions');
      const q = ctx.url.searchParams.get('q') ?? '';
      const qc = checkText(q, 1, 100);
      if (!qc.ok) throw errors.validation({ q: FIELD_MESSAGES.search });
      const visible = await visibleProjectIds(ctx.db, member);
      if (visible.length === 0) { json(ctx, 200, { total: 0, sessions: [] }); return; }
      const like = `%${qc.value.toLowerCase()}%`;
      const { rows } = await ctx.db.query(
        `SELECT ${SESSION_COLUMNS},
                (SELECT count(*)::int FROM segments sg WHERE sg.session_id = sessions.id AND EXISTS (
                   SELECT 1 FROM jsonb_array_elements(sg.machine_words) w WHERE (w->>'confidence')::numeric < 0.85)) AS flagged_segments
           FROM sessions
          WHERE project_id = ANY($1::uuid[])
            AND (lower(label) LIKE $2
                 OR EXISTS (SELECT 1 FROM segments sg WHERE sg.session_id = sessions.id
                       AND EXISTS (SELECT 1 FROM jsonb_array_elements(sg.machine_words) w WHERE lower(w->>'text') LIKE $2)))
          ORDER BY started_at DESC LIMIT 50`,
        [visible, like],
      );
      const sessions = [];
      for (const r of rows) {
        const row = r as unknown as import('./api').SessionRow;
        row.wer = await sessionWer(ctx.db, row.id);
        sessions.push(sessionObject(row));
      }
      json(ctx, 200, { total: sessions.length, sessions });
    }),

    route('GET', '/api/sessions/:session_id', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const id = ctx.url.pathname.split('/')[3];
      const row = await requireSessionVisible(ctx, id);
      row.wer = await sessionWer(ctx.db, id);
      json(ctx, 200, { session: sessionObject(row) });
    }),

    route('POST', '/api/sessions/:session_id/close', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'runSessions');
      const id = ctx.url.pathname.split('/')[3];
      await requireSessionVisible(ctx, id);
      if (!ctx.hub.isTracked(id)) throw errors.conflict('session_ended', 'This session has already ended.');
      await ctx.hub.finish(id, 'closed', 'client');
      const row = await loadSessionRow(ctx.db, id);
      row!.wer = await sessionWer(ctx.db, id);
      json(ctx, 200, { session: sessionObject(row!) });
    }),

    route('GET', '/api/sessions/:session_id/spectrum', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const id = ctx.url.pathname.split('/')[3];
      await requireSessionVisible(ctx, id);
      const { rows } = await ctx.db.query(
        `SELECT frame, bins, peak_bin FROM spectrum_rows WHERE session_id=$1 ORDER BY frame DESC LIMIT 240`,
        [id],
      );
      const ordered = rows.slice().reverse();
      const mean = new Array(64).fill(0);
      for (const r of ordered) {
        const bins = r.bins as number[];
        for (let i = 0; i < 64; i++) mean[i] += bins[i] ?? 0;
      }
      if (ordered.length > 0) for (let i = 0; i < 64; i++) mean[i] = Math.round((mean[i] / ordered.length) * 1000) / 1000;
      const last = ordered.length > 0 ? ordered[ordered.length - 1] : null;
      json(ctx, 200, {
        frame: last ? last.frame : 0,
        peak_bin: last ? last.peak_bin : 0,
        rows: ordered.map((r) => r.bins as number[]),
        mean,
      });
    }),

    route('GET', '/api/sessions/:session_id/audio', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const id = ctx.url.pathname.split('/')[3];
      const row = await requireSessionVisible(ctx, id);
      if (row.source === 'live') {
        // The live capture: received PCM messages joined in order.
        const live = ctx.hub.captureChunks(id);
        if (ctx.hub.isTracked(id) && live.length > 0) {
          const data = Buffer.concat(live);
          ctx.res.writeHead(200, { 'Content-Type': `audio/L16;rate=16000;channels=${row.channels}`, 'Content-Length': data.length });
          ctx.res.end(data);
          return;
        }
        const data = await ctx.storage.get(Storage.sessionKeys(row.project_id && member.org_id, row.project_id, id).capture);
        ctx.res.writeHead(200, { 'Content-Type': `audio/L16;rate=16000;channels=${row.channels}`, 'Content-Length': data.length });
        ctx.res.end(data);
        return;
      }
      const data = await ctx.storage.get(Storage.sessionKeys(member.org_id, row.project_id, id).upload);
      ctx.res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length });
      ctx.res.end(data);
    }),

    route('GET', '/api/sessions/:session_id/transcript', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const id = ctx.url.pathname.split('/')[3];
      await requireSessionVisible(ctx, id);
      const { rows } = await ctx.db.query(
        `SELECT id, index_in_session, start_ms, end_ms, machine_words FROM segments WHERE session_id=$1 ORDER BY index_in_session`,
        [id],
      );
      const segments = [];
      for (const r of rows) segments.push(await segmentObject(ctx.db, r as never));
      json(ctx, 200, { segments, wer: await sessionWer(ctx.db, id) });
    }),

    route('GET', '/api/sessions/:session_id/transcript/machine.json', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const id = ctx.url.pathname.split('/')[3];
      const row = await requireSessionVisible(ctx, id);
      if (!row.ended_at) throw errors.conflict('session_open', 'This session is still open.');
      const data = await ctx.storage.get(Storage.sessionKeys(member.org_id, row.project_id, id).machineTranscript);
      ctx.res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': data.length });
      ctx.res.end(data);
    }),

    route('GET', '/api/sessions/:session_id/segments/:segment_id/audio', async (ctx: Ctx) => {
      const member = ctx.member;
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const parts = ctx.url.pathname.split('/');
      const row = await requireSessionVisible(ctx, parts[3]);
      const seg = await loadSegmentRow(ctx.db, parts[3], parts[5]);
      if (!seg) throw errors.notFound();
      // The segment's slice of the retained original, served as a WAV.
      const base = row.source === 'live'
        ? { kind: 'live' as const }
        : { kind: 'wav' as const };
      let pcm: Float32Array;
      let channels = row.channels;
      if (base.kind === 'live') {
        const live = ctx.hub.captureChunks(row.id);
        const data = live.length > 0 ? Buffer.concat(live) : await ctx.storage.get(Storage.sessionKeys(member.org_id, row.project_id, row.id).capture);
        pcm = pcmToFloats(data, channels);
      } else {
        const data = await ctx.storage.get(Storage.sessionKeys(member.org_id, row.project_id, row.id).upload);
        const parsed = parseWav(data);
        if (!parsed) throw errors.notFound();
        pcm = parsed.samples;
        channels = parsed.channels;
      }
      const frameStart = Math.floor((seg.start_ms / 1000) * 16000);
      const frameEnd = Math.max(frameStart, Math.floor((seg.end_ms / 1000) * 16000));
      const slice = new Int16Array(Math.max(0, frameEnd - frameStart));
      for (let i = frameStart; i < frameEnd; i++) {
        for (let c = 0; c < channels; c++) {
          const v = pcm[i * channels + c] ?? 0;
          slice[(i - frameStart)] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
        }
      }
      // Mix to mono WAV slice for playback.
      const { writeWav } = await import('../src-shared/audio');
      const data = writeWav(slice, 1);
      ctx.res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length });
      ctx.res.end(data);
    }),
  ];
}

function pcmToFloats(buf: Buffer, channels: number): Float32Array {
  const frames = Math.floor(buf.length / (2 * channels));
  const out = new Float32Array(frames * channels);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
  return out;
}

async function runWithIdempotency(
  ctx: Ctx,
  memberId: string,
  rawKey: string | string[] | undefined,
  fp: string,
  fn: () => Promise<{ status: number; body: unknown }>,
): Promise<{ replayed: boolean; status: number; body: unknown; stored?: { status: number; body: Buffer; contentType: string } }> {
  const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (key === undefined) {
    const r = await fn();
    return { replayed: false, ...r };
  }
  const kc = checkText(String(key), 1, 100);
  if (!kc.ok) throw errors.validation({ idempotency_key: FIELD_MESSAGES.idempotencyKey });
  const begun = await beginIdempotent(ctx.db, memberId, kc.value, 'POST', ctx.url.pathname, fp);
  if (begun !== 'new') {
    if (begun === 'in_progress') throw errors.conflict('idempotency_in_progress', 'The same request is still running.');
    return { replayed: true, status: begun.status, body: begun.body, stored: begun };
  }
  try {
    const r = await fn();
    const body = Buffer.from(JSON.stringify(r.body), 'utf8');
    await finishIdempotent(ctx.db, memberId, kc.value, r.status, body, 'application/json');
    return { replayed: false, ...r };
  } catch (e) {
    if (e instanceof ApiError) {
      const body = Buffer.from(JSON.stringify({ error: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) }), 'utf8');
      await finishIdempotent(ctx.db, memberId, kc.value, e.status, body, 'application/json');
    } else {
      await finishIdempotent(ctx.db, memberId, kc.value, 500, Buffer.alloc(0), 'application/json');
    }
    throw e;
  }
}
