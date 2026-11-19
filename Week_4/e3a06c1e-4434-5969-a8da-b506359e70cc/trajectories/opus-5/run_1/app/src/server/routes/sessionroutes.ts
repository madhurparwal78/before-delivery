import { randomUUID } from 'node:crypto';
import {
  isUuid,
  requireAction,
  requireActor,
  requireVisibleProject,
  visibleProjectIds,
  type Actor,
} from '../auth.js';
import { query, queryOne } from '../db/pool.js';
import { openStreamConnection } from '../db/pool.js';
import { readWav, sliceWav, toneFixture } from '../domain/audio.js';
import { fingerprintOf, withIdempotency } from '../domain/idempotency.js';
import { buildQuota, currentPeriod } from '../domain/quota.js';
import { BIN_COUNT, HISTORY_ROWS, meanOf } from '../domain/spectrum.js';
import { parseSidecar, type SidecarCue } from '../domain/sidecar.js';
import { closeOpenSession, createRunner, runnerFor, startReplay } from '../engine.js';
import { subscribe, type SessionEvent } from '../events.js';
import { conflict, notFound, quotaExhausted } from '../http/errors.js';
import { bytes, handled, json, type Reply, type Router } from '../http/router.js';
import { FieldErrors } from '../http/validate.js';
import { loadSegmentViews } from '../review.js';
import { getObject, putObject, sessionKeys } from '../services/storage.js';
import {
  isOpen,
  loadProject,
  loadSession,
  projectUsage,
  SESSION_COLUMNS,
  sessionView,
  type ProjectRow,
  type SessionRow,
} from '../store.js';
import { fieldCopy } from '../../shared/copy.js';
import { checkText } from '../../shared/text.js';
import type { Quota, SessionSource } from '../../shared/types.js';

const AUDIO_BYTE_LIMIT = 50_000_000;
const SIDECAR_BYTE_LIMIT = 200_000;

/** The published data shape of each event on the session stream. */
const eventPayload = (event: SessionEvent): unknown => {
  switch (event.type) {
    case 'state':
      return { state: event.state, close_reason: event.close_reason };
    case 'frame':
      return { frame: event.frame, audio_ms: event.audio_ms, peak_bin: event.peak_bin, bins: event.bins };
    case 'segment':
      return event.segment;
    case 'correction':
      return { segment: event.segment, wer: event.wer };
    case 'quota':
      return event.quota;
  }
};

export const requireVisibleSession = async (actor: Actor, sessionId: string): Promise<SessionRow> => {
  if (!isUuid(sessionId)) throw notFound();
  const session = await loadSession(sessionId);
  if (session === null || session.org_id !== actor.org.id) throw notFound();
  if (!actor.seesAllProjects) {
    const assigned = await queryOne<{ project_id: string }>(
      'select project_id from member_projects where member_id = $1 and project_id = $2',
      [actor.member.id, session.project_id],
    );
    if (assigned === null) throw notFound();
  }
  return session;
};

export const quotaOf = async (project: ProjectRow, now: Date): Promise<Quota> => {
  const usage = await projectUsage([project.id], now);
  return buildQuota(
    project.monthly_quota_minutes,
    usage.get(project.id)?.usedSeconds ?? 0,
    currentPeriod(now),
    now,
  );
};

/** While a project is exhausted, every new start is refused. */
export const refuseWhenExhausted = async (project: ProjectRow): Promise<void> => {
  const quota = await quotaOf(project, new Date());
  if (quota.exhausted) throw quotaExhausted();
};

export const readSessionAudio = async (session: SessionRow): Promise<{ pcm: Buffer; channels: number }> => {
  const keys = sessionKeys(session.org_id, session.project_id, session.id);
  if (session.source === 'live') {
    const capture = await getObject(keys.capture);
    return { pcm: capture, channels: session.channels };
  }
  const wav = await getObject(keys.upload);
  const info = readWav(wav);
  if (info === null) throw notFound();
  return { pcm: wav.subarray(info.dataOffset, info.dataOffset + info.dataBytes), channels: info.channels };
};

