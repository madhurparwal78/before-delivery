import http from 'node:http';
import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { Postgres } from './services/postgres.js';
import { ScoreRepository, CollaboratorRow, PartRow } from './repo.js';
import { ScoreHub } from './hub.js';
import { Engraver } from './engraver.js';
import { seedIfMissing } from './seed.js';
import { partPipeline } from './parts.js';
import {
  Clef,
  MEASURE_CAP,
  Pitch,
  OPS_MAX,
  Role,
  STAFF_CAP,
  SYSTEMS_MAX,
  SYSTEMS_MIN,
  TimeSignature,
  Transpose,
  isDuration,
  Clef as ClefT,
  DurationName,
  JSON_BODY_MAX,
} from '../domain/values.js';
import { formatPitch, formatDuration } from '../domain/pitch.js';
import { Operation, ScoreModel, StoredEvent, ElementId } from '../domain/scoremodel.js';
import { filterExpressionText, textWithinLimit } from '../domain/textfilter.js';
import { checkBankUpload } from '../domain/bankchecks.js';
import { nextPartStatus, isPartBusy, isExtractable } from '../domain/partlifecycle.js';

export const db = new Postgres();
export const repo = new ScoreRepository(db);
export const engraver = new Engraver();
export const hubs = new Map<string, ScoreHub>();

export const AWARENESS_TTL_SECONDS = Number(process.env.AWARENESS_TTL_SECONDS ?? 15);
export const PDF_RETRY_SECONDS = Number(process.env.PDF_RETRY_SECONDS ?? 30);

const DYNAMIC_ALL = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp'];
const HISTORY_FIELDS = ['pitch', 'duration', 'dots', 'tie', 'dynamic', 'dynamicPlacement', 'text'];

export async function hubFor(scoreId: string): Promise<ScoreHub> {
  const existing = hubs.get(scoreId);
  if (existing && existing.model) return existing;
  const hub = existing ?? new ScoreHub(scoreId, repo);
  hubs.set(scoreId, hub);
  if (!hub.model) await hub.load();
  return hub;
}

export interface AuthContext {
  collaborator: CollaboratorRow;
  scoreId: string;
}

export async function authenticate(req: http.IncomingMessage, scoreId: string | null, url?: URL): Promise<AuthContext> {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : url?.searchParams.get('token') ?? null;
  if (!token) throw ApiError.unauthorized();
  const collab = await repo.collaboratorBySeat(token);
  if (!collab || collab.status !== 'active') throw ApiError.unauthorized();
  if (scoreId && collab.scoreId !== scoreId) throw ApiError.notFound();
  return { collaborator: collab, scoreId: collab.scoreId };
}

export function requireRole(ctx: AuthContext, roles: Role[]): void {
  if (!roles.includes(ctx.collaborator.role)) throw ApiError.forbidden();
}

export function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (over) {
        reject(ApiError.payloadTooLarge());
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(ApiError.validation({ body: 'Send JSON.' }));
      }
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > JSON_BODY_MAX) {
        over = true;
        finish();
        // let the response go out, then stop reading
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', finish);
    req.on('error', finish);
  });
}

export function readRawBody(req: http.IncomingMessage, limit: number): Promise<{ buffer: Buffer; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ buffer: Buffer.concat(chunks), tooLarge });
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        req.destroy();
        finish();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', finish);
    req.on('error', finish);
  });
}

export function sameOriginCheck(req: http.IncomingMessage): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  if (!host) throw ApiError.crossOrigin();
  try {
    if (new URL(origin).host !== host) throw ApiError.crossOrigin();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.crossOrigin();
  }
}

export function collaboratorJson(c: CollaboratorRow): Record<string, unknown> {
  return { id: c.id, name: c.name, role: c.role, status: c.status, staffIds: c.staffIds };
}

export function authorJson(c: { id: string; name: string; role: string }): Record<string, unknown> {
  return { id: c.id, name: c.name, role: c.role };
}

export function partJson(p: PartRow): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    staffIds: [],
    status: p.status,
    revision: p.revision,
    extractedAtLamport: p.extractedAtLamport,
    stale: p.stale,
    pageCount: p.pageCount,
    layout: p.layout,
    lastError: p.lastError,
  };
}

export async function scoreJsonFor(hub: ScoreHub): Promise<Record<string, unknown>> {
  const score = await repo.scoreRow(hub.scoreId);
  const staves = await repo.staves(hub.scoreId);
  const parts = await repo.parts(hub.scoreId);
  const model = hub.model!;
  return {
    score: {
      id: hub.scoreId,
      title: score?.title ?? '',
      measureCount: model.measureCount,
      timeSignatures: model.timeSignatures,
      tempos: model.tempos,
      staves: staves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
      parts: parts.map((p) => ({
        ...partJson(p),
        staffIds: staves.filter((s) => s.partId === p.id).map((s) => s.id),
      })),
      lamport: model.lamport,
      lastSeq: hub.lastSeq,
    },
  };
}

