import http from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import { ApiError, sendJson } from './errors.js';
import {
  authenticate,
  broadcastPart,
  broadcastScore,
  collaboratorJson,
  decodeCursor,
  encodeCursor,
  hubFor,
  partJson,
  parseOp,
  partWithStaves,
  readJsonBody,
  readRawBody,
  requireRole,
  sameOriginCheck,
  scoreJsonFor,
  summarize,
  db,
  repo,
  engraver,
  AWARENESS_TTL_SECONDS,
  HISTORY_FIELDS,
} from './routes.js';
import { MINIO } from './services/minio.js';
import { VALKEY } from './services/valkey.js';
import { partPipeline } from './parts.js';
import {
  Clef,
  Transpose,
  MEASURE_CAP,
  NAME_INVITE_MAX,
  NAME_STAFF_MAX,
  OPS_MAX,
  SNAPSHOT_EVERY,
  STAFF_CAP,
  SYSTEMS_MAX,
  SYSTEMS_MIN,
  isClef,
  perceivedLength,
  stampKey,
} from '../domain/values.js';
import { Operation, ScoreModel, ElementId } from '../domain/scoremodel.js';
import { checkBankUpload } from '../domain/bankchecks.js';
import { isExtractable, nextPartStatus } from '../domain/partlifecycle.js';
import { bankKey, partPageKey, partPdfKey } from './keys.js';

export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  method: string,
  pathname: string,
): Promise<void> {
  sameOriginCheck(req);
  const parts = pathname.split('/').filter(Boolean);

  if (!(await db.healthy())) {
    throw ApiError.databaseUnavailable();
  }
  // invite routes need no auth
  if (parts.length === 3 && parts[1] === 'invites' && method === 'GET') return getInvite(res, parts[2]);
  if (parts.length === 4 && parts[1] === 'invites' && parts[3] === 'accept' && method === 'POST') {
    await readJsonBody(req).catch(() => ({}));
    return acceptInvite(res, parts[2]);
  }

  const scoreId = parts[1] === 'scores' && parts.length >= 3 ? parts[2] : null;
  const ctx = await authenticate(req, scoreId, url);

  if (parts.length === 2 && parts[1] === 'me' && method === 'GET') return getMe(res, ctx);

  if (scoreId && !(await repo.scoreExists(scoreId))) throw ApiError.notFound();
  if (!scoreId) throw ApiError.notFound();
  const sid = scoreId;

  if (parts.length === 3 && method === 'GET') return getScore(res, sid);
  if (parts.length === 4 && parts[3] === 'staves' && method === 'POST') return postStaff(req, res, ctx, sid);
  if (parts.length === 5 && parts[3] === 'staves' && method === 'PATCH') return patchStaff(req, res, ctx, sid, parts[4]);
  if (parts.length === 7 && parts[3] === 'staves' && parts[5] === 'voices' && method === 'GET') {
    return getVoice(res, ctx, sid, parts[4], Number(parts[6]), url);
  }
  if (parts.length === 4 && parts[3] === 'measures' && method === 'POST') return postMeasures(req, res, ctx, sid);
  if (parts.length === 4 && parts[3] === 'ops' && method === 'POST') return postOps(req, res, ctx, sid);
  if (parts.length === 4 && parts[3] === 'ops' && method === 'GET') return getOps(res, ctx, sid, url);
  if (parts.length === 4 && parts[3] === 'sync' && method === 'GET') return getSync(res, sid);
  if (parts.length === 4 && parts[3] === 'history' && method === 'GET') return getHistory(res, ctx, sid, url);
  if (parts.length === 4 && parts[3] === 'engraving' && method === 'GET') return getEngraving(res, ctx, sid, url);
  if (parts.length === 4 && parts[3] === 'holds' && method === 'GET') return getHolds(res, sid);
  if (parts.length === 4 && parts[3] === 'holds' && method === 'POST') return postHolds(req, res, ctx, sid);
  if (parts.length === 4 && parts[3] === 'holds' && method === 'DELETE') return deleteHolds(res, ctx, sid, url);
  if (parts.length === 4 && parts[3] === 'presence' && method === 'GET') return getPresence(res, sid);
  if (parts.length === 4 && parts[3] === 'collaborators' && method === 'GET') return getCollaborators(res, ctx, sid);
  if (parts.length === 4 && parts[3] === 'invites' && method === 'POST') return postInvite(req, res, ctx, sid);
  if (parts.length === 5 && parts[3] === 'collaborators' && method === 'PATCH') {
    return patchCollaborator(req, res, ctx, sid, parts[4]);
  }
  if (parts.length === 5 && parts[3] === 'collaborators' && method === 'DELETE') {
    return deleteCollaborator(res, ctx, sid, parts[4]);
  }
  if (parts.length === 4 && parts[3] === 'parts' && method === 'GET') return getParts(res, sid);
  if (parts.length === 6 && parts[5] === 'layout' && method === 'PUT') return putPartLayout(req, res, ctx, sid, parts[4]);
  if (parts.length === 6 && parts[5] === 'extract' && method === 'POST') return postExtract(res, ctx, sid, parts[4]);
  if (parts.length === 7 && parts[5] === 'pages' && parts[6].endsWith('.svg') && method === 'GET') {
    return getPartPage(res, ctx, sid, parts[4], Number(parts[6].slice(0, -4)));
  }
  if (parts.length === 6 && parts[5] === 'pdf' && method === 'GET') return getPartPdf(res, ctx, sid, parts[4]);
  if (parts.length === 4 && parts[3] === 'banks' && method === 'GET') return getBanks(res, sid);
  if (parts.length === 4 && parts[3] === 'banks' && method === 'POST') return postBank(req, res, ctx, sid, url);
  if (parts.length === 6 && parts[5] === 'content' && method === 'GET') return getBankContent(res, ctx, sid, parts[4]);

  throw ApiError.notFound();
}

// ---- identity ----