interface StartParts {
  readonly source: SessionSource | null;
  readonly audio: Buffer | null;
  readonly audioTooLarge: boolean;
  readonly channels: number;
  readonly sidecar: Buffer | null;
  readonly cues: readonly SidecarCue[];
  readonly sidecarBad: boolean;
}

const registerStart = (router: Router): void => {
  router.add('POST', '/api/projects/:projectId/sessions', async (ctx) => {
    const body = ctx.multipart;
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'manage_keys');

    const keyId = body.fields.key_id;
    const keyRow =
      keyId !== undefined && isUuid(keyId)
        ? await queryOne<{ id: string; revoked_at: Date | null }>(
            'select id, revoked_at from api_keys where id = $1 and project_id = $2',
            [keyId, project.id],
          )
        : null;
    if (keyId !== undefined && isUuid(keyId) && keyRow === null) throw notFound();

    const rawKey = ctx.req.headers['idempotency-key'];
    const keyText = typeof rawKey === 'string' ? checkText(rawKey, 1, 100) : null;
    const idempotencyKey = keyText !== null && keyText.ok ? keyText.value : null;

    const run = async (): Promise<Reply> => {
      if (keyRow !== null && keyRow.revoked_at !== null)
        throw conflict('key_revoked', 'That API key was revoked.');
      await refuseWhenExhausted(project);

      const parts = readStartParts(body.fields.source, body.files.audio?.bytes, body.files.sidecar?.bytes);
      const fields = new FieldErrors();
      if (keyRow === null) fields.add('key_id', fieldCopy.uploadKey);
      if (parts.source === null) fields.add('source', fieldCopy.source);
      if (parts.source === 'upload') {
        if (parts.audioTooLarge) fields.add('audio', fieldCopy.audioTooLarge);
        else if (parts.audio === null) fields.add('audio', fieldCopy.audio);
      }
      if (parts.sidecarBad) fields.add('sidecar', fieldCopy.sidecar);
      const label = checkText(body.fields.label ?? '', 0, 80);
      if (!label.ok) fields.add('label', fieldCopy.label);
      if (keyText !== null && !keyText.ok) fields.add('idempotency_key', fieldCopy.idempotencyKey);
      fields.raiseIfAny();

      const sessionId = randomUUID();
      const keys = sessionKeys(project.org_id, project.id, sessionId);
      await putObject(keys.upload, parts.audio as Buffer);
      if (parts.sidecar !== null) await putObject(keys.sidecar, parts.sidecar);

      const org = await queryOne<{ plan: string }>('select plan from orgs where id = $1', [project.org_id]);
      await query(
        `insert into sessions (id, project_id, org_id, kind, source, label, state, channels, plan, key_id, has_sidecar)
         values ($1, $2, $3, 'replay', $4, $5, 'connecting', $6, $7, $8, $9)`,
        [
          sessionId,
          project.id,
          project.org_id,
          parts.source as string,
          label.value,
          parts.channels,
          org?.plan ?? 'pilot',
          (keyRow as { id: string }).id,
          parts.sidecar !== null,
        ],
      );
      const session = await loadSession(sessionId);
      if (session === null) throw notFound();
      createRunner({
        sessionId,
        projectId: project.id,
        orgId: project.org_id,
        channels: parts.channels,
        plan: session.plan,
        source: session.source,
        keyId: session.key_id,
      });
      void startReplay(session, parts.cues).catch(() => {
        void closeOpenSession(sessionId, 'closed', 'disconnect');
      });
      return json(201, { session: sessionView(session, new Date()) });
    };

    return withIdempotency(
      actor.member.id,
      idempotencyKey,
      fingerprintOf(ctx.method, ctx.path, [
        body.fields.key_id ?? '',
        body.fields.source ?? '',
        body.fields.label ?? '',
        body.files.audio?.bytes ?? '',
        body.files.sidecar?.bytes ?? '',
      ]),
      run,
    );
  }, 'multipart');
};