export async function broadcastScore(hub: ScoreHub): Promise<void> {
  const payload = (await scoreJsonFor(hub)) as { score: unknown };
  await hub.broadcast({ type: 'score', score: payload.score });
}

export async function partWithStaves(scoreId: string, partId: string): Promise<Record<string, unknown> | null> {
  const parts = await repo.parts(scoreId);
  const part = parts.find((p) => p.id === partId);
  if (!part) return null;
  const staves = await repo.staves(scoreId);
  return { ...partJson(part), staffIds: staves.filter((s) => s.partId === partId).map((s) => s.id) };
}

export async function broadcastPart(hub: ScoreHub, scoreId: string, partId: string): Promise<void> {
  const part = await partWithStaves(scoreId, partId);
  if (part) await hub.broadcast({ type: 'part', part });
}

export function isPitch(value: unknown): value is Pitch {
  if (!value || typeof value !== 'object') return false;
  const p = value as Pitch;
  return (
    typeof p.step === 'string' &&
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(p.step) &&
    typeof p.alter === 'number' &&
    Number.isInteger(p.alter) &&
    p.alter >= -2 &&
    p.alter <= 2 &&
    typeof p.octave === 'number' &&
    Number.isInteger(p.octave) &&
    p.octave >= 0 &&
    p.octave <= 9
  );
}

export function encodeCursor(prefix: string, value: number | string): string {
  return Buffer.from(`${prefix}-${value}`).toString('base64url');
}

export function decodeCursor(prefix: string, cursor: string): number | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(raw);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function parseOp(
  raw: Record<string, unknown>,
  ctx: AuthContext,
  staves: { id: string }[],
  model: ScoreModel,
): { op?: Operation; error?: { key?: string; message: string } } {
  const id = raw.id as ElementId | undefined;
  if (!id || typeof id.lamport !== 'number' || !Number.isInteger(id.lamport) || id.lamport < 1 || typeof id.site !== 'string') {
    return { error: { key: 'id', message: 'Operation stamps need a Lamport number of 1 or more and a site.' } };
  }
  if (id.site !== ctx.collaborator.id) {
    return { error: { key: 'id', message: 'Site must be your collaborator id.' } };
  }
  const staffId = raw.staffId as string | undefined;
  if (typeof staffId !== 'string' || !staves.some((s) => s.id === staffId)) {
    return { error: { key: 'staffId', message: 'Unknown staff.' } };
  }
  if (ctx.collaborator.role === 'player' && !ctx.collaborator.staffIds.includes(staffId)) {
    return { error: { message: 'You can edit only your own staves.' } };
  }
  const voice = raw.voice;
  if (voice !== 1 && voice !== 2) {
    return { error: { message: 'Each staff has two voices.' } };
  }
  const type = raw.type;
  if (type === 'insert') {
    const after = raw.after === null || raw.after === undefined ? null : (raw.after as ElementId);
    if (after) {
      if (typeof after.lamport !== 'number' || typeof after.site !== 'string' || !model.storedEvent(after)) {
        return { error: { key: 'after', message: 'Unknown element.' } };
      }
      if (after.lamport >= id.lamport) {
        return { error: { key: 'id', message: 'Stamp must be later than the element it refers to.' } };
      }
    }
    const ev = raw.event as { kind?: unknown; pitch?: unknown; duration?: unknown; dots?: unknown } | undefined;
    if (!ev || (ev.kind !== 'note' && ev.kind !== 'rest')) {
      return { error: { key: 'event.kind', message: 'Events are notes or rests.' } };
    }
    if (ev.kind === 'note' && !isPitch(ev.pitch)) {
      return { error: { key: 'event.pitch', message: 'Notes need a pitch.' } };
    }
    if (ev.kind === 'rest' && ev.pitch !== undefined && ev.pitch !== null) {
      return { error: { key: 'event.pitch', message: 'Rests have no pitch.' } };
    }
    if (!isDuration(ev.duration)) {
      return { error: { key: 'event.duration', message: 'Choose a duration.' } };
    }
    const dots = ev.dots ?? 0;
    if (dots !== 0 && dots !== 1 && dots !== 2) {
      return { error: { key: 'event.dots', message: 'Use 0, 1 or 2 dots.' } };
    }
    return {
      op: {
        id,
        type: 'insert',
        staffId,
        voice: voice as 1 | 2,
        after,
        event: {
          kind: ev.kind,
          ...(ev.kind === 'note' ? { pitch: ev.pitch as Pitch } : {}),
          duration: ev.duration as DurationName,
          dots: dots as 0 | 1 | 2,
        },
      },
    };
  }
  if (type === 'delete' || type === 'set') {
    const target = raw.target as ElementId | undefined;
    if (!target || typeof target.lamport !== 'number' || typeof target.site !== 'string' || !model.storedEvent(target)) {
      return { error: { key: 'target', message: 'Unknown element.' } };
    }
    if (target.lamport >= id.lamport) {
      return { error: { key: 'id', message: 'Stamp must be later than the element it refers to.' } };
    }
    if (type === 'delete') {
      return { op: { id, type: 'delete', staffId, voice: voice as 1 | 2, target } };
    }
    const field = raw.field;
    const value = raw.value;
    const targetEvent = model.storedEvent(target)!;
    if (field === 'pitch') {
      if (!isPitch(value)) return { error: { key: 'value', message: 'Notes need a pitch.' } };
      if (targetEvent.kind === 'rest') return { error: { key: 'value', message: 'Rests have no pitch.' } };
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'duration') {
      if (!isDuration(value)) return { error: { key: 'value', message: 'Choose a duration.' } };
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'dots') {
      if (value !== 0 && value !== 1 && value !== 2) return { error: { key: 'value', message: 'Use 0, 1 or 2 dots.' } };
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'tie') {
      if (value !== true && value !== false) return { error: { key: 'value', message: 'Ties are on or off.' } };
      if (targetEvent.kind === 'rest') return { error: { key: 'value', message: 'Rests have no ties.' } };
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'dynamic') {
      if (value !== null && (typeof value !== 'string' || !DYNAMIC_ALL.includes(value))) {
        return { error: { key: 'value', message: 'Use a standard dynamic mark.' } };
      }
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'dynamicPlacement') {
      if (value !== 'above' && value !== 'below') return { error: { key: 'value', message: 'Place dynamics above or below.' } };
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value } };
    }
    if (field === 'text') {
      if (typeof value !== 'string' && value !== null) return { error: { key: 'value', message: 'Expression text is a string.' } };
      if (value === null) return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value: null } };
      const filtered = filterExpressionText(value);
      if (!textWithinLimit(filtered)) {
        return { error: { key: 'value', message: 'Expression text is limited to 200 characters.' } };
      }
      return { op: { id, type: 'set', staffId, voice: voice as 1 | 2, target, field, value: filtered } };
    }
    return { error: { key: 'field', message: 'Choose a field to set.' } };
  }
  return { error: { message: 'Operations insert, delete or set.' } };
}