async function getMe(res: http.ServerResponse, ctx: Awaited<ReturnType<typeof authenticate>>): Promise<void> {
  const score = await repo.scoreRow(ctx.scoreId);
  if (!score) throw ApiError.notFound();
  sendJson(res, 200, { collaborator: collaboratorJson(ctx.collaborator), score: { id: score.id, title: score.title } });
}

// ---- score ----

async function getScore(res: http.ServerResponse, scoreId: string): Promise<void> {
  const hub = await hubFor(scoreId);
  const payload = await scoreJsonFor(hub);
  sendJson(res, 200, payload);
}

async function postStaff(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || perceivedLength(name) > NAME_STAFF_MAX) errors['name'] = 'Use a name of 1 to 40 characters.';
  let clef: Clef = 'treble';
  if (body.clef !== undefined && body.clef !== null) {
    if (!isClef(body.clef)) errors['clef'] = 'Choose a clef.';
    else clef = body.clef;
  }
  let transpose: Transpose = { diatonic: 0, chromatic: 0 };
  if (body.transpose !== undefined && body.transpose !== null) {
    const t = body.transpose as Transpose;
    if (typeof t !== 'object' || typeof t.diatonic !== 'number' || typeof t.chromatic !== 'number') {
      errors['transpose'] = 'Choose a transposition.';
    } else {
      transpose = t;
    }
  }
  const staves = await repo.staves(scoreId);
  if (staves.length >= STAFF_CAP) errors['staves'] = 'A score holds at most 64 staves.';
  let partId: string | null = null;
  if (body.partId !== undefined && body.partId !== null) {
    const parts = await repo.parts(scoreId);
    if (typeof body.partId !== 'string' || !parts.some((p) => p.id === body.partId)) errors['partId'] = 'Unknown part.';
    else partId = body.partId;
  }
  let afterStaffId: string | null = null;
  if (body.afterStaffId !== undefined && body.afterStaffId !== null) {
    if (typeof body.afterStaffId !== 'string' || !staves.some((s) => s.id === body.afterStaffId)) {
      errors['afterStaffId'] = 'Unknown staff.';
    } else afterStaffId = body.afterStaffId;
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const id = `st-${crypto.randomBytes(4).toString('hex')}`;
  const order = afterStaffId ? staves.find((s) => s.id === afterStaffId)!.order + 0.5 : staves.length;
  if (!partId) {
    const newPartId = `p-${crypto.randomBytes(4).toString('hex')}`;
    await db.query(
      'INSERT INTO parts (id, score_id, name, status, revision, stale, layout, last_error) VALUES ($1,$2,$3,$4,0,false,$5,null)',
      [newPartId, scoreId, name, 'draft', JSON.stringify({ systemBreaks: [], pageBreaks: [] })],
    );
    partId = newPartId;
  }
  await db.query(
    'INSERT INTO staves (id, score_id, name, clef, transpose, part_id, "order") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, scoreId, name, clef, JSON.stringify(transpose), partId, order],
  );
  let i = 1;
  for (const s of (await repo.staves(scoreId)).sort((a, b) => a.order - b.order)) {
    await db.query('UPDATE staves SET "order" = $1 WHERE score_id = $2 AND id = $3', [i, scoreId, s.id]);
    i++;
  }
  const hub = await hubFor(scoreId);
  await hub.load();
  await broadcastScore(hub);
  const staff = (await repo.staves(scoreId)).find((s) => s.id === id)!;
  const part = await repo.parts(scoreId);
  sendJson(res, 201, {
    staff: { id: staff.id, name: staff.name, clef: staff.clef, transpose: staff.transpose, partId: staff.partId, order: staff.order },
    part: { ...partJson(part.find((p) => p.id === partId)!), staffIds: (await repo.staves(scoreId)).filter((s) => s.partId === partId).map((s) => s.id) },
  });
}

async function patchStaff(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  staffId: string,
): Promise<void> {
  requireRole(ctx, ['composer', 'copyist']);
  const staves = await repo.staves(scoreId);
  if (!staves.some((s) => s.id === staffId)) throw ApiError.notFound();
  const hub = await hubFor(scoreId);
  const hold = hub.holds.get(staffId);
  if (!hold || hold.holderId !== ctx.collaborator.id) {
    if (hold) {
      const collaborators = await repo.collaborators(scoreId);
      const holder = collaborators.find((c) => c.id === hold.holderId)!;
      throw ApiError.staffHeld(
        { id: holder.id, name: holder.name, role: holder.role },
        [staffId],
        [staves.find((s) => s.id === staffId)!.name],
      );
    }
    throw ApiError.holdRequired();
  }
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || perceivedLength(name) > NAME_STAFF_MAX) errors['name'] = 'Use a name of 1 to 40 characters.';
    else updates['name'] = name;
  }
  if (body.clef !== undefined) {
    if (!isClef(body.clef)) errors['clef'] = 'Choose a clef.';
    else updates['clef'] = body.clef;
  }
  if (body.transpose !== undefined && body.transpose !== null) {
    const t = body.transpose as Transpose;
    if (typeof t !== 'object' || typeof t.diatonic !== 'number' || typeof t.chromatic !== 'number') {
      errors['transpose'] = 'Choose a transposition.';
    } else updates['transpose'] = JSON.stringify(t);
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  for (const [field, value] of Object.entries(updates)) {
    await db.query(`UPDATE staves SET ${field === 'transpose' ? 'transpose' : field} = $1 WHERE score_id = $2 AND id = $3`, [
      field === 'transpose' ? JSON.stringify(value) : value,
      scoreId,
      staffId,
    ]);
  }
  await hub.load();
  await broadcastScore(hub);
  const updated = (await repo.staves(scoreId)).find((s) => s.id === staffId)!;
  sendJson(res, 200, {
    staff: { id: updated.id, name: updated.name, clef: updated.clef, transpose: updated.transpose, partId: updated.partId, order: updated.order },
  });
}