const readStartParts = (
  rawSource: string | undefined,
  rawAudio: Buffer | undefined,
  rawSidecar: Buffer | undefined,
): StartParts => {
  const source = rawSource === 'tone' || rawSource === 'upload' ? rawSource : null;
  let audio: Buffer | null = null;
  let audioTooLarge = false;
  let channels = 1;
  if (source === 'tone') {
    audio = toneFixture();
    channels = 1;
  } else if (rawAudio !== undefined) {
    if (rawAudio.length > AUDIO_BYTE_LIMIT) audioTooLarge = true;
    else {
      const info = readWav(rawAudio);
      if (info !== null) {
        audio = rawAudio;
        channels = info.channels;
      }
    }
  }
  let sidecar: Buffer | null = null;
  let cues: readonly SidecarCue[] = [];
  let sidecarBad = false;
  if (rawSidecar !== undefined && rawSidecar.length > 0) {
    if (rawSidecar.length > SIDECAR_BYTE_LIMIT) sidecarBad = true;
    else {
      const parsed = parseSidecar(rawSidecar.toString('utf8'));
      if (parsed === null) sidecarBad = true;
      else {
        sidecar = rawSidecar;
        cues = parsed;
      }
    }
  }
  return { source, audio, audioTooLarge, channels, sidecar, cues, sidecarBad };
};