export function summarize(op: Operation, model: ScoreModel): string {
  if (op.type === 'insert') {
    if (op.event.kind === 'note') {
      return `Added ${formatPitch(op.event.pitch!)} ${formatDuration(op.event.duration, op.event.dots)}`;
    }
    return `Added ${formatDuration(op.event.duration, op.event.dots)} rest`;
  }
  if (op.type === 'delete') {
    const ev = model.storedEvent(op.target);
    if (ev) {
      const pitch = effectivePitch(ev);
      return ev.kind === 'note' && pitch
        ? `Deleted ${formatPitch(pitch)} ${formatDuration(ev.duration, ev.dots)}`
        : `Deleted ${formatDuration(ev.duration, ev.dots)} rest`;
    }
    return 'Deleted';
  }
  switch (op.field) {
    case 'pitch':
      return `Pitch set to ${formatPitch(op.value as Pitch)}`;
    case 'duration':
      return `Duration set to ${formatDuration(op.value as string, 0)}`;
    case 'dots':
      return `Dots set to ${op.value}`;
    case 'tie':
      return op.value === true ? 'Tie added' : 'Tie removed';
    case 'dynamic':
      return op.value === null ? 'Dynamic removed' : `Dynamic set to ${op.value}`;
    case 'dynamicPlacement':
      return op.value === 'above' ? 'Dynamic moved above the staff' : 'Dynamic moved below the staff';
    case 'text':
      return 'Text changed';
  }
  return 'Changed';
}

export function effectivePitch(ev: StoredEvent): Pitch | null {
  const set = ev.sets['pitch'];
  return (set ? (set.value as Pitch) : ev.pitch) ?? ev.pitch;
}

export { MEASURE_CAP, STAFF_CAP, OPS_MAX, SYSTEMS_MIN, SYSTEMS_MAX, DYNAMIC_ALL, HISTORY_FIELDS, nextPartStatus, isPartBusy, isExtractable, filterExpressionText, textWithinLimit, checkBankUpload, seedIfMissing, partPipeline, ScoreHub, crypto };
export type { TimeSignature, Transpose, Clef, ClefT };