async function postMeasures(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const count = body.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 2000) {
    errors['count'] = 'Add 1 to 2000 measures.';
  }
  let ts: { beats: number; beatType: number } | null = null;
  if (body.timeSignature !== undefined && body.timeSignature !== null) {
    const t = body.timeSignature as { beats?: unknown; beatType?: unknown };
    if (typeof t !== 'object' || typeof t.beats !== 'number' || !Number.isInteger(t.beats) || t.beats < 1 || t.beats > 16 || ![1, 2, 4, 8, 16].includes(t.beatType as number)) {
      errors['timeSignature'] = 'Choose a time signature.';
    } else {
      ts = { beats: t.beats, beatType: t.beatType as number };
    }
  }
  const score = await repo.scoreRow(scoreId);
  if (!score) throw ApiError.notFound();
  if (typeof count === 'number' && Number.isInteger(count) && score.measureCount + count > MEASURE_CAP) {
    errors['measures'] = 'A score holds at most 2,000 measures.';
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const newCount = score.measureCount + (count as number);
  const tss = [...score.timeSignatures];
  if (ts) tss.push({ measure: score.measureCount + 1, beats: ts.beats, beatType: ts.beatType });
  await db.query('UPDATE scores SET measure_count = $1, time_signatures = $2 WHERE id = $3', [newCount, JSON.stringify(tss), scoreId]);
  const hub = await hubFor(scoreId);
  await hub.load();
  await broadcastScore(hub);
  sendJson(res, 200, { measureCount: newCount, timeSignatures: tss });
}

// ---- voices ----

async function getVoice(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  staffId: string,
  voice: number,
  url: URL,
): Promise<void> {
  void ctx;
  const staves = await repo.staves(scoreId);
  const staff = staves.find((s) => s.id === staffId);
  if (!staff) throw ApiError.notFound();
  if (voice !== 1 && voice !== 2) throw ApiError.notFound();
  const pitchParam = url.searchParams.get('pitch');
  const atWritten = pitchParam === 'written';
  const hub = await hubFor(scoreId);
  const model = hub.model!;
  const events = model.voiceEvents(staffId, voice, atWritten, staff.transpose);
  sendJson(res, 200, {
    staffId,
    voice,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      pitch: e.pitch ?? null,
      duration: e.duration,
      dots: e.dots,
      ticks: e.ticks,
      tie: e.tie,
      dynamic: e.dynamic ?? null,
      dynamicPlacement: e.dynamicPlacement ?? (e.kind === 'note' ? 'below' : null),
      text: e.text ?? null,
      measure: e.measure,
      beat: e.beat,
      pieces: e.pieces,
    })),
  });
}

// ---- operations ----

async function postOps(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
): Promise<void> {
  const hub = await hubFor(scoreId);
  const raw = (await readJsonBody(req)) as { ops?: unknown; seen?: unknown };
  await hub.serial(async () => {
    await recordOps(req, res, ctx, scoreId, hub, raw);
  });
}