export const registerSessionRoutes = (router: Router): void => {
  registerStart(router);

  router.add('GET', '/api/projects/:projectId/sessions', async (ctx) => {
    const actor = await requireActor(ctx);
    const project = await requireVisibleProject(actor, ctx.params.projectId as string);
    requireAction(actor, 'read_sessions');
    const state = ctx.search.get('state');
    const rows = await query<SessionRow>(
      `select ${SESSION_COLUMNS} from sessions s where s.project_id = $1 and ($2::text is null or s.state = $2)
       order by s.started_at desc`,
      [project.id, state],
    );
    const now = new Date();
    return json(200, { sessions: rows.map((row) => sessionView(row, now)) });
  });

  router.add('GET', '/api/sessions/search', async (ctx) => {
    const actor = await requireActor(ctx);
    requireAction(actor, 'read_sessions');
    const fields = new FieldErrors();
    const q = checkText(ctx.search.get('q') ?? '', 1, 100);
    if (!q.ok) fields.add('q', fieldCopy.searchQuery);
    fields.raiseIfAny();
    const projectIds = await visibleProjectIds(actor);
    if (projectIds.length === 0) return json(200, { total: 0, sessions: [] });
    const pattern = `%${q.value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const rows = await query<SessionRow>(
      `select ${SESSION_COLUMNS} from sessions s
        where s.project_id = any($1::uuid[]) and (s.label ilike $2 or s.machine_text ilike $2)
        order by s.started_at desc limit 50`,
      [projectIds, pattern],
    );
    const counted = await queryOne<{ total: number }>(
      `select count(*)::int as total from sessions s
        where s.project_id = any($1::uuid[]) and (s.label ilike $2 or s.machine_text ilike $2)`,
      [projectIds, pattern],
    );
    const now = new Date();
    return json(200, { total: counted?.total ?? 0, sessions: rows.map((row) => sessionView(row, now)) });
  });

  router.add('GET', '/api/sessions/:sessionId', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    return json(200, { session: sessionView(session, new Date()) });
  });

  router.add('POST', '/api/sessions/:sessionId/close', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'manage_keys');
    if (!isOpen(session.state)) throw conflict('session_ended', 'That session has already ended.');
    await closeOpenSession(session.id, 'closed', 'client');
    const updated = await loadSession(session.id);
    if (updated === null) throw notFound();
    return json(200, { session: sessionView(updated, new Date()) });
  });

  router.add('GET', '/api/sessions/:sessionId/spectrum', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    const runner = runnerFor(session.id);
    if (runner !== undefined) {
      const snapshot = runner.snapshot();
      return json(200, {
        frame: snapshot.frame,
        peak_bin: snapshot.peak,
        rows: snapshot.rows,
        mean: snapshot.mean,
      });
    }
    const stored = await queryOne<{ rows: number[][]; sum: number[]; count: number }>(
      'select spectrum_rows as rows, spectrum_sum as sum, spectrum_count as count from sessions where id = $1',
      [session.id],
    );
    const rows = (stored?.rows ?? []).slice(-HISTORY_ROWS);
    return json(200, {
      frame: session.frame,
      peak_bin: session.peak_bin,
      rows,
      mean: meanOf(stored?.sum ?? new Array<number>(BIN_COUNT).fill(0), stored?.count ?? 0),
    });
  });

  router.add('GET', '/api/sessions/:sessionId/transcript', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    return json(200, { segments: await loadSegmentViews(session.id), wer: session.wer });
  });

  router.add('GET', '/api/sessions/:sessionId/transcript/machine.json', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    if (isOpen(session.state)) throw conflict('session_open', 'That session has not ended yet.');
    const keys = sessionKeys(session.org_id, session.project_id, session.id);
    return bytes(200, await getObject(keys.transcript), 'application/json');
  });

  router.add('GET', '/api/sessions/:sessionId/audio', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    const keys = sessionKeys(session.org_id, session.project_id, session.id);
    if (session.source === 'live')
      return bytes(
        200,
        await getObject(keys.capture),
        `audio/L16;rate=16000;channels=${session.channels}`,
      );
    return bytes(200, await getObject(keys.upload), 'audio/wav');
  });

  router.add('GET', '/api/sessions/:sessionId/segments/:segmentId/audio', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');
    const segment = await queryOne<{ start_ms: number; end_ms: number }>(
      'select start_ms, end_ms from segments where id = $1 and session_id = $2',
      [ctx.params.segmentId as string, session.id],
    );
    if (segment === null) throw notFound();
    const audio = await readSessionAudio(session);
    return bytes(
      200,
      sliceWav(audio.pcm, audio.channels, segment.start_ms, segment.end_ms),
      'audio/wav',
    );
  });

  /** Each event stream holds one dedicated, labelled Postgres connection for its lifetime. */
  router.add('GET', '/api/sessions/:sessionId/events', async (ctx) => {
    const actor = await requireActor(ctx);
    const session = await requireVisibleSession(actor, ctx.params.sessionId as string);
    requireAction(actor, 'read_sessions');

    const client = await openStreamConnection(session.id);
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let closed = false;
    let startedOpen = false;
    const send = (event: SessionEvent): void => {
      if (closed) return;
      ctx.res.write(`event: ${event.type}\ndata: ${JSON.stringify(eventPayload(event))}\n\n`);
    };

    const release = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      void client.end().catch(() => undefined);
      ctx.res.end();
    };

    /**
     * The stream ends after the final state event of a session that ends while it
     * is open. A stream opened on an already-ended session stays open, so later
     * correction events still reach every view of it.
     */
    const unsubscribe = subscribe(session.id, (event) => {
      send(event);
      if (event.type === 'state' && !isOpen(event.state) && startedOpen) release();
    });
    const heartbeat = setInterval(() => {
      if (!closed) ctx.res.write(': keep-alive\n\n');
    }, 15_000);

    ctx.req.on('close', release);
    ctx.res.on('close', release);

    const current = await client.query<{ state: string; close_reason: string | null }>(
      'select state, close_reason from sessions where id = $1',
      [session.id],
    );
    const row = current.rows[0];
    if (row !== undefined) {
      startedOpen = isOpen(row.state as SessionRow['state']);
      send({
        type: 'state',
        state: row.state as SessionRow['state'],
        close_reason: row.close_reason as SessionRow['close_reason'],
      });
      const project = await loadProject(session.project_id);
      if (project !== null) send({ type: 'quota', quota: await quotaOf(project, new Date()) });
    }
    return handled;
  });
};