async function recordOps(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  hub: Awaited<ReturnType<typeof hubFor>>,
  raw: { ops?: unknown; seen?: unknown },
): Promise<void> {
  void req;
  const staves = await repo.staves(scoreId);
  const model = hub.model!;
  const opsArr = Array.isArray(raw.ops) ? (raw.ops as Record<string, unknown>[]) : null;
  if (!opsArr || opsArr.length < 1 || opsArr.length > OPS_MAX) {
    throw ApiError.validation({ ops: 'Send 1 to 50 operations.' });
  }

  const errors: Record<string, string> = {};
  const parsed: { op: Operation }[] = [];
  for (let i = 0; i < opsArr.length; i++) {
    const result = parseOp(opsArr[i], ctx, staves, model);
    if (result.error) {
      const key = `ops[${i}]${result.error.key ? '.' + result.error.key : ''}`;
      errors[key] = result.error.message;
    } else {
      parsed.push({ op: result.op! });
    }
  }
  if (typeof raw.seen === 'number' && raw.seen >= 0) {
    await db.query(
      `INSERT INTO acks (score_id, collaborator_id, seen) VALUES ($1,$2,$3)
       ON CONFLICT (score_id, collaborator_id) DO UPDATE SET seen = GREATEST(acks.seen, EXCLUDED.seen)`,
      [scoreId, ctx.collaborator.id, Math.floor(raw.seen)],
    );
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  // the measure cap: does this batch need more measures than the cap allows?
  const needs = simulateMeasures(model, parsed.map((p) => p.op));
  if (needs > MEASURE_CAP) {
    throw ApiError.validation({ measures: 'A score holds at most 2,000 measures.' });
  }

  // duplicates and conflicts by element id
  const applied: ElementId[] = [];
  const duplicates: ElementId[] = [];
  const toRecord: Operation[] = [];
  for (const p of parsed) {
    const existing = await findRecordedOp(scoreId, p.op);
    if (existing) {
      if (stableStringify(existing) === stableStringify(p.op)) duplicates.push(p.op.id);
      else throw ApiError.opConflict(p.op.id.lamport, p.op.id.site);
    } else {
      toRecord.push(p.op);
    }
  }

  const now = Date.now();
  const decision = hub.throttle().check(ctx.collaborator.id, parsed.length, now);
  if (!decision.allowed) throw ApiError.rateLimited(decision.retryAfterSeconds);
  hub.throttle().accept(ctx.collaborator.id, parsed.length, now);

  if (toRecord.length > 0) {
    const client = await db.connect();
    const newOps: { seq: number; op: Operation }[] = [];
    try {
      await client.query('BEGIN');
      for (const op of toRecord) {
        const seq = hub.lastSeq + 1;
        await client.query(
          'INSERT INTO operations (score_id, seq, lamport, site, author_id, op) VALUES ($1,$2,$3,$4,$5,$6)',
          [scoreId, seq, op.id.lamport, op.id.site, ctx.collaborator.id, JSON.stringify(op)],
        );
        hub.lastSeq = seq;
        applied.push(op.id);
        model.applyRecorded(op);
        newOps.push({ seq, op });
      }
      model.measureCount = Math.max(model.measureCount, needs);
      await client.query('UPDATE scores SET lamport = $1, measure_count = GREATEST(measure_count, $2), last_seq = $3 WHERE id = $4', [
        model.lamport,
        needs,
        hub.lastSeq,
        scoreId,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();
    await hub.broadcast({
      type: 'ops',
      entries: newOps.map((o) => ({ seq: o.seq, op: o.op, author: { id: ctx.collaborator.id, name: ctx.collaborator.name, role: ctx.collaborator.role } })),
    });
    if (hub.lastSeq % SNAPSHOT_EVERY === 0) await maybeSnapshot(hub, scoreId);
  }

  sendJson(res, 200, { applied, duplicates, lamport: model.lamport, lastSeq: hub.lastSeq });
}

function simulateMeasures(model: ScoreModel, ops: Operation[]): number {
  const clone = model.fork();
  for (const op of ops) clone.applyRecorded(op);
  return clone.measureCountNeededByVoices();
}

async function findRecordedOp(scoreId: string, op: Operation): Promise<Operation | null> {
  const rows = await db.query('SELECT op FROM operations WHERE score_id = $1 AND lamport = $2 AND site = $3', [
    scoreId,
    op.id.lamport,
    op.id.site,
  ]);
  if (rows.rows.length === 0) return null;
  return rows.rows[0].op as Operation;
}

/** Key-order-independent JSON, so an identical resend is always a duplicate. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

async function maybeSnapshot(hub: Awaited<ReturnType<typeof hubFor>>, scoreId: string): Promise<void> {
  const stable = await stableLamport(scoreId, hub);
  hub.model!.dropTombstonesBelow({ lamport: stable, site: '' });
  await db.query('INSERT INTO snapshots (score_id, seq, lamport, state) VALUES ($1,$2,$3,$4)', [
    scoreId,
    hub.lastSeq,
    hub.model!.lamport,
    JSON.stringify({ stableLamport: stable, at: new Date().toISOString() }),
  ]);
}

async function stableLamport(scoreId: string, hub: Awaited<ReturnType<typeof hubFor>>): Promise<number> {
  const collaborators = await repo.collaborators(scoreId);
  const acks = await repo.acksFor(scoreId);
  let stable = hub.model!.lamport;
  for (const c of collaborators) {
    if (c.status !== 'active') continue;
    const ack = acks.find((a) => a.collaboratorId === c.id);
    const seen = ack?.seen ?? 0;
    if (seen < stable) stable = seen;
  }
  return stable;
}

async function getOps(res: http.ServerResponse, ctx: Awaited<ReturnType<typeof authenticate>>, scoreId: string, url: URL): Promise<void> {
  void ctx;
  const afterSeq = Number(url.searchParams.get('afterSeq') ?? 0);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 200 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw ApiError.validation({ limit: 'Ask for 1 to 500 operations.' });
  }
  const hub = await hubFor(scoreId);
  const ops = await repo.operationsAfter(scoreId, afterSeq, limit);
  const authors = await repo.collaborators(scoreId);
  sendJson(res, 200, {
    ops: ops.map((r) => {
      const author = authors.find((a) => a.id === r.authorId);
      return {
        seq: r.seq,
        op: r.op,
        author: { id: r.authorId, name: author?.name ?? r.site, role: author?.role ?? 'composer' },
      };
    }),
    lastSeq: hub.lastSeq,
    lamport: hub.model!.lamport,
  });
}

async function getSync(res: http.ServerResponse, scoreId: string): Promise<void> {
  const hub = await hubFor(scoreId);
  const stable = await stableLamport(scoreId, hub);
  sendJson(res, 200, {
    lamport: hub.model!.lamport,
    stableLamport: stable,
    tombstones: hub.model!.tombstoneCount(),
    lastSeq: hub.lastSeq,
    live: VALKEY.isConnected,
  });
}

// ---- history ----

async function getHistory(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  url: URL,
): Promise<void> {
  void ctx;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw ApiError.validation({ limit: 'Ask for 1 to 100 entries.' });
  }
  const staffId = url.searchParams.get('staffId');
  const type = url.searchParams.get('type');
  const field = url.searchParams.get('field');
  const beforeRaw = url.searchParams.get('before');
  const errors: Record<string, string> = {};
  if (type !== null && !['insert', 'delete', 'set'].includes(type)) errors['type'] = 'Unknown filter.';
  if (field !== null) {
    for (const f of field.split(',')) {
      if (!HISTORY_FIELDS.includes(f)) errors['field'] = 'Unknown filter.';
    }
  }
  const staves = await repo.staves(scoreId);
  if (staffId !== null && !staves.some((s) => s.id === staffId)) errors['staffId'] = 'Unknown staff.';
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  let beforeSeq: number | null = null;
  if (beforeRaw !== null) {
    beforeSeq = decodeCursor('h', beforeRaw);
    if (beforeSeq === null) throw ApiError.validation({ before: 'Unknown cursor.' });
  }

  const hub = await hubFor(scoreId);
  const model = hub.model!;
  const all = await repo.allOperations(scoreId);
  const authors = await repo.collaborators(scoreId);
  const fields = field ? field.split(',') : null;

  const entries: Record<string, unknown>[] = [];
  for (const rec of [...all].sort((a, b) => b.seq - a.seq)) {
    if (beforeSeq !== null && rec.seq >= beforeSeq) continue;
    const op = rec.op;
    if (type && op.type !== type) continue;
    if (staffId && op.staffId !== staffId) continue;
    let opField: string | null = null;
    if (op.type === 'set') {
      opField = op.field;
      if (fields && !fields.includes(op.field)) continue;
    } else if (fields) {
      continue;
    }
    const author = authors.find((a) => a.id === rec.authorId);
    const staff = staves.find((s) => s.id === op.staffId);
    const position = positionOf(model, op);
    entries.push({
      seq: rec.seq,
      opId: op.id,
      type: op.type,
      field: opField,
      staffId: op.staffId,
      staffName: staff?.name ?? op.staffId,
      voice: op.voice,
      measure: position.measure,
      beat: position.beat,
      author: { id: rec.authorId, name: author?.name ?? rec.site, role: author?.role ?? 'composer' },
      at: new Date(rec.recordedAt).toISOString(),
      summary: summarize(op, model),
    });
    if (entries.length >= limit) break;
  }
  const lastSeq = entries.length > 0 ? (entries[entries.length - 1].seq as number) : null;
  sendJson(res, 200, {
    entries,
    nextCursor: entries.length === limit && lastSeq !== null ? encodeCursor('h', lastSeq - 1) : null,
  });
}

function positionOf(model: ScoreModel, op: Operation): { measure: number; beat: number } {
  const staff = model.staff(op.staffId);
  if (!staff) return { measure: 1, beat: 1 };
  const targetId = op.type === 'insert' ? op.id : op.target;
  const events = model.voiceEvents(op.staffId, op.voice, false, staff.transpose);
  const found = events.find((e) => stampKey(e.id) === stampKey(targetId));
  return found ? { measure: found.measure, beat: found.beat } : { measure: 1, beat: 1 };
}

// ---- engraving ----

async function getEngraving(res: http.ServerResponse, ctx: Awaited<ReturnType<typeof authenticate>>, scoreId: string, url: URL): Promise<void> {
  void ctx;
  const view = url.searchParams.get('view') === 'part' ? 'part' : 'score';
  const partId = url.searchParams.get('partId');
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw === null ? 8 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < SYSTEMS_MIN || limit > SYSTEMS_MAX) {
    throw ApiError.validation({ limit: 'Ask for 1 to 16 systems.' });
  }
  const cursorRaw = url.searchParams.get('cursor');
  let cursor: { systemIndex: number } | null = null;
  if (cursorRaw !== null) {
    try {
      const decoded = decodeCursor('e', cursorRaw);
      if (decoded === null || decoded < 0) throw new Error();
      cursor = { systemIndex: decoded };
    } catch {
      throw ApiError.validation({ cursor: 'Unknown cursor.' });
    }
  }
  const errors: Record<string, string> = {};
  let partIdValid: string | null = null;
  if (view === 'part') {
    if (!partId) errors['partId'] = 'Choose a part.';
    else {
      const parts = await repo.parts(scoreId);
      if (!parts.some((p) => p.id === partId)) errors['partId'] = 'Unknown part.';
      else partIdValid = partId;
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const hub = await hubFor(scoreId);
  const model = hub.model!;
  const staves = await repo.staves(scoreId);
  const part = partIdValid ? (await repo.parts(scoreId)).find((p) => p.id === partIdValid) : undefined;
  const voices = new Map<string, ReturnType<ScoreModel['voiceEvents']>>();
  for (const staff of staves) {
    for (const voice of [1, 2]) {
      voices.set(`${staff.id}:${voice}`, model.voiceEvents(staff.id, voice, view === 'part', staff.transpose));
    }
  }
  const layout = part ? part.layout : { systemBreaks: [], pageBreaks: [] };
  const staffCount = partIdValid ? staves.filter((s) => s.partId === partIdValid).length : staves.length;
  const result = engraver.engrave(
    staves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
    voices,
    model.timeSignatures,
    model.measureCount,
    {
      view,
      partId: partIdValid,
      limit,
      cursor,
      systemBreaks: layout.systemBreaks,
      pageBreaks: layout.pageBreaks,
      maxSystemsPerPage: staffCount >= 2 ? 5 : 10,
    },
  );
  sendJson(res, 200, {
    view,
    partId: partIdValid,
    lamport: model.lamport,
    systems: result.systems,
    nextCursor: result.nextCursor ? encodeCursor('e', result.nextCursor.systemIndex) : null,
  });
}

// ---- holds ----

async function getHolds(res: http.ServerResponse, scoreId: string): Promise<void> {
  const hub = await hubFor(scoreId);
  sendJson(res, 200, { holds: await holdsJson(scoreId, hub) });
}

async function holdsJson(scoreId: string, hub: Awaited<ReturnType<typeof hubFor>>): Promise<unknown[]> {
  const collaborators = await repo.collaborators(scoreId);
  return [...hub.holds.values()].map((h) => {
    const holder = collaborators.find((c) => c.id === h.holderId);
    return {
      staffId: h.staffId,
      holder: { id: h.holderId, name: holder?.name ?? '', role: holder?.role ?? 'composer' },
      since: new Date(h.since).toISOString(),
    };
  });
}

async function broadcastHolds(scoreId: string, hub: Awaited<ReturnType<typeof hubFor>>): Promise<void> {
  await hub.broadcast({ type: 'holds', holds: await holdsJson(scoreId, hub) });
}

async function postHolds(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
): Promise<void> {
  const hub = await hubFor(scoreId);
  const body = (await readJsonBody(req)) as { staffIds?: unknown; connectionId?: unknown };
  const staves = await repo.staves(scoreId);
  const errors: Record<string, string> = {};
  const ids: string[] = [];
  if (!Array.isArray(body.staffIds) || body.staffIds.length < 1 || body.staffIds.length > 64) {
    errors['staffIds'] = 'Choose 1 to 64 staves.';
  } else {
    for (const id of body.staffIds) {
      if (typeof id !== 'string' || !staves.some((s) => s.id === id)) {
        errors['staffIds'] = 'Unknown staff.';
        break;
      }
      ids.push(id);
    }
    if (ctx.collaborator.role === 'player') {
      for (const id of ids) {
        if (!ctx.collaborator.staffIds.includes(id)) throw ApiError.forbidden(true);
      }
    }
  }
  const connectionId = body.connectionId;
  if (typeof connectionId !== 'string' || !hub.connectionById(connectionId) || hub.connectionById(connectionId)!.collaboratorId !== ctx.collaborator.id) {
    if (Object.keys(errors).length === 0) {
      if (hub.callersOpenConnections(ctx.collaborator.id).length === 0) throw ApiError.notConnected();
      errors['connectionId'] = 'Unknown connection.';
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const conflicting = ids.map((id) => ({ id, hold: hub.holds.get(id) })).filter((c) => c.hold && c.hold.holderId !== ctx.collaborator.id);
  if (conflicting.length > 0) {
    const collaborators = await repo.collaborators(scoreId);
    const first = conflicting[0].hold!;
    const holder = collaborators.find((c) => c.id === first.holderId)!;
    const names = conflicting.map((c) => staves.find((s) => s.id === c.id)?.name ?? c.id);
    throw ApiError.staffHeld({ id: holder.id, name: holder.name, role: holder.role }, conflicting.map((c) => c.id), names);
  }
  const now = Date.now();
  for (const id of ids) {
    hub.holds.set(id, { staffId: id, holderId: ctx.collaborator.id, connectionId: connectionId as string, since: now });
  }
  await broadcastHolds(scoreId, hub);
  sendJson(res, 201, { holds: await holdsJson(scoreId, hub) });
}

async function deleteHolds(res: http.ServerResponse, ctx: Awaited<ReturnType<typeof authenticate>>, scoreId: string, url: URL): Promise<void> {
  const hub = await hubFor(scoreId);
  const ids = (url.searchParams.get('staffIds') ?? '').split(',').filter(Boolean);
  const staves = await repo.staves(scoreId);
  const errors: Record<string, string> = {};
  for (const id of ids) {
    if (!staves.some((s) => s.id === id)) {
      errors['staffIds'] = 'Unknown staff.';
      break;
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
  for (const id of ids) {
    const hold = hub.holds.get(id);
    if (hold && hold.holderId === ctx.collaborator.id) hub.holds.delete(id);
  }
  await broadcastHolds(scoreId, hub);
  res.writeHead(204);
  res.end();
}

// ---- presence ----

async function getPresence(res: http.ServerResponse, scoreId: string): Promise<void> {
  const hub = await hubFor(scoreId);
  sendJson(res, 200, { entries: hub.presenceSnapshot(), ttlSeconds: AWARENESS_TTL_SECONDS });
}

// ---- collaborators and invites ----

async function getCollaborators(res: http.ServerResponse, ctx: Awaited<ReturnType<typeof authenticate>>, scoreId: string): Promise<void> {
  const collaborators = await repo.collaborators(scoreId);
  const visible = ctx.collaborator.role === 'player' ? collaborators.filter((c) => c.status === 'active') : collaborators;
  sendJson(res, 200, {
    collaborators: visible.map((c) => ({ id: c.id, name: c.name, role: c.role, status: c.status, staffIds: c.staffIds })),
  });
}

async function postInvite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const staves = await repo.staves(scoreId);
  const errors: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || perceivedLength(name) > NAME_INVITE_MAX) errors['name'] = 'Use a name of 1 to 60 characters.';
  if (body.role !== 'copyist' && body.role !== 'player') errors['role'] = 'Invite a copyist or a section player.';
  if (!Array.isArray(body.staffIds) || body.staffIds.length < 1 || body.staffIds.length > 64) {
    errors['staffIds'] = 'Choose at least one staff.';
  } else {
    for (const id of body.staffIds) {
      if (typeof id !== 'string' || !staves.some((s) => s.id === id)) {
        errors['staffIds'] = 'Unknown staff.';
        break;
      }
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const id = `c-${crypto.randomBytes(4).toString('hex')}`;
  const token = `inv-${crypto.randomBytes(6).toString('hex')}`;
  await db.query(
    'INSERT INTO collaborators (id, score_id, name, role, status, staff_ids, seat_token) VALUES ($1,$2,$3,$4,$5,$6,null)',
    [id, scoreId, name, body.role, 'invited', JSON.stringify(body.staffIds)],
  );
  await db.query('INSERT INTO invites (token, score_id, collaborator_id) VALUES ($1,$2,$3)', [token, scoreId, id]);
  const collab = await repo.collaboratorById(scoreId, id);
  sendJson(res, 201, {
    collaborator: collaboratorJson(collab!),
    inviteToken: token,
    inviteUrl: `/i/${token}`,
  });
}

async function getInvite(res: http.ServerResponse, token: string): Promise<void> {
  const invite = await repo.inviteRow(token);
  if (!invite) throw ApiError.notFound();
  const collab = await repo.collaboratorById(invite.scoreId, invite.collaboratorId);
  if (!collab) throw ApiError.notFound();
  const score = await repo.scoreRow(invite.scoreId);
  sendJson(res, 200, {
    invite: { name: collab.name, role: collab.role, status: collab.status, scoreTitle: score?.title ?? '' },
  });
}

async function acceptInvite(res: http.ServerResponse, token: string): Promise<void> {
  const invite = await repo.inviteRow(token);
  if (!invite) throw ApiError.notFound();
  const collab = await repo.collaboratorById(invite.scoreId, invite.collaboratorId);
  if (!collab) throw ApiError.notFound();
  if (collab.status === 'removed') throw ApiError.inviteRevoked();
  if (collab.status === 'active') throw ApiError.inviteUsed();
  const seatToken = `seat-${crypto.randomBytes(9).toString('hex')}`;
  const result = await db.query(
    `UPDATE collaborators SET status = 'active', seat_token = $1 WHERE score_id = $2 AND id = $3 AND status = 'invited' RETURNING id`,
    [seatToken, invite.scoreId, invite.collaboratorId],
  );
  if (result.rows.length === 0) throw ApiError.inviteUsed();
  const score = await repo.scoreRow(invite.scoreId);
  await db.query(
    `INSERT INTO acks (score_id, collaborator_id, seen) VALUES ($1,$2,$3)
     ON CONFLICT (score_id, collaborator_id) DO UPDATE SET seen = EXCLUDED.seen`,
    [invite.scoreId, invite.collaboratorId, score?.lamport ?? 0],
  );
  const updated = await repo.collaboratorById(invite.scoreId, invite.collaboratorId);
  sendJson(res, 200, { seatToken, collaborator: collaboratorJson(updated!) });
}

async function patchCollaborator(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  collaboratorId: string,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const collab = await repo.collaboratorById(scoreId, collaboratorId);
  if (!collab) throw ApiError.notFound();
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const staves = await repo.staves(scoreId);
  const errors: Record<string, string> = {};
  if (collab.role !== 'player') errors['staffIds'] = 'Only section players have assigned staves.';
  if (!Array.isArray(body.staffIds) || body.staffIds.length < 1 || body.staffIds.length > 64) {
    errors['staffIds'] = 'Choose at least one staff.';
  } else {
    for (const id of body.staffIds) {
      if (typeof id !== 'string' || !staves.some((s) => s.id === id)) {
        errors['staffIds'] = 'Unknown staff.';
        break;
      }
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
  await db.query('UPDATE collaborators SET staff_ids = $1 WHERE score_id = $2 AND id = $3', [
    JSON.stringify(body.staffIds),
    scoreId,
    collaboratorId,
  ]);
  const updated = await repo.collaboratorById(scoreId, collaboratorId);
  sendJson(res, 200, { collaborator: collaboratorJson(updated!) });
}

async function deleteCollaborator(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  collaboratorId: string,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const collab = await repo.collaboratorById(scoreId, collaboratorId);
  if (!collab) throw ApiError.notFound();
  if (collab.role === 'composer') throw ApiError.cannotRemoveComposer();
  if (collab.status === 'removed') throw ApiError.alreadyRemoved(collab.name);
  await db.query('UPDATE collaborators SET status = $1, seat_token = null WHERE score_id = $2 AND id = $3', [
    'removed',
    scoreId,
    collaboratorId,
  ]);
  const hub = await hubFor(scoreId);
  for (const [staffId, hold] of hub.holds) {
    if (hold.holderId === collaboratorId) hub.holds.delete(staffId);
  }
  hub.presence.delete(collaboratorId);
  const open = hub.callersOpenConnections(collaboratorId);
  for (const conn of open) {
    conn.send({ type: 'removed' });
    setTimeout(() => conn.close(), 50);
  }
  await broadcastHolds(scoreId, hub);
  await hub.broadcast({ type: 'presence', entries: hub.presenceSnapshot() });
  const updated = await repo.collaboratorById(scoreId, collaboratorId);
  sendJson(res, 200, { collaborator: collaboratorJson(updated!) });
}

// ---- parts ----

async function getParts(res: http.ServerResponse, scoreId: string): Promise<void> {
  const parts = await repo.parts(scoreId);
  const staves = await repo.staves(scoreId);
  const hub = await hubFor(scoreId);
  sendJson(res, 200, {
    parts: parts.map((p) => ({
      ...partJson(p),
      staffIds: staves.filter((s) => s.partId === p.id).map((s) => s.id),
      stale: p.status === 'ready' && (p.extractedAtLamport ?? 0) < hub.model!.lamport,
    })),
  });
}

async function putPartLayout(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  partId: string,
): Promise<void> {
  requireRole(ctx, ['composer', 'copyist']);
  const parts = await repo.parts(scoreId);
  const part = parts.find((p) => p.id === partId);
  if (!part) throw ApiError.notFound();
  const staves = await repo.staves(scoreId);
  const partStaves = staves.filter((s) => s.partId === partId);
  const hub = await hubFor(scoreId);
  const notHeld = partStaves.filter((s) => hub.holds.get(s.id)?.holderId !== ctx.collaborator.id);
  if (notHeld.length > 0) {
    const held = partStaves.find((s) => hub.holds.get(s.id));
    if (held) {
      const hold = hub.holds.get(held.id)!;
      const collaborators = await repo.collaborators(scoreId);
      const holder = collaborators.find((c) => c.id === hold.holderId)!;
      throw ApiError.staffHeld(
        { id: holder.id, name: holder.name, role: holder.role },
        partStaves.map((s) => s.id),
        partStaves.map((s) => s.name),
      );
    }
    throw ApiError.holdRequired();
  }
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const score = await repo.scoreRow(scoreId);
  const maxMeasure = Math.max(0, (score?.measureCount ?? 1) - 1);
  const errors: Record<string, string> = {};
  for (const [key, value] of [['systemBreaks', body.systemBreaks], ['pageBreaks', body.pageBreaks]] as const) {
    if (!Array.isArray(value)) {
      errors[key] = `Use measures from 1 to ${maxMeasure}, each once.`;
      continue;
    }
    const seen = new Set<number>();
    for (const m of value) {
      if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > maxMeasure || seen.has(m)) {
        errors[key] = `Use measures from 1 to ${maxMeasure}, each once.`;
        break;
      }
      seen.add(m);
    }
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);
  await db.query('UPDATE parts SET layout = $1, stale = true WHERE score_id = $2 AND id = $3', [
    JSON.stringify({ systemBreaks: body.systemBreaks, pageBreaks: body.pageBreaks }),
    scoreId,
    partId,
  ]);
  const updated = await partWithStaves(scoreId, partId);
  await hub.broadcast({ type: 'part', part: updated });
  sendJson(res, 200, { part: updated });
}

async function postExtract(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  partId: string,
): Promise<void> {
  const parts = await repo.parts(scoreId);
  const part = parts.find((p) => p.id === partId);
  if (!part) throw ApiError.notFound();
  const staves = await repo.staves(scoreId);
  const partStaves = staves.filter((s) => s.partId === partId);
  if (ctx.collaborator.role === 'player') {
    if (!partStaves.every((s) => ctx.collaborator.staffIds.includes(s.id))) throw ApiError.forbidden(true);
  }
  if (!isExtractable(part.status)) throw ApiError.partBusy(part.name, part.status);
  const hub = await hubFor(scoreId);
  const to = nextPartStatus(part.status, 'extract')!;
  const revision = part.revision + 1;
  await db.query(
    'UPDATE parts SET status = $1, revision = $2, extracted_at_lamport = $3, stale = false, last_error = null, page_count = null WHERE score_id = $4 AND id = $5',
    [to, revision, hub.model!.lamport, scoreId, partId],
  );
  await broadcastPart(hub, scoreId, partId);
  const updated = await partWithStaves(scoreId, partId);
  sendJson(res, 202, { part: updated });
  void partPipeline(scoreId, partId);
}

async function getPartPage(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  partId: string,
  page: number,
): Promise<void> {
  void ctx;
  const parts = await repo.parts(scoreId);
  const part = parts.find((p) => p.id === partId);
  if (!part) throw ApiError.notFound();
  const svg = await MINIO.getObject(partPageKey(scoreId, partId, part.revision, page));
  if (svg === null) throw ApiError.storageUnavailable();
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': svg.length });
  res.end(svg);
}

async function getPartPdf(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  partId: string,
): Promise<void> {
  const parts = await repo.parts(scoreId);
  const part = parts.find((p) => p.id === partId);
  if (!part) throw ApiError.notFound();
  if (ctx.collaborator.role === 'player') {
    const staves = await repo.staves(scoreId);
    const partStaves = staves.filter((s) => s.partId === partId);
    if (!partStaves.every((s) => ctx.collaborator.staffIds.includes(s.id))) throw ApiError.forbidden(true);
  }
  if (part.status !== 'ready') throw ApiError.pdfNotReady(part.name, part.status);
  const pdf = await MINIO.getObject(partPdfKey(scoreId, partId, part.revision));
  if (pdf === null) throw ApiError.storageUnavailable();
  const score = await repo.scoreRow(scoreId);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${score?.title ?? 'Score'} - ${part.name}.pdf"`,
    'Content-Length': pdf.length,
  });
  res.end(pdf);
}

// ---- sample banks ----

async function getBanks(res: http.ServerResponse, scoreId: string): Promise<void> {
  const banks = await repo.banks(scoreId);
  sendJson(res, 200, {
    banks: banks.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      kind: b.kind,
      bytes: b.bytes,
      staffId: b.staffId,
      rootPitch: b.rootPitch,
      status: b.status,
      createdAt: b.createdAt,
    })),
  });
}

async function postBank(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  url: URL,
): Promise<void> {
  requireRole(ctx, ['composer']);
  const fileName = url.searchParams.get('fileName') ?? '';
  const staffId = url.searchParams.get('staffId') ?? '';
  const root = url.searchParams.get('root');
  const { buffer, tooLarge } = await readRawBody(req, 8000000);
  if (tooLarge) throw ApiError.bankTooLarge();
  const staves = await repo.staves(scoreId);
  const errors: Record<string, string> = {};
  if (fileName.length < 1 || fileName.length > 120 || !/^[A-Za-z0-9 .\-_()]+$/.test(fileName) || fileName.includes('..') || !(fileName.toLowerCase().endsWith('.wav') || fileName.toLowerCase().endsWith('.sfz'))) {
    errors['fileName'] = 'Use a plain file name ending in .wav or .sfz.';
  }
  if (!staves.some((s) => s.id === staffId)) errors['staffId'] = 'Choose a staff.';
  let rootPitch: string | null = null;
  if (root !== null) {
    const parsed = parseRootPitch(root);
    if (fileName.toLowerCase().endsWith('.sfz')) {
      rootPitch = null;
    } else if (parsed === null) {
      errors['root'] = 'Use a pitch like A4, C#5 or Bb3.';
    } else {
      rootPitch = parsed;
    }
  } else if (fileName.toLowerCase().endsWith('.wav')) {
    rootPitch = 'A4';
  }
  if (Object.keys(errors).length > 0) throw ApiError.validation(errors);

  const check = checkBankUpload({ fileName, bytes: buffer });
  if ('error' in check) {
    if (check.error === 'too_large') throw ApiError.bankTooLarge();
    if (check.error === 'bad_name') throw ApiError.validation({ fileName: 'Use a plain file name ending in .wav or .sfz.' });
    throw ApiError.unsupportedType();
  }
  const kind = check.kind;
  const id = `bank-${crypto.randomBytes(4).toString('hex')}`;
  const key = bankKey(scoreId, id, fileName);
  const stored = await MINIO.putObject(key, buffer, kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8');
  if (!stored) throw ApiError.storageUnavailable();
  await db.query(
    'INSERT INTO banks (id, score_id, file_name, kind, bytes, staff_id, root_pitch, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, scoreId, fileName, kind, buffer.length, staffId, rootPitch, 'loaded'],
  );
  const hub = await hubFor(scoreId);
  const bank = (await repo.banks(scoreId)).find((b) => b.id === id)!;
  await hub.broadcast({
    type: 'bank',
    bank: {
      id: bank.id,
      fileName: bank.fileName,
      kind: bank.kind,
      bytes: bank.bytes,
      staffId: bank.staffId,
      rootPitch: bank.rootPitch,
      status: bank.status,
      createdAt: bank.createdAt,
    },
  });
  sendJson(res, 201, {
    bank: {
      id: bank.id,
      fileName: bank.fileName,
      kind: bank.kind,
      bytes: bank.bytes,
      staffId: bank.staffId,
      rootPitch: bank.rootPitch,
      status: bank.status,
      createdAt: bank.createdAt,
    },
  });
}

function parseRootPitch(root: string): string | null {
  const m = /^([A-G])(#|b)?([0-9])$/.exec(root);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ''}${m[3]}`;
}

async function getBankContent(
  res: http.ServerResponse,
  ctx: Awaited<ReturnType<typeof authenticate>>,
  scoreId: string,
  bankId: string,
): Promise<void> {
  void ctx;
  const banks = await repo.banks(scoreId);
  const bank = banks.find((b) => b.id === bankId);
  if (!bank) throw ApiError.notFound();
  const content = await MINIO.getObject(bankKey(scoreId, bankId, bank.fileName));
  if (content === null) throw ApiError.storageUnavailable();
  res.writeHead(200, {
    'Content-Type': bank.kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8',
    'Content-Length': content.length,
  });
  res.end(content);
}
