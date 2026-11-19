import { createHash, randomUUID } from 'node:crypto';
import { db } from './db.js';
import { corridorModel, deriveFinding, projectFinding, spanForChainage, fixtureGroundHeight } from '../domain/corridors.js';
import { coverageRanges, flightByChainage, flightByTime, isInvalid, parseCzml as parseTrack, type FlightTrack } from '../domain/flight.js';
import {
  ApiError, assetRejected, checksumMismatch, coarserTerrain, crossOrigin, fileAlreadyStored,
  forbidden, idempotencyConflict, illegalTransition, invalidAccessCode, invalidCzml, linkExpired,
  linkNotFound, linkNotLive, linkRevoked, notFound, openSetExists, payloadTooLarge, rangeNotSatisfiable,
  reviewClosed, setNotDraft, storageUnavailable, unsupportedMediaType, unauthenticated, validationFailed,
} from './errors.js';
import { fixtureFileBytes, fixtureManifest } from '../domain/fixtures.js';
import { assetKey, deleteObject, evidenceKey, listPrefix, probeStorage, readObject, storageClient, tenantOf, writeVerified, writeFixtureFile } from './storage.js';
import { probeMail, trySendWithinLimit } from './mail.js';
import { newId, newToken, sha256Hex } from './seed.js';
import {
  beginIdempotent, commitResponse, parseJsonBody, replayStored, routeScope, stableBody, validIdempotencyKey, type JsonValue,
} from './idempotency.js';

/**
 * The one precedence order, in one place. Route handlers throw ApiError;
 * errors earlier in this list win.
 */

const JSON_LIMIT = 65_536;
const ASSET_JSON_LIMIT = 2_000_000;
const FILE_LIMIT = 50_000_000;

export type StaffCtx = { id: string; tenantId: string; role: string; name: string; email: string } | null;
export type ReviewCtx = { token: string; setId: string; corridorId: string; tenantId: string } | null;

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: Buffer | null;
  params: Record<string, string>;
  pattern: string;
  staff: StaffCtx;
  reviewCtx: ReviewCtx;
};

export type RouteSpec = {
  method: string;
  pattern: string;
  auth: 'none' | 'staff' | 'review' | 'staff-optional';
  handler: (req: Req) => Promise<Response>;
};

function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(headers ?? {}) },
  });
}

function iso(ms: number | Date | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoMillis(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 19)}.${String(d.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

// ---------------------------------------------------------------------------
// Serialisers

type CorridorRow = Record<string, unknown>;

async function corridorJson(pool: ReturnType<typeof db>, row: CorridorRow, withSet = true): Promise<Record<string, unknown>> {
  const overdueRes = await pool.query(
    `SELECT ($1::date < (now() AT TIME ZONE tz.time_zone)::date) AS overdue, tz.time_zone
     FROM corridors c JOIN utilities tz ON tz.id = c.utility_id WHERE c.id = $2`,
    [row.inspection_due, row.id]
  );
  const overdue = overdueRes.rows.length > 0 && overdueRes.rows[0].overdue === true;
  const tz = overdueRes.rows.length > 0 ? (overdueRes.rows[0].time_zone as string) : 'UTC';
  let currentSet: Record<string, unknown> | null = null;
  if (withSet) {
    const sets = await pool.query(
      `SELECT id, revision, state FROM findings_sets
       WHERE corridor_id=$1 ORDER BY (state <> 'closed') DESC, revision DESC LIMIT 1`,
      [row.id]
    );
    if (sets.rows.length > 0) {
      currentSet = { id: sets.rows[0].id, revision: sets.rows[0].revision, state: sets.rows[0].state };
    }
  }
  const utilRes = await pool.query('SELECT * FROM utilities WHERE id=$1', [row.utility_id]);
  const u = utilRes.rows[0];
  const due = row.inspection_due instanceof Date ? row.inspection_due.toISOString().slice(0, 10) : String(row.inspection_due).slice(0, 10);
  return {
    id: row.id,
    name: row.name,
    voltage_kv: row.voltage_kv,
    clearance_threshold_m: row.clearance_threshold_m,
    length_m: corridorModel(String(row.id))?.lengthM ?? 0,
    tower_count: 0,
    inspection_due: due,
    overdue,
    utility: {
      id: u.id, name: u.name, time_zone: u.time_zone,
      forester_name: u.forester_name, forester_email: u.forester_email,
    },
    current_set: currentSet,
  };
}

function towerJson(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const model = rows.length > 0 ? corridorModel(String(rows[0].corridor_id)) : undefined;
  return rows.map((r) => {
    const t = model?.centreline.towers.find((x) => x.number === r.number);
    return {
      number: r.number,
      label: `T${r.number}`,
      chainage_m: r.chainage_m,
      lon_deg: t?.lonDeg ?? 0,
      lat_deg: t?.latDeg ?? 0,
      base_height_m: r.base_height_m,
      attachment_height_m: model?.seed.attachmentHeightM ?? 0,
    };
  });
}

function fileJson(r: Record<string, unknown>): Record<string, unknown> {
  return { path: r.path, size_bytes: Number(r.size_bytes), sha256: r.sha256, state: r.state };
}

function assetJson(r: Record<string, unknown>, files: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: r.id,
    corridor_id: r.corridor_id,
    kind: r.kind,
    state: r.state,
    rejected_reason: r.rejected_reason ?? null,
    files: files.map(fileJson),
    created_at: iso(r.created_at as Date),
    stored_at: r.stored_at ? iso(r.stored_at as Date) : null,
  };
}

function spanJson(span: { fromTower: number; toTower: number; label: string }): Record<string, unknown> {
  return { from_tower: span.fromTower, to_tower: span.toTower, label: span.label };
}

function findingJson(r: Record<string, unknown>): Record<string, unknown> {
  const model = corridorModelForSetSync(r.set_id as string);
  const span = model ? spanForChainage(model, r.chainage_m as number) : { fromTower: 0, toTower: 0, label: 'Span 0–0' };
  return {
    id: r.id,
    set_id: r.set_id,
    label: r.label,
    chainage_m: r.chainage_m,
    offset_m: r.offset_m,
    lon_deg: r.lon_deg,
    lat_deg: r.lat_deg,
    ecef_m: [r.ecef_x, r.ecef_y, r.ecef_z],
    ground_height_m: r.ground_height_m,
    terrain_level: r.terrain_level ?? null,
    canopy_height_m: r.canopy_height_m,
    canopy_top_height_m: r.canopy_top_height_m,
    canopy_radius_m: r.canopy_radius_m,
    span: spanJson(span),
    clearance_m: r.clearance_m,
    status: r.status,
    comment: r.comment ?? '',
    updated_at: iso(r.updated_at as Date),
  };
}

const setModelCache = new Map<string, NonNullable<ReturnType<typeof corridorModel>>>();
async function corridorModelForSet(setId: string): Promise<ReturnType<typeof corridorModel> | undefined> {
  const pool = db();
  const res = await pool.query('SELECT corridor_id FROM findings_sets WHERE id=$1', [setId]);
  if (res.rows.length === 0) return undefined;
  const model = corridorModel(String(res.rows[0].corridor_id));
  if (model) setModelCache.set(setId, model);
  return model;
}
function corridorModelForSetSync(setId: string): ReturnType<typeof corridorModel> | undefined {
  return setModelCache.get(setId);
}

async function reviewLinkJson(pool: ReturnType<typeof db>, token: string): Promise<Record<string, unknown> | null> {
  const res = await pool.query(
    `SELECT rl.*, l.email_state FROM review_links rl
     LEFT JOIN LATERAL (
       SELECT e.state AS email_state FROM link_email_state les
       JOIN email_outbox e ON e.id = les.email_id
       WHERE les.token = rl.token ORDER BY e.id DESC LIMIT 1
     ) l ON true
     WHERE rl.token=$1`,
    [token]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  const revoked = r.revoked === true;
  const expired = !revoked && (r.expires_at as Date).getTime() <= Date.now();
  const status = revoked ? 'revoked' : expired ? 'expired' : 'live';
  const emailState = r.email_state === 'sent' ? 'sent' : 'queued';
  const base = publicBase();
  return {
    url: `${base}/review/${token}`,
    expires_at: iso(r.expires_at as Date),
    status,
    email_state: emailState,
  };
}

export function publicBase(): string {
  return process.env.APP_PUBLIC_URL ?? `http://localhost:${process.env.APP_PUBLIC_PORT ?? '4173'}`;
}

async function setJson(pool: ReturnType<typeof db>, r: Record<string, unknown>, includeLink = true): Promise<Record<string, unknown>> {
  const decisionsRes = await pool.query('SELECT finding_id, decision, note FROM decisions WHERE set_id=$1', [r.id]);
  const decisions: Record<string, Record<string, unknown>> = {};
  for (const d of decisionsRes.rows) {
    decisions[String(d.finding_id)] = { decision: d.decision, note: d.note };
  }
  let reviewLink: Record<string, unknown> | null = null;
  if (includeLink && r.review_link_token) {
    reviewLink = await reviewLinkJson(pool, String(r.review_link_token));
  }
  return {
    id: r.id,
    corridor_id: r.corridor_id,
    revision: r.revision,
    state: r.state,
    previous_set_id: r.previous_set_id ?? null,
    submitted_at: r.submitted_at ? iso(r.submitted_at as Date) : null,
    submitted_by: r.submitted_by ?? null,
    frozen: r.frozen_finding_count === null ? null : {
      finding_count: r.frozen_finding_count,
      violation_count: r.frozen_violation_count,
    },
    review_link: reviewLink,
    decisions,
  };
}

// ---------------------------------------------------------------------------
// Authentication

const SESSION_COOKIE = 'spanwise_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

async function staffFromToken(token: string): Promise<StaffCtx> {
  const pool = db();
  const res = await pool.query('SELECT * FROM sessions WHERE token=$1 AND expires_at > now()', [token]);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return { id: r.staff_id, tenantId: r.tenant_id, role: r.role, name: r.name, email: r.email };
}

async function signOutToken(token: string): Promise<void> {
  const pool = db();
  await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
}

function cookieHeader(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function readCookie(headers: Headers): string | null {
  const raw = headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=');
  }
  return null;
}

async function requireStaff(req: Req): Promise<StaffCtx> {
  const bearer = req.headers.get('authorization');
  if (bearer && bearer.startsWith('Bearer ')) {
    const code = bearer.slice(7).trim();
    const pool = db();
    const res = await pool.query('SELECT * FROM staff WHERE access_code=$1', [code]);
    if (res.rows.length === 0) throw unauthenticated();
    const r = res.rows[0];
    return { id: r.id, tenantId: r.tenant_id, role: r.role, name: r.name, email: r.email };
  }
  const token = readCookie(req.headers);
  if (token) {
    const staff = await staffFromToken(token);
    if (staff) return staff;
  }
  throw unauthenticated();
}

async function requireAnalyst(staff: StaffCtx): Promise<Exclude<StaffCtx, null>> {
  if (!staff || staff.role !== 'vegetation_analyst') {
    throw forbidden('Only a vegetation analyst may do that.');
  }
  return staff;
}

async function requireProcessor(staff: StaffCtx): Promise<Exclude<StaffCtx, null>> {
  if (!staff || staff.role !== 'survey_processor') {
    throw forbidden('Only a survey processor may do that.');
  }
  return staff;
}

/** Look up a review token, applying link liveness and expiry in one place. */
async function reviewContext(token: string, opts?: { requireLive?: boolean }): Promise<NonNullable<ReviewCtx>> {
  const pool = db();
  const res = await pool.query(
    `SELECT rl.token, rl.set_id, rl.revoked, rl.expires_at, fs.corridor_id
     FROM review_links rl JOIN findings_sets fs ON fs.id = rl.set_id
     WHERE rl.token=$1`,
    [token]
  );
  if (res.rows.length === 0) throw linkNotFound();
  const r = res.rows[0];
  if (r.revoked === true) throw linkRevoked();
  if ((r.expires_at as Date).getTime() <= Date.now()) throw linkExpired();
  const tenantId = await tenantOf(pool, String(r.corridor_id));
  return { token, setId: String(r.set_id), corridorId: String(r.corridor_id), tenantId };
}

async function corridorInTenant(pool: ReturnType<typeof db>, corridorId: string, tenantId: string): Promise<CorridorRow> {
  const res = await pool.query(
    'SELECT c.* FROM corridors c JOIN utilities u ON u.id = c.utility_id WHERE c.id=$1 AND u.tenant_id=$2',
    [corridorId, tenantId]
  );
  if (res.rows.length === 0) throw notFound('This corridor does not exist.');
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Route dispatch

const ROUTES: RouteSpec[] = [];

function route(method: string, pattern: string, auth: RouteSpec['auth'], handler: RouteSpec['handler']): void {
  ROUTES.push({ method, pattern, auth, handler });
}

function matchRoute(method: string, path: string): { spec: RouteSpec; params: Record<string, string> } | null {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const parts = r.pattern.split('/');
    const pparts = path.split('/');
    if (parts.length !== pparts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('{')) {
        params[parts[i].slice(1, -1)] = decodeURIComponent(pparts[i]);
      } else if (parts[i] !== pparts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { spec: r, params };
  }
  return null;
}

/** The one place that enforces JSON body size and content type by route. */
function checkJsonBody(req: Req, limit: number): void {
  if (req.body === null || req.body.length === 0) return;
  if (req.body.length > limit) throw payloadTooLarge();
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('application/json')) throw unsupportedMediaType();
}

const IDEMPOTENT_PATTERNS = new Set([
  'POST:/api/findings-sets/{id}/submit',
  'POST:/api/findings-sets/{id}/review-link/resend',
  'POST:/api/findings-sets/{id}/review-link/regenerate',
  'POST:/api/review/{token}/complete',
]);

export async function handleApi(method: string, path: string, query: URLSearchParams, headers: Headers, body: Buffer | null): Promise<Response> {
  const match = matchRoute(method, path);
  if (!match) throw notFound('This does not exist.');
  const { spec, params } = match;
  const staff: StaffCtx = spec.auth === 'staff' || spec.auth === 'staff-optional' ? await tryStaff(headers) : null;
  // Review auth errors (unknown, revoked, expired) surface to the handler.
  let reviewCtx: ReviewCtx = null;
  if (spec.auth === 'review') {
    reviewCtx = await reviewContext(params.token ?? '');
  }
  const req: Req = { method, path, query, headers, body, params, pattern: spec.pattern, staff, reviewCtx };
  const idemKey = headers.get('idempotency-key');
  const idemRoute = IDEMPOTENT_PATTERNS.has(`${method}:${spec.pattern}`);
  if (idemRoute && idemKey) {
    if (!validIdempotencyKey(idemKey)) {
      throw validationFailed({});
    }
    const parsed = parseJsonBody(body);
    const scope = routeScope({ staffTenant: staff?.tenantId ?? null, reviewToken: reviewCtx?.token ?? null, method, routePattern: spec.pattern });
    const stored = await replayStored(scope, idemKey, parsed);
    if (stored && !stored.pending) {
      return json(stored.status, stored.body);
    }
    if (!stored) {
      await beginIdempotent(scope, idemKey, parsed);
    }
    // Run the request, then commit its response under the key.
    let status = 500;
    let responseBody: unknown = { error: { code: 'internal_error', message: 'Something went wrong.' } };
    try {
      const res = await spec.handler(req);
      status = res.status;
      if (res.headers.get('content-type')?.includes('application/json')) {
        responseBody = JSON.parse(await res.text());
      } else {
        responseBody = null;
      }
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: res.headers,
      });
    } finally {
      if (status < 500) {
        await commitResponse(scope, idemKey, parsed, status, responseBody);
      } else {
        await commitResponse(scope, idemKey, parsed, 500, responseBody);
      }
    }
  }
  return spec.handler(req);
}

async function tryStaff(headers: Headers): Promise<StaffCtx> {
  try {
    return await requireStaff({ method: '', path: '', query: new URLSearchParams(), headers, body: null, params: {}, pattern: '', staff: null, reviewCtx: null });
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// Session and status

route('POST', '/api/session', 'none', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const code = body['access_code'];
  if (typeof code !== 'string' || code.trim() === '') {
    throw validationFailed({ access_code: 'Enter your access code.' });
  }
  const pool = db();
  const res = await pool.query('SELECT s.*, t.name AS tenant_name FROM staff s JOIN tenants t ON t.id=s.tenant_id WHERE s.access_code=$1', [code]);
  if (res.rows.length === 0) throw invalidAccessCode();
  const r = res.rows[0];
  const token = randomUUID() + randomUUID().replace(/-/g, '');
  await pool.query(
    'INSERT INTO sessions (token, staff_id, tenant_id, role, name, email, expires_at) VALUES ($1,$2,$3,$4,$5,$6,now() + interval \'12 hours\')',
    [token, r.id, r.tenant_id, r.role, r.name, r.email]
  );
  return new Response(JSON.stringify({
    staff: { id: r.id, name: r.name, role: r.role, email: r.email, tenant_id: r.tenant_id, tenant_name: r.tenant_name },
  }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': cookieHeader(token, SESSION_TTL_MS / 1000),
    },
  });
});

route('GET', '/api/session', 'staff', async (req) => {
  const pool = db();
  const res = await pool.query('SELECT s.*, t.name AS tenant_name FROM staff s JOIN tenants t ON t.id=s.tenant_id WHERE s.id=$1', [req.staff?.id]);
  if (res.rows.length === 0) throw unauthenticated();
  const r = res.rows[0];
  return json(200, { staff: { id: r.id, name: r.name, role: r.role, email: r.email, tenant_id: r.tenant_id, tenant_name: r.tenant_name } });
});

route('DELETE', '/api/session', 'none', async (req) => {
  const token = readCookie(req.headers);
  if (token) await signOutToken(token);
  return new Response(null, { status: 204, headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
});

route('GET', '/api/health', 'none', async () => json(200, { status: 'ok' }));

route('GET', '/api/status', 'none', async () => {
  const storageOk = await probeStorage();
  const mailOk = await probeMail();
  return json(200, {
    storage: storageOk ? 'ok' : 'unreachable',
    mail: mailOk ? 'ok' : 'unreachable',
    checked_at: iso(new Date()),
  });
});

// ---------------------------------------------------------------------------
// Corridors

route('GET', '/api/corridors', 'staff', async (req) => {
  const pool = db();
  const res = await pool.query(
    'SELECT c.* FROM corridors c JOIN utilities u ON u.id=c.utility_id WHERE u.tenant_id=$1 ORDER BY c.name',
    [req.staff?.tenantId]
  );
  const corridors = [];
  for (const row of res.rows) {
    const c = await corridorJson(pool, row);
    const towers = await pool.query('SELECT * FROM towers WHERE corridor_id=$1 ORDER BY number', [row.id]);
    c.tower_count = towers.rows.length;
    corridors.push(c);
  }
  return json(200, { corridors });
});

route('GET', '/api/corridors/{id}', 'staff', async (req) => {
  const pool = db();
  const corridorId = req.params.id;
  const row = await corridorInTenant(pool, corridorId, String(req.staff?.tenantId));
  const corridor = await corridorJson(pool, row);
  const towersRes = await pool.query('SELECT * FROM towers WHERE corridor_id=$1 ORDER BY number', [corridorId]);
  corridor.tower_count = towersRes.rows.length;
  const model = corridorModel(corridorId);
  const towers = model
    ? model.centreline.towers.map((t) => ({
        number: t.number,
        label: `T${t.number}`,
        chainage_m: t.chainageM,
        lon_deg: t.lonDeg,
        lat_deg: t.latDeg,
        base_height_m: t.baseHeightM,
        attachment_height_m: model.seed.attachmentHeightM,
      }))
    : towerJson(towersRes.rows);
  const activeAssets = await activeAssetIds(pool, corridorId);
  const coverage = await coverageFor(pool, corridorId);
  return json(200, { corridor, towers, active_assets: activeAssets, coverage });
});

async function activeAssetIds(pool: ReturnType<typeof db>, corridorId: string): Promise<{ tileset: string | null; terrain: string | null; czml: string | null }> {
  const res = await pool.query(
    `SELECT kind, id FROM assets WHERE corridor_id=$1 AND state='stored' ORDER BY created_at DESC`,
    [corridorId]
  );
  const out = { tileset: null as string | null, terrain: null as string | null, czml: null as string | null };
  for (const r of res.rows) {
    if (r.kind === 'tileset' && out.tileset === null) out.tileset = r.id;
    if (r.kind === 'terrain' && out.terrain === null) out.terrain = r.id;
    if (r.kind === 'czml' && out.czml === null) out.czml = r.id;
  }
  return out;
}

async function coverageFor(pool: ReturnType<typeof db>, corridorId: string): Promise<Array<{ from_m: number; to_m: number }>> {
  const res = await pool.query(
    'SELECT coverage FROM flight_tracks WHERE corridor_id=$1 ORDER BY parsed_at DESC LIMIT 1',
    [corridorId]
  );
  if (res.rows.length === 0) return [];
  return res.rows[0].coverage as Array<{ from_m: number; to_m: number }>;
}

/** The flight rule, in one place. */
async function flightAnswer(pool: ReturnType<typeof db>, corridorId: string, query: URLSearchParams): Promise<Record<string, unknown>> {
  const model = corridorModel(corridorId);
  if (!model) throw notFound('This corridor does not exist.');
  const length = model.lengthM;
  const chainageParam = query.get('chainage_m');
  const timeParam = query.get('time');
  if ((chainageParam === null) === (timeParam === null)) {
    throw validationFailed({ query: 'Give exactly one of chainage_m or time.' });
  }
  const trackRes = await pool.query(
    'SELECT parsed FROM flight_tracks WHERE corridor_id=$1 ORDER BY parsed_at DESC LIMIT 1',
    [corridorId]
  );
  const track = trackRes.rows.length > 0 ? (trackRes.rows[0].parsed as unknown as FlightTrack) : null;
  if (chainageParam !== null) {
    const chainage = Number(chainageParam);
    if (!Number.isFinite(chainage) || chainage < 0 || chainage > length) {
      throw validationFailed({ chainage_m: `Chainage must be between 0 and ${length.toFixed(1)} metres.` });
    }
    const answer = flightByChainage(track, chainage, length);
    if (!answer.covered) {
      return { chainage_m: round1(answer.chainageM), time: null, covered: false, label: 'No flight coverage' };
    }
    return {
      chainage_m: round1(answer.chainageM),
      time: isoMillis(answer.timeMs),
      covered: true,
      position: { lon_deg: answer.lonDeg, lat_deg: answer.latDeg, height_m: answer.heightM },
    };
  }
  const timeStr = String(timeParam);
  const timeMs = Date.parse(timeStr.endsWith('Z') ? timeStr : `${timeStr}Z`);
  if (Number.isNaN(timeMs)) {
    throw validationFailed({ query: 'Give exactly one of chainage_m or time.' });
  }
  const answer = flightByTime(model, track, timeMs);
  if (!answer.covered) {
    return { chainage_m: null, time: null, covered: false, label: 'No flight coverage' };
  }
  return {
    chainage_m: round1(answer.chainageM),
    time: isoMillis(answer.timeMs),
    covered: true,
    position: { lon_deg: answer.lonDeg, lat_deg: answer.latDeg, height_m: answer.heightM },
  };
}

function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

route('GET', '/api/corridors/{id}/flight', 'staff', async (req) => {
  const pool = db();
  await corridorInTenant(pool, req.params.id, String(req.staff?.tenantId));
  return json(200, await flightAnswer(pool, req.params.id, req.query));
});

route('GET', '/api/review/{token}/flight', 'review', async (req) => {
  const pool = db();
  return json(200, await flightAnswer(pool, req.reviewCtx?.corridorId ?? '', req.query));
});

// ---------------------------------------------------------------------------
// Assets

const KINDS = new Set(['tileset', 'terrain', 'czml']);
const PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

function validManifestPath(p: string): boolean {
  if (p.length < 1 || p.length > 512) return false;
  if (!PATH_RE.test(p)) return false;
  const segments = p.split('/');
  return segments.every((s) => s !== '.' && s !== '..');
}

route('POST', '/api/corridors/{id}/assets', 'staff', async (req) => {
  checkJsonBody(req, ASSET_JSON_LIMIT);
  await requireProcessor(req.staff);
  const pool = db();
  const corridorId = req.params.id;
  await corridorInTenant(pool, corridorId, String(req.staff?.tenantId));
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const fields: Record<string, string> = {};
  const kind = body['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    fields['kind'] = 'Choose tileset, terrain or czml.';
  }
  const files = body['files'];
  if (!Array.isArray(files) || files.length < 1 || files.length > 2000) {
    fields['files'] = 'Declare between 1 and 2,000 files.';
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);

  const seen = new Set<string>();
  const validFiles: Array<{ path: string; size: number; sha256: string }> = [];
  const fileFields: Record<string, string> = {};
  let tilesetJson = false;
  let layerJson = false;
  let czmlCount = 0;
  for (let i = 0; i < (files as JsonValue[]).length; i++) {
    const f = (files as JsonValue[])[i];
    if (typeof f !== 'object' || f === null || Array.isArray(f)) {
      fileFields[`files.${i}.path`] = 'Use a relative path of letters, digits, dot, dash and underscore segments.';
      continue;
    }
    const fo = f as Record<string, JsonValue>;
    const path = fo['path'];
    if (typeof path !== 'string' || !validManifestPath(path)) {
      fileFields[`files.${i}.path`] = 'Use a relative path of letters, digits, dot, dash and underscore segments.';
      continue;
    }
    if (seen.has(path)) {
      fields['files'] = 'Each path may appear once.';
      continue;
    }
    seen.add(path);
    const size = fo['size_bytes'];
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > FILE_LIMIT) {
      fileFields[`files.${i}.size_bytes`] = 'Each file must be between 1 and 50,000,000 bytes.';
      continue;
    }
    const sha = fo['sha256'];
    if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) {
      fileFields[`files.${i}.sha256`] = 'Give the SHA-256 as 64 lowercase hex characters.';
      continue;
    }
    validFiles.push({ path, size, sha256: sha });
    if (path === 'tileset.json') tilesetJson = true;
    if (path === 'layer.json') layerJson = true;
    if (path.endsWith('.czml')) czmlCount++;
  }
  if (kind === 'tileset' && !tilesetJson) fields['files'] = 'A tileset must include tileset.json.';
  if (kind === 'terrain' && !layerJson) fields['files'] = 'A terrain pyramid must include layer.json.';
  if (kind === 'czml' && (validFiles.length !== 1 || czmlCount !== 1)) fields['files'] = 'A flight track is exactly one .czml file.';
  if (Object.keys(fields).length > 0 || Object.keys(fileFields).length > 0) {
    throw validationFailed({ ...fields, ...fileFields });
  }
  const assetId = newId('ast');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO assets (id, corridor_id, kind, state, created_at) VALUES ($1,$2,$3,$4,now())',
      [assetId, corridorId, kind, 'pending']
    );
    for (const f of validFiles) {
      await client.query(
        'INSERT INTO asset_files (asset_id, path, size_bytes, sha256, state) VALUES ($1,$2,$3,$4,$5)',
        [assetId, f.path, f.size, f.sha256, 'pending']
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const res = await pool.query('SELECT * FROM assets WHERE id=$1', [assetId]);
  const filesRes = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 ORDER BY path', [assetId]);
  return json(201, { asset: assetJson(res.rows[0], filesRes.rows) });
});

route('GET', '/api/corridors/{id}/assets', 'staff', async (req) => {
  const pool = db();
  await corridorInTenant(pool, req.params.id, String(req.staff?.tenantId));
  const res = await pool.query('SELECT * FROM assets WHERE corridor_id=$1 ORDER BY created_at DESC, id DESC', [req.params.id]);
  const assets = [];
  for (const r of res.rows) {
    const files = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 ORDER BY path', [r.id]);
    assets.push(assetJson(r, files.rows));
  }
  return json(200, { assets });
});

route('GET', '/api/assets/{id}', 'staff', async (req) => {
  const pool = db();
  const res = await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (res.rows.length === 0) throw notFound('This asset does not exist.');
  const asset = res.rows[0];
  await corridorInTenant(pool, String(asset.corridor_id), String(req.staff?.tenantId));
  const files = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 ORDER BY path', [asset.id]);
  return json(200, { asset: assetJson(asset, files.rows) });
});

/** Storage-confirmed upload of one file, in one place. */
route('PUT', '/api/assets/{id}/files/{path}', 'staff', async (req) => {
  await requireProcessor(req.staff);
  const pool = db();
  const assetId = req.params.id;
  const path = req.params.path;
  const assetRes = await pool.query('SELECT * FROM assets WHERE id=$1', [assetId]);
  if (assetRes.rows.length === 0) throw notFound('This asset does not exist.');
  const asset = assetRes.rows[0];
  await corridorInTenant(pool, String(asset.corridor_id), String(req.staff?.tenantId));
  const fileRes = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 AND path=$2', [assetId, path]);
  if (fileRes.rows.length === 0) throw notFound('This file is not in the asset manifest.');
  const file = fileRes.rows[0];
  if (asset.state === 'rejected') throw assetRejected();
  if (file.state === 'stored') {
    const bytes = req.body ?? Buffer.alloc(0);
    if (sha256Hex(bytes) === file.sha256 && bytes.length === Number(file.size_bytes)) {
      return json(200, { asset: await assetWithFiles(pool, assetId), file: fileJson(file) });
    }
    throw fileAlreadyStored();
  }
  const body = req.body ?? Buffer.alloc(0);
  if (body.length > FILE_LIMIT) throw payloadTooLarge();
  const tenantId = await tenantOf(pool, String(asset.corridor_id));
  const key = assetKey(tenantId, String(asset.corridor_id), assetId, path);
  const actualSize = body.length;
  const actualSha = sha256Hex(body);
  if (actualSize !== Number(file.size_bytes)) {
    await rejectAsset(pool, assetId, tenantId, String(asset.corridor_id));
    throw checksumMismatch('size_bytes', 'Bytes did not match the declared size.');
  }
  if (actualSha !== file.sha256) {
    await rejectAsset(pool, assetId, tenantId, String(asset.corridor_id));
    throw checksumMismatch('sha256', 'Bytes did not match the declared SHA-256.');
  }
  const write = await writeVerified(key, body, file.sha256, actualSize);
  if (write === 'unreachable') throw storageUnavailable();
  if (write === 'mismatch') {
    await rejectAsset(pool, assetId, tenantId, String(asset.corridor_id));
    throw checksumMismatch('sha256', 'Bytes did not match the declared SHA-256.');
  }
  // Confirm from storage before marking the file stored.
  const storageOk = await confirmObjectHead(key, actualSize, actualSha);
  if (!storageOk) {
    await rejectAsset(pool, assetId, tenantId, String(asset.corridor_id));
    throw checksumMismatch('sha256', 'Bytes did not match the declared SHA-256.');
  }
  await markFileStored(pool, assetId, path, String(asset.kind), String(asset.corridor_id));
  const assetAfter = await assetWithFiles(pool, assetId);
  const fileAfter = (await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 AND path=$2', [assetId, path])).rows[0];
  return json(200, { asset: assetAfter, file: fileJson(fileAfter) });
});

async function confirmObjectHead(key: string, size: number, sha: string): Promise<boolean> {
  const client = storageClient();
  if (!client) return false;
  const head = await client.headObject(key);
  return head !== null && head.size === size && head.etagSha256 === sha;
}

async function assetWithFiles(pool: ReturnType<typeof db>, assetId: string): Promise<Record<string, unknown>> {
  const res = await pool.query('SELECT * FROM assets WHERE id=$1', [assetId]);
  const files = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 ORDER BY path', [assetId]);
  return assetJson(res.rows[0], files.rows);
}

/** Mark one file stored, and complete the asset when its last file lands. Safe under concurrency. */
async function markFileStored(pool: ReturnType<typeof db>, assetId: string, path: string, kind: string, corridorId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE asset_files SET state='stored' WHERE asset_id=$1 AND path=$2`, [assetId, path]);
    const remaining = await client.query(`SELECT count(*)::int AS n FROM asset_files WHERE asset_id=$1 AND state <> 'stored'`, [assetId]);
    if (remaining.rows[0].n === 0) {
      const existing = await client.query(`SELECT stored_at FROM assets WHERE id=$1 FOR UPDATE`, [assetId]);
      if (existing.rows[0].stored_at === null) {
        if (kind === 'czml') {
          const czmlBytes = await readStoredCzml(client, assetId, corridorId);
          const model = corridorModel(corridorId);
          if (!model) throw notFound();
          const parsed = parseTrack(model, czmlBytes.toString('utf8'));
          if (isInvalid(parsed)) {
            await client.query(`UPDATE assets SET state='rejected', rejected_reason='invalid_czml' WHERE id=$1`, [assetId]);
            await client.query(`UPDATE asset_files SET state='rejected' WHERE asset_id=$1`, [assetId]);
            await client.query('COMMIT');
            const tenantId = await tenantOf(pool, corridorId);
            await deletePrefix(tenantId, corridorId, assetId);
            throw invalidCzml();
          }
          const track = parsed as FlightTrack;
          const coverage = coverageRanges(track);
          await client.query('DELETE FROM flight_tracks WHERE corridor_id=$1', [corridorId]);
          await client.query(
            'INSERT INTO flight_tracks (corridor_id, asset_id, epoch_ms, parsed, coverage, parsed_at) VALUES ($1,$2,$3,$4,$5,now())',
            [corridorId, assetId, track.epochMs, JSON.stringify(track), JSON.stringify(coverage)]
          );
        }
        await client.query(`UPDATE assets SET state='stored', stored_at=now() WHERE id=$1`, [assetId]);
        await client.query('COMMIT');
        return true;
      }
    }
    await client.query('COMMIT');
    return false;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

async function readStoredCzml(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, assetId: string, corridorId: string): Promise<Buffer> {
  const fileRow = await client.query(`SELECT path FROM asset_files WHERE asset_id=$1 AND path LIKE '%.czml' LIMIT 1`, [assetId]);
  if (fileRow.rows.length === 0) throw invalidCzml();
  const path = String(fileRow.rows[0].path);
  const pool = db();
  const tenantId = await tenantOf(pool, corridorId);
  const res = await readObject(assetKey(tenantId, corridorId, assetId, path));
  if (res === 'unreachable') throw storageUnavailable();
  if (res === 'missing') throw invalidCzml();
  return res.bytes;
}

async function rejectAsset(pool: ReturnType<typeof db>, assetId: string, tenantId: string, corridorId: string): Promise<void> {
  await pool.query(`UPDATE assets SET state='rejected', rejected_reason='checksum_mismatch' WHERE id=$1 AND state='pending'`, [assetId]);
  await pool.query(`UPDATE asset_files SET state='rejected' WHERE asset_id=$1 AND state='pending'`, [assetId]);
  await deletePrefix(tenantId, corridorId, assetId);
}

async function deletePrefix(tenantId: string, corridorId: string, assetId: string): Promise<void> {
  const keys = await listPrefix(`tenants/${tenantId}/corridors/${corridorId}/assets/${assetId}/`);
  for (const key of keys) {
    await deleteObject(key);
  }
}

/** File reads: whole or single byte range, original bytes, SHA-256 ETag. */
async function serveFile(pool: ReturnType<typeof db>, assetId: string, path: string, corridorId: string, headers: Headers, query: URLSearchParams): Promise<Response> {
  const fileRes = await pool.query('SELECT * FROM asset_files WHERE asset_id=$1 AND path=$2', [assetId, path]);
  if (fileRes.rows.length === 0) throw notFound('This file is not in the asset manifest.');
  const file = fileRes.rows[0];
  if (file.state !== 'stored') throw notFound('This file is not stored.');
  const tenantId = await tenantOf(pool, corridorId);
  const key = assetKey(tenantId, corridorId, assetId, path);
  const rangeHeader = headers.get('range');
  let range: { from: number; to: number } | undefined;
  let unit: 'bytes' | null = null;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || (!m[1] && !m[2])) throw rangeNotSatisfiable();
    unit = 'bytes';
    const size = Number(file.size_bytes);
    if (m[1] === '') {
      // suffix range
      const suffix = Number(m[2]);
      if (suffix === 0 || suffix > size) throw rangeNotSatisfiable();
      range = { from: size - suffix, to: size - 1 };
    } else {
      const from = Number(m[1]);
      const to = m[2] === '' ? size - 1 : Number(m[2]);
      if (from >= size || to < from) throw rangeNotSatisfiable();
      range = { from, to: Math.min(to, size - 1) };
    }
  }
  void unit;
  const res = await readObject(key, range);
  if (res === 'unreachable') throw storageUnavailable();
  if (res === 'missing') throw notFound('This file is not stored.');
  const bytes = res.bytes;
  const contentType = contentTypeFor(path);
  const headersOut: Record<string, string> = {
    'content-type': contentType,
    'etag': `"${file.sha256}"`,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=0',
  };
  if (query.get('download') === '1') {
    headersOut['content-disposition'] = `attachment; filename="${path.split('/').pop() ?? path}"`;
  }
  if (range) {
    headersOut['content-range'] = `bytes ${range.from}-${range.to}/${file.size_bytes}`;
    headersOut['content-length'] = String(bytes.length);
    return new Response(new Uint8Array(bytes), { status: 206, headers: headersOut });
  }
  headersOut['content-length'] = String(bytes.length);
  return new Response(new Uint8Array(bytes), { status: 200, headers: headersOut });
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.json') || path.endsWith('.czml')) return 'application/json';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  if (path.endsWith('.ktx2')) return 'image/ktx2';
  if (path.endsWith('.terrain')) return 'application/vnd.quantized-mesh';
  return 'application/octet-stream';
}

route('GET', '/api/assets/{id}/files/{path}', 'staff', async (req) => {
  const pool = db();
  const assetRes = await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (assetRes.rows.length === 0) throw notFound('This asset does not exist.');
  const asset = assetRes.rows[0];
  await corridorInTenant(pool, String(asset.corridor_id), String(req.staff?.tenantId));
  return serveFile(pool, req.params.id, req.params.path, String(asset.corridor_id), req.headers, req.query);
});

route('GET', '/api/review/{token}/assets/{asset_id}/files/{path}', 'review', async (req) => {
  const pool = db();
  const assetRes = await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.asset_id]);
  if (assetRes.rows.length === 0) throw notFound('This asset does not exist.');
  const asset = assetRes.rows[0];
  if (String(asset.corridor_id) !== req.reviewCtx?.corridorId) throw notFound('This asset does not exist.');
  return serveFile(pool, req.params.asset_id, req.params.path, String(asset.corridor_id), req.headers, req.query);
});

// ---------------------------------------------------------------------------
// Findings sets and findings

route('POST', '/api/corridors/{id}/findings-sets', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const corridorId = req.params.id;
  await corridorInTenant(pool, corridorId, staff.tenantId);
  const open = await pool.query(
    `SELECT id FROM findings_sets WHERE corridor_id=$1 AND state <> 'closed'`,
    [corridorId]
  );
  if (open.rows.length > 0) throw openSetExists();
  const setId = newId('fs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const revRes = await client.query(
      'SELECT coalesce(max(revision),0)+1 AS next FROM findings_sets WHERE corridor_id=$1',
      [corridorId]
    );
    const revision = revRes.rows[0].next;
    await client.query(
      'INSERT INTO findings_sets (id, corridor_id, revision, state, created_by) VALUES ($1,$2,$3,$4,$5)',
      [setId, corridorId, revision, 'draft', staff.id]
    );
    await client.query('INSERT INTO label_counter (set_id, next_number) VALUES ($1,1)', [setId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const row = await pool.query('SELECT * FROM findings_sets WHERE id=$1', [setId]);
  return json(201, { set: await setJson(pool, row.rows[0], false) });
});

route('GET', '/api/findings-sets/{id}', 'staff', async (req) => {
  const pool = db();
  const res = await pool.query('SELECT * FROM findings_sets WHERE id=$1', [req.params.id]);
  if (res.rows.length === 0) throw notFound('This findings set does not exist.');
  const set = res.rows[0];
  await corridorInTenant(pool, String(set.corridor_id), String(req.staff?.tenantId));
  await corridorModelForSet(String(set.id));
  const findings = await pool.query(
    'SELECT * FROM findings WHERE set_id=$1 ORDER BY chainage_m, number',
    [set.id]
  );
  return json(200, { set: await setJson(pool, set), findings: findings.rows.map(findingJson) });
});

/** Finding input validation, in one place. */
function validateFindingInput(body: Record<string, unknown>, lengthM: number): { fields: Record<string, string>; values: {
  chainage?: number; offset?: number; lon?: number; lat?: number;
  groundHeight?: number; terrainLevel?: number | null;
  canopyHeight: number; canopyRadius: number; comment: string;
} } {
  const fields: Record<string, string> = {};
  const values = { canopyHeight: 0, canopyRadius: 3, comment: '' } as {
    chainage?: number; offset?: number; lon?: number; lat?: number;
    groundHeight?: number; terrainLevel?: number | null;
    canopyHeight: number; canopyRadius: number; comment: string;
  };
  const hasChainage = typeof body['chainage_m'] === 'number';
  const hasOffset = typeof body['offset_m'] === 'number';
  const hasLon = typeof body['lon_deg'] === 'number';
  const hasLat = typeof body['lat_deg'] === 'number';
  if ((hasChainage || hasOffset) && (hasLon || hasLat)) {
    fields['position'] = 'Give either chainage and offset or longitude and latitude.';
  } else if (!hasChainage && !hasOffset && !hasLon && !hasLat) {
    fields['position'] = 'Give either chainage and offset or longitude and latitude.';
  } else if (hasLon || hasLat) {
    if (!hasLon || !hasLat) fields['position'] = 'Give either chainage and offset or longitude and latitude.';
    else { values.lon = body['lon_deg'] as number; values.lat = body['lat_deg'] as number; }
  } else {
    if (!hasChainage || !hasOffset) fields['position'] = 'Give either chainage and offset or longitude and latitude.';
    else { values.chainage = body['chainage_m'] as number; values.offset = body['offset_m'] as number; }
  }
  if (values.chainage !== undefined && (values.chainage < 0 || values.chainage > lengthM)) {
    fields['chainage_m'] = `Chainage must be between 0 and ${lengthM.toFixed(1)} metres.`;
  }
  if (values.offset !== undefined && (values.offset < -60 || values.offset > 60)) {
    fields['offset_m'] = 'Offset must be between -60 and 60 metres.';
  }
  const gh = body['ground_height_m'];
  if (typeof gh !== 'number' || gh < -500 || gh > 9000) {
    fields['ground_height_m'] = 'Ground height must be between -500 and 9,000 metres.';
  } else {
    values.groundHeight = gh;
  }
  const lvl = body['terrain_level'];
  if (lvl === null || lvl === undefined) {
    values.terrainLevel = null;
  } else if (typeof lvl !== 'number' || !Number.isInteger(lvl) || lvl < 0 || lvl > 24) {
    fields['terrain_level'] = 'Terrain level must be a whole number from 0 to 24, or empty.';
  } else {
    values.terrainLevel = lvl;
  }
  const ch = body['canopy_height_m'];
  if (typeof ch !== 'number' || ch < 0.5 || ch > 80) {
    fields['canopy_height_m'] = 'Canopy height must be between 0.5 and 80 metres.';
  } else {
    values.canopyHeight = ch;
  }
  const cr = body['canopy_radius_m'];
  if (cr === undefined) {
    values.canopyRadius = 3;
  } else if (typeof cr !== 'number' || cr < 0.5 || cr > 20) {
    fields['canopy_radius_m'] = 'Canopy radius must be between 0.5 and 20 metres.';
  } else {
    values.canopyRadius = cr;
  }
  const comment = body['comment'];
  if (comment === undefined || comment === null || comment === '') {
    values.comment = '';
  } else if (typeof comment !== 'string' || comment.length > 2000) {
    fields['comment'] = 'Comment must be 2,000 characters or fewer.';
  } else {
    values.comment = comment;
  }
  return { fields, values };
}

/** Labels, in one place: next number is committed with the insert. */
async function nextLabel(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, setId: string): Promise<number> {
  const res = await client.query(
    `UPDATE label_counter SET next_number = next_number + 1 WHERE set_id=$1 RETURNING next_number - 1 AS n`,
    [setId]
  );
  return res.rows[0].n as number;
}

route('POST', '/api/findings-sets/{id}/findings', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const setRes = await pool.query('SELECT * FROM findings_sets WHERE id=$1', [setId]);
  if (setRes.rows.length === 0) throw notFound('This findings set does not exist.');
  const set = setRes.rows[0];
  await corridorInTenant(pool, String(set.corridor_id), staff.tenantId);
  if (set.state !== 'draft') throw setNotDraft();
  const model = await corridorModelForSet(setId);
  if (!model) throw notFound('This findings set does not exist.');
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const { fields, values } = validateFindingInput(body, model.lengthM);
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  let chainage = values.chainage;
  let offset = values.offset;
  if (chainage === undefined || offset === undefined) {
    const proj = projectFinding(model, values.lon ?? 0, values.lat ?? 0);
    if (proj.chainageM < 0 || proj.chainageM > model.lengthM) {
      throw validationFailed({ chainage_m: `Chainage must be between 0 and ${model.lengthM.toFixed(1)} metres.` });
    }
    if (proj.offsetM < -60 || proj.offsetM > 60) {
      throw validationFailed({ offset_m: 'Offset must be between -60 and 60 metres.' });
    }
    chainage = proj.chainageM;
    offset = proj.offsetM;
  }
  const findingId = newId('f');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const number = await nextLabel(client, setId);
    const d = deriveFinding(model, {
      chainageM: chainage, offsetM: offset,
      groundHeightM: values.groundHeight ?? 0, canopyHeightM: values.canopyHeight, canopyRadiusM: values.canopyRadius,
    });
    await client.query(
      `INSERT INTO findings (id, set_id, label, number, chainage_m, offset_m, lon_deg, lat_deg, ecef_x, ecef_y, ecef_z,
       ground_height_m, terrain_level, canopy_height_m, canopy_top_height_m, canopy_radius_m, clearance_m, status, comment, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())`,
      [findingId, setId, `F-${number}`, number, chainage, offset, d.lonDeg, d.latDeg, d.ecef.x, d.ecef.y, d.ecef.z,
       values.groundHeight ?? 0, values.terrainLevel ?? null, values.canopyHeight, d.canopyTopHeightM, values.canopyRadius, d.clearanceM, d.status, values.comment]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const row = await pool.query('SELECT * FROM findings WHERE id=$1', [findingId]);
  return json(201, { finding: findingJson(row.rows[0]) });
});

async function findingInTenant(pool: ReturnType<typeof db>, findingId: string, tenantId: string): Promise<Record<string, unknown>> {
  const res = await pool.query(
    `SELECT f.*, fs.corridor_id FROM findings f JOIN findings_sets fs ON fs.id=f.set_id WHERE f.id=$1`,
    [findingId]
  );
  if (res.rows.length === 0) throw notFound('This finding does not exist.');
  await corridorInTenant(pool, String(res.rows[0].corridor_id), tenantId);
  return res.rows[0];
}

route('PATCH', '/api/findings/{id}', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const findingId = req.params.id;
  const row = await findingInTenant(pool, findingId, staff.tenantId);
  const setId = String(row.set_id);
  const setRes = await pool.query('SELECT * FROM findings_sets WHERE id=$1', [setId]);
  const set = setRes.rows[0];
  if (set.state !== 'draft') throw setNotDraft();
  const model = await corridorModelForSet(setId);
  if (!model) throw notFound();
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const fields: Record<string, string> = {};
  let chainage = row.chainage_m as number;
  let offset = row.offset_m as number;
  let groundHeight = row.ground_height_m as number;
  let terrainLevel = row.terrain_level as number | null;
  const hasLocation = body['chainage_m'] !== undefined || body['offset_m'] !== undefined ||
    body['lon_deg'] !== undefined || body['lat_deg'] !== undefined;
  const hasGh = body['ground_height_m'] !== undefined;
  const hasLvl = body['terrain_level'] !== undefined;
  if (hasLocation !== (hasGh && hasLvl)) {
    // A location change needs the position form, ground height and level together.
    if (hasLocation) {
      fields['position'] = 'Give either chainage and offset or longitude and latitude.';
    }
  }
  if (hasLocation) {
    const sub = validateFindingInput(
      {
        chainage_m: body['chainage_m'] ?? row.chainage_m,
        offset_m: body['offset_m'] ?? row.offset_m,
        lon_deg: body['lon_deg'],
        lat_deg: body['lat_deg'],
        ground_height_m: body['ground_height_m'] ?? row.ground_height_m,
        terrain_level: body['terrain_level'] ?? row.terrain_level,
        canopy_height_m: body['canopy_height_m'] ?? row.canopy_height_m,
        canopy_radius_m: body['canopy_radius_m'] ?? row.canopy_radius_m,
      },
      model.lengthM
    );
    Object.assign(fields, sub.fields);
    if (sub.values.chainage !== undefined) chainage = sub.values.chainage;
    if (sub.values.offset !== undefined) offset = sub.values.offset;
    if (sub.values.lon !== undefined) {
      const proj = projectFinding(model, sub.values.lon, sub.values.lat ?? 0);
      if (proj.chainageM < 0 || proj.chainageM > model.lengthM) {
        fields['chainage_m'] = `Chainage must be between 0 and ${model.lengthM.toFixed(1)} metres.`;
      } else if (proj.offsetM < -60 || proj.offsetM > 60) {
        fields['offset_m'] = 'Offset must be between -60 and 60 metres.';
      } else {
        chainage = proj.chainageM;
        offset = proj.offsetM;
      }
    }
    if (sub.values.groundHeight !== undefined) groundHeight = sub.values.groundHeight;
    if (sub.values.terrainLevel !== undefined) terrainLevel = sub.values.terrainLevel;
  }
  let canopyHeight = row.canopy_height_m as number;
  if (body['canopy_height_m'] !== undefined) {
    const v = body['canopy_height_m'];
    if (typeof v !== 'number' || v < 0.5 || v > 80) {
      fields['canopy_height_m'] = 'Canopy height must be between 0.5 and 80 metres.';
    } else canopyHeight = v;
  }
  let canopyRadius = row.canopy_radius_m as number;
  if (body['canopy_radius_m'] !== undefined) {
    const v = body['canopy_radius_m'];
    if (typeof v !== 'number' || v < 0.5 || v > 20) {
      fields['canopy_radius_m'] = 'Canopy radius must be between 0.5 and 20 metres.';
    } else canopyRadius = v;
  }
  let comment = row.comment as string;
  if (body['comment'] !== undefined) {
    const v = body['comment'];
    if (typeof v !== 'string' || v.length > 2000) {
      fields['comment'] = 'Comment must be 2,000 characters or fewer.';
    } else comment = v;
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const d = deriveFinding(model, { chainageM: chainage, offsetM: offset, groundHeightM: groundHeight, canopyHeightM: canopyHeight, canopyRadiusM: canopyRadius });
  await pool.query(
    `UPDATE findings SET chainage_m=$2, offset_m=$3, lon_deg=$4, lat_deg=$5, ecef_x=$6, ecef_y=$7, ecef_z=$8,
     ground_height_m=$9, terrain_level=$10, canopy_height_m=$11, canopy_top_height_m=$12, canopy_radius_m=$13,
     clearance_m=$14, status=$15, comment=$16, updated_at=now() WHERE id=$1`,
    [findingId, chainage, offset, d.lonDeg, d.latDeg, d.ecef.x, d.ecef.y, d.ecef.z,
     groundHeight, terrainLevel, canopyHeight, d.canopyTopHeightM, canopyRadius, d.clearanceM, d.status, comment]
  );
  const after = await pool.query('SELECT * FROM findings WHERE id=$1', [findingId]);
  return json(200, { finding: findingJson(after.rows[0]) });
});

route('DELETE', '/api/findings/{id}', 'staff', async (req) => {
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const row = await findingInTenant(pool, req.params.id, staff.tenantId);
  const setRes = await pool.query('SELECT state FROM findings_sets WHERE id=$1', [row.set_id]);
  if (setRes.rows[0].state !== 'draft') throw setNotDraft();
  await pool.query('DELETE FROM decisions WHERE finding_id=$1', [req.params.id]);
  await pool.query('DELETE FROM findings WHERE id=$1', [req.params.id]);
  return new Response(null, { status: 204 });
});

/** Terrain re-resolution, in one place: the level only ever increases. */
route('POST', '/api/findings/{id}/terrain', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const row = await findingInTenant(pool, req.params.id, staff.tenantId);
  const setId = String(row.set_id);
  const setRes = await pool.query('SELECT state FROM findings_sets WHERE id=$1', [setId]);
  if (setRes.rows[0].state !== 'draft') throw setNotDraft();
  const model = await corridorModelForSet(setId);
  if (!model) throw notFound();
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const fields: Record<string, string> = {};
  const gh = body['ground_height_m'];
  const lvl = body['terrain_level'];
  if (typeof gh !== 'number' || gh < -500 || gh > 9000) {
    fields['ground_height_m'] = 'Ground height must be between -500 and 9,000 metres.';
  }
  if (typeof lvl !== 'number' || !Number.isInteger(lvl) || lvl < 0 || lvl > 24) {
    fields['terrain_level'] = 'Terrain level must be a whole number from 0 to 24, or empty.';
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT terrain_level, ground_height_m, clearance_m FROM findings WHERE id=$1 FOR UPDATE', [req.params.id]);
    const currentLevel = cur.rows[0].terrain_level as number | null;
    const newLevel = lvl as number;
    if (currentLevel !== null && newLevel <= currentLevel) {
      await client.query('ROLLBACK');
      throw coarserTerrain();
    }
    const d = deriveFinding(model, {
      chainageM: row.chainage_m as number, offsetM: row.offset_m as number,
      groundHeightM: gh as number, canopyHeightM: row.canopy_height_m as number, canopyRadiusM: row.canopy_radius_m as number,
    });
    await client.query(
      `UPDATE findings SET ground_height_m=$2, terrain_level=$3, canopy_top_height_m=$4, ecef_x=$5, ecef_y=$6, ecef_z=$7,
       lon_deg=$8, lat_deg=$9, clearance_m=$10, status=$11, updated_at=now() WHERE id=$1`,
      [req.params.id, gh as number, newLevel, d.canopyTopHeightM, d.ecef.x, d.ecef.y, d.ecef.z, d.lonDeg, d.latDeg, d.clearanceM, d.status]
    );
    await client.query('COMMIT');
    const previous = {
      ground_height_m: cur.rows[0].ground_height_m,
      terrain_level: currentLevel,
      clearance_m: cur.rows[0].clearance_m,
    };
    const after = await pool.query('SELECT * FROM findings WHERE id=$1', [req.params.id]);
    return json(200, { finding: findingJson(after.rows[0]), previous });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Submit, close, revise, evidence, review links

type SetRow = Record<string, unknown>;

async function loadSet(pool: ReturnType<typeof db>, id: string): Promise<SetRow> {
  const res = await pool.query('SELECT * FROM findings_sets WHERE id=$1', [id]);
  if (res.rows.length === 0) throw notFound('This findings set does not exist.');
  return res.rows[0];
}

async function setInTenant(pool: ReturnType<typeof db>, id: string, tenantId: string): Promise<SetRow> {
  const set = await loadSet(pool, id);
  await corridorInTenant(pool, String(set.corridor_id), tenantId);
  return set;
}

route('POST', '/api/findings-sets/{id}/submit', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  if (set.state !== 'draft') throw illegalTransition(String(set.state), 'submit');
  const model = await corridorModelForSet(setId);
  if (!model) throw notFound();
  const findings = await pool.query(
    `SELECT * FROM findings WHERE set_id=$1 ORDER BY chainage_m, number`,
    [setId]
  );
  if (findings.rows.length === 0) {
    throw validationFailed({ findings: 'Add at least one finding before submitting.' });
  }
  // The submit transaction: freeze counts, evidence pack, link, email record.
  const corridorRow = await pool.query('SELECT * FROM corridors WHERE id=$1', [set.corridor_id]);
  const utilRes = await pool.query('SELECT * FROM utilities WHERE id=$1', [corridorRow.rows[0].utility_id]);
  const utility = utilRes.rows[0];
  const assets = await activeAssetsFull(pool, String(set.corridor_id));
  const violationCount = findings.rows.filter((f) => f.status === 'violation').length;
  const ttl = Number(process.env.REVIEW_LINK_TTL_SECONDS ?? '1209600');
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const evidenceBytes = Buffer.from(JSON.stringify({
    set_id: setId,
    corridor_id: set.corridor_id,
    revision: set.revision,
    submitted_at: iso(new Date()),
    frozen: { finding_count: findings.rows.length, violation_count: violationCount },
    findings: findings.rows.map((f) => ({
      label: f.label,
      ecef_m: [f.ecef_x, f.ecef_y, f.ecef_z],
      lon_deg: f.lon_deg,
      lat_deg: f.lat_deg,
      ground_height_m: f.ground_height_m,
      terrain_level: f.terrain_level ?? null,
      canopy_top_height_m: f.canopy_top_height_m,
      canopy_radius_m: f.canopy_radius_m,
      chainage_m: f.chainage_m,
      span_label: spanForChainage(model, f.chainage_m as number).label,
      clearance_m: f.clearance_m,
      status: f.status,
      comment: f.comment,
    })),
    assets,
  }), 'utf8');
  const tenantId = await tenantOf(pool, String(set.corridor_id));
  const key = evidenceKey(tenantId, String(set.corridor_id), setId);
  const storageOk = await probeStorage();
  if (!storageOk) throw storageUnavailable();
  const write = await writeVerified(key, evidenceBytes, sha256Hex(evidenceBytes), evidenceBytes.length);
  if (write !== 'ok') throw storageUnavailable();
  const client = await pool.connect();
  let emailId = '';
  try {
    await client.query('BEGIN');
    const stateRes = await client.query('SELECT state FROM findings_sets WHERE id=$1 FOR UPDATE', [setId]);
    if (stateRes.rows[0].state !== 'draft') {
      await client.query('ROLLBACK');
      throw illegalTransition(String(stateRes.rows[0].state), 'submit');
    }
    await client.query(
      `UPDATE findings_sets SET state='submitted', submitted_at=now(), submitted_by=$2,
       frozen_finding_count=$3, frozen_violation_count=$4, review_link_token=$5 WHERE id=$1`,
      [setId, staff.id, findings.rows.length, violationCount, token]
    );
    await client.query(
      'INSERT INTO review_links (token, set_id, expires_at) VALUES ($1,$2,$3)',
      [token, setId, expiresAt]
    );
    const expiryLine = `Link expires ${formatLocal(expiresAt, utility.time_zone)}`;
    const countsLine = `${findings.rows.length} ${findings.rows.length === 1 ? 'finding' : 'findings'}, ${violationCount} ${violationCount === 1 ? 'violation' : 'violations'}`;
    const emailBody = `${publicBase()}/review/${token}\n${expiryLine}\n${countsLine}`;
    const subject = `Spanwise review: ${corridorRow.rows[0].name} revision ${set.revision}`;
    const outboxRes = await client.query(
      `INSERT INTO email_outbox (kind, ref_id, to_email, subject, body, state) VALUES ('review_link',$1,$2,$3,$4,'queued') RETURNING id`,
      [token, utility.forester_email, subject, emailBody]
    );
    emailId = String(outboxRes.rows[0].id);
    await client.query('INSERT INTO link_email_state (token, email_id, set_id) VALUES ($1,$2,$3)', [token, Number(emailId), setId]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw err;
  } finally {
    client.release();
  }
  // Email attempted only after commit, within the request's limit.
  const delivered = await trySendWithinLimit(emailId);
  const setAfter = await loadSet(pool, setId);
  return json(200, {
    set: await setJson(pool, setAfter),
    review_link: await reviewLinkJson(pool, token),
    email: delivered === 'sent' ? 'sent' : 'queued',
  });
});

function formatLocal(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} (${timeZone})`;
}

async function activeAssetsFull(pool: ReturnType<typeof db>, corridorId: string): Promise<Array<Record<string, unknown>>> {
  const res = await pool.query(
    `SELECT * FROM assets WHERE corridor_id=$1 AND state='stored' ORDER BY created_at DESC`,
    [corridorId]
  );
  const picked = new Map<string, Record<string, unknown>>();
  for (const r of res.rows) {
    if (!picked.has(r.kind)) picked.set(r.kind, r);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const [kind, r] of picked) {
    const files = await pool.query('SELECT path, size_bytes, sha256 FROM asset_files WHERE asset_id=$1', [r.id]);
    out.push({
      id: r.id,
      kind,
      files: files.rows.map((f) => ({ path: f.path, size_bytes: Number(f.size_bytes), sha256: f.sha256 })),
    });
  }
  return out;
}

route('POST', '/api/findings-sets/{id}/close', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  if (set.state !== 'accepted') throw illegalTransition(String(set.state), 'close');
  await pool.query(`UPDATE findings_sets SET state='closed' WHERE id=$1`, [setId]);
  const after = await loadSet(pool, setId);
  return json(200, { set: await setJson(pool, after) });
});

route('POST', '/api/findings-sets/{id}/revisions', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  if (set.state !== 'disputed') throw illegalTransition(String(set.state), 'revise');
  const corridorId = String(set.corridor_id);
  const newSetId = newId('fs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT state FROM findings_sets WHERE id=$1 FOR UPDATE', [setId]);
    if (cur.rows[0].state !== 'disputed') {
      await client.query('ROLLBACK');
      throw illegalTransition(String(cur.rows[0].state), 'revise');
    }
    await client.query(`UPDATE findings_sets SET state='closed' WHERE id=$1`, [setId]);
    const revRes = await client.query(
      'SELECT coalesce(max(revision),0)+1 AS next FROM findings_sets WHERE corridor_id=$1',
      [corridorId]
    );
    const revision = revRes.rows[0].next;
    await client.query(
      'INSERT INTO findings_sets (id, corridor_id, revision, state, previous_set_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [newSetId, corridorId, revision, 'draft', setId, staff.id]
    );
    await client.query('INSERT INTO label_counter (set_id, next_number) VALUES ($1,1)', [newSetId]);
    const oldFindings = await client.query('SELECT * FROM findings WHERE set_id=$1 ORDER BY number', [setId]);
    let maxNumber = 0;
    for (const f of oldFindings.rows) {
      await client.query(
        `INSERT INTO findings (id, set_id, label, number, chainage_m, offset_m, lon_deg, lat_deg, ecef_x, ecef_y, ecef_z,
         ground_height_m, terrain_level, canopy_height_m, canopy_top_height_m, canopy_radius_m, clearance_m, status, comment, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())`,
        [newId('f'), newSetId, f.label, f.number, f.chainage_m, f.offset_m, f.lon_deg, f.lat_deg, f.ecef_x, f.ecef_y, f.ecef_z,
         f.ground_height_m, f.terrain_level, f.canopy_height_m, f.canopy_top_height_m, f.canopy_radius_m, f.clearance_m, f.status, f.comment]
      );
      maxNumber = Math.max(maxNumber, f.number as number);
    }
    await client.query('UPDATE label_counter SET next_number=$2 WHERE set_id=$1', [newSetId, maxNumber + 1]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw err;
  } finally {
    client.release();
  }
  await corridorModelForSet(newSetId);
  const after = await loadSet(pool, newSetId);
  return json(201, { set: await setJson(pool, after, false) });
});

route('GET', '/api/findings-sets/{id}/evidence', 'staff', async (req) => {
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, String(req.staff?.tenantId));
  if (set.submitted_at === null) throw notFound('This findings set has not been submitted.');
  const tenantId = await tenantOf(pool, String(set.corridor_id));
  const key = evidenceKey(tenantId, String(set.corridor_id), setId);
  const res = await readObject(key);
  if (res === 'unreachable') throw storageUnavailable();
  if (res === 'missing') throw notFound('This findings set has not been submitted.');
  return new Response(new Uint8Array(res.bytes), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(res.bytes.length) },
  });
});

route('POST', '/api/findings-sets/{id}/review-link/resend', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  const token = set.review_link_token as string | null;
  if (!token) throw linkNotLive();
  const link = await pool.query('SELECT * FROM review_links WHERE token=$1', [token]);
  if (link.rows.length === 0 || link.rows[0].revoked === true || (link.rows[0].expires_at as Date).getTime() <= Date.now()) {
    throw linkNotLive();
  }
  const email = await recordLinkEmail(pool, setId, token);
  const delivered = await trySendWithinLimit(email.emailId);
  return json(200, { review_link: await reviewLinkJson(pool, token), email: delivered === 'sent' ? 'sent' : 'queued' });
});

route('POST', '/api/findings-sets/{id}/review-link/revoke', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  const token = set.review_link_token as string | null;
  if (!token) throw linkNotLive();
  const link = await pool.query('SELECT * FROM review_links WHERE token=$1', [token]);
  if (link.rows.length === 0 || link.rows[0].revoked === true || (link.rows[0].expires_at as Date).getTime() <= Date.now()) {
    throw linkNotLive();
  }
  await pool.query('UPDATE review_links SET revoked=true, revoked_at=now() WHERE token=$1', [token]);
  return json(200, { review_link: await reviewLinkJson(pool, token) });
});

route('POST', '/api/findings-sets/{id}/review-link/regenerate', 'staff', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const staff = await requireAnalyst(req.staff);
  const pool = db();
  const setId = req.params.id;
  const set = await setInTenant(pool, setId, staff.tenantId);
  const state = String(set.state);
  if (state !== 'submitted' && state !== 'under_review' && state !== 'accepted' && state !== 'disputed') {
    throw illegalTransition(state, 'regenerate');
  }
  const corridorRow = await pool.query('SELECT * FROM corridors WHERE id=$1', [set.corridor_id]);
  const utilRes = await pool.query('SELECT * FROM utilities WHERE id=$1', [corridorRow.rows[0].utility_id]);
  const utility = utilRes.rows[0];
  const ttl = Number(process.env.REVIEW_LINK_TTL_SECONDS ?? '1209600');
  const newTok = newToken();
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const client = await pool.connect();
  let emailId = '';
  try {
    await client.query('BEGIN');
    if (set.review_link_token) {
      await client.query('UPDATE review_links SET revoked=true, revoked_at=now() WHERE token=$1', [set.review_link_token]);
    }
    await client.query('INSERT INTO review_links (token, set_id, expires_at) VALUES ($1,$2,$3)', [newTok, setId, expiresAt]);
    await client.query('UPDATE findings_sets SET review_link_token=$2 WHERE id=$1', [setId, newTok]);
    const counts = frozenCountsLine(pool, set);
    const emailBody = `${publicBase()}/review/${newTok}\nLink expires ${formatLocal(expiresAt, utility.time_zone)}\n${counts}`;
    const subject = `Spanwise review: ${corridorRow.rows[0].name} revision ${set.revision}`;
    const outboxRes = await client.query(
      `INSERT INTO email_outbox (kind, ref_id, to_email, subject, body, state) VALUES ('review_link',$1,$2,$3,$4,'queued') RETURNING id`,
      [newTok, utility.forester_email, subject, emailBody]
    );
    emailId = String(outboxRes.rows[0].id);
    await client.query('INSERT INTO link_email_state (token, email_id, set_id) VALUES ($1,$2,$3)', [newTok, Number(emailId), setId]);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw err;
  } finally {
    client.release();
  }
  const delivered = await trySendWithinLimit(emailId);
  return json(201, { review_link: await reviewLinkJson(pool, newTok), email: delivered === 'sent' ? 'sent' : 'queued' });
});

function frozenCountsLine(pool: ReturnType<typeof db>, set: SetRow): string {
  const n = set.frozen_finding_count as number | null;
  const v = set.frozen_violation_count as number | null;
  if (n === null || v === null) return '';
  return `${n} ${n === 1 ? 'finding' : 'findings'}, ${v} ${v === 1 ? 'violation' : 'violations'}`;
}

async function recordLinkEmail(pool: ReturnType<typeof db>, setId: string, token: string): Promise<{ emailId: string }> {
  const set = await loadSet(pool, setId);
  const corridorRow = await pool.query('SELECT * FROM corridors WHERE id=$1', [set.corridor_id]);
  const utilRes = await pool.query('SELECT * FROM utilities WHERE id=$1', [corridorRow.rows[0].utility_id]);
  const utility = utilRes.rows[0];
  const link = await pool.query('SELECT * FROM review_links WHERE token=$1', [token]);
  const body = `${publicBase()}/review/${token}\nLink expires ${formatLocal(link.rows[0].expires_at as Date, utility.time_zone)}\n${frozenCountsLine(pool, set)}`;
  const subject = `Spanwise review: ${corridorRow.rows[0].name} revision ${set.revision}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO email_outbox (kind, ref_id, to_email, subject, body, state) VALUES ('review_link',$1,$2,$3,$4,'queued') RETURNING id`,
      [token, utility.forester_email, subject, body]
    );
    const emailId = String(res.rows[0].id);
    await client.query('INSERT INTO link_email_state (token, email_id, set_id) VALUES ($1,$2,$3)', [token, Number(emailId), setId]);
    await client.query('COMMIT');
    return { emailId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Review routes, authorised by the token in the path

route('GET', '/api/review/{token}', 'review', async (req) => {
  const pool = db();
  const ctx = req.reviewCtx;
  if (!ctx) throw linkNotFound();
  const set = await loadSet(pool, ctx.setId);
  await corridorModelForSet(ctx.setId);
  const corridorRow = await pool.query('SELECT * FROM corridors WHERE id=$1', [ctx.corridorId]);
  const corridor = await corridorJson(pool, corridorRow.rows[0]);
  const towersRes = await pool.query('SELECT * FROM towers WHERE corridor_id=$1 ORDER BY number', [ctx.corridorId]);
  corridor.tower_count = towersRes.rows.length;
  const model = corridorModel(ctx.corridorId);
  const towers = model
    ? model.centreline.towers.map((t) => ({
        number: t.number,
        label: `T${t.number}`,
        chainage_m: t.chainageM,
        lon_deg: t.lonDeg,
        lat_deg: t.latDeg,
        base_height_m: t.baseHeightM,
        attachment_height_m: model.seed.attachmentHeightM,
      }))
    : towerJson(towersRes.rows);
  const findings = await pool.query('SELECT * FROM findings WHERE set_id=$1 ORDER BY chainage_m, number', [ctx.setId]);
  const tenantRes = await pool.query(
    'SELECT t.name FROM corridors c JOIN utilities u ON u.id=c.utility_id JOIN tenants t ON t.id=u.tenant_id WHERE c.id=$1',
    [ctx.corridorId]
  );
  const contractorName = tenantRes.rows.length > 0 ? tenantRes.rows[0].name : '';
  const link = await pool.query('SELECT * FROM review_links WHERE token=$1', [ctx.token]);
  const read_only = ['accepted', 'disputed', 'closed'].includes(String(set.state));
  return json(200, {
    set: await setJson(pool, set, false),
    corridor,
    towers,
    active_assets: await activeAssetIds(pool, ctx.corridorId),
    coverage: await coverageFor(pool, ctx.corridorId),
    findings: findings.rows.map(findingJson),
    contractor: { name: contractorName },
    expires_at: iso(link.rows[0].expires_at as Date),
    read_only,
  });
});

route('PUT', '/api/review/{token}/findings/{finding_id}/decision', 'review', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const pool = db();
  const ctx = req.reviewCtx;
  if (!ctx) throw linkNotFound();
  const set = await loadSet(pool, ctx.setId);
  const state = String(set.state);
  if (state === 'accepted' || state === 'disputed' || state === 'closed') throw reviewClosed();
  const findingRes = await pool.query('SELECT * FROM findings WHERE id=$1 AND set_id=$2', [req.params.finding_id, ctx.setId]);
  if (findingRes.rows.length === 0) throw notFound('This finding does not exist.');
  const body = parseJsonBody(req.body) as Record<string, JsonValue>;
  const decision = body['decision'];
  const note = body['note'];
  const fields: Record<string, string> = {};
  if (decision !== 'accept' && decision !== 'dispute') {
    fields['decision'] = 'Choose accept or dispute.';
  }
  if (typeof note !== 'string' || note.length > 2000) {
    fields['note'] = 'Comment must be 2,000 characters or fewer.';
  }
  if (decision === 'dispute' && (typeof note !== 'string' || note.trim() === '')) {
    fields['note'] = 'Add a note explaining the dispute.';
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  await pool.query(
    `INSERT INTO decisions (set_id, finding_id, decision, note, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (set_id, finding_id) DO UPDATE SET decision=EXCLUDED.decision, note=EXCLUDED.note, updated_at=now()`,
    [ctx.setId, req.params.finding_id, decision, note ?? '']
  );
  return json(200, { decision: { finding_id: req.params.finding_id, decision, note: note ?? '' } });
});

route('POST', '/api/review/{token}/complete', 'review', async (req) => {
  checkJsonBody(req, JSON_LIMIT);
  const pool = db();
  const ctx = req.reviewCtx;
  if (!ctx) throw linkNotFound();
  const set = await loadSet(pool, ctx.setId);
  const state = String(set.state);
  if (state !== 'submitted' && state !== 'under_review') {
    if (state === 'accepted' || state === 'disputed' || state === 'closed') throw reviewClosed();
    throw reviewClosed();
  }
  const findings = await pool.query('SELECT id FROM findings WHERE set_id=$1', [ctx.setId]);
  const decisions = await pool.query('SELECT finding_id, decision FROM decisions WHERE set_id=$1', [ctx.setId]);
  if (decisions.rows.length !== findings.rows.length) {
    throw validationFailed({ decisions: 'Decide every finding before sending.' });
  }
  const disputed = decisions.rows.filter((d) => d.decision === 'dispute');
  const accepted = decisions.rows.length - disputed.length;
  const newState = disputed.length > 0 ? 'disputed' : 'accepted';
  const client = await pool.connect();
  let emailId = '';
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT state FROM findings_sets WHERE id=$1 FOR UPDATE', [ctx.setId]);
    const curState = String(cur.rows[0].state);
    if (curState !== 'submitted' && curState !== 'under_review') {
      await client.query('ROLLBACK');
      throw reviewClosed();
    }
    await client.query(`UPDATE findings_sets SET state=$2 WHERE id=$1`, [ctx.setId, newState]);
    const submittedBy = await client.query('SELECT submitted_by FROM findings_sets WHERE id=$1', [ctx.setId]);
    const analystRes = await client.query('SELECT email FROM staff WHERE id=$1', [submittedBy.rows[0].submitted_by]);
    const analystEmail = analystRes.rows.length > 0 ? analystRes.rows[0].email : '';
    const corridorRow = await client.query('SELECT * FROM corridors WHERE id=$1', [ctx.corridorId]);
    const revision = (await client.query('SELECT revision FROM findings_sets WHERE id=$1', [ctx.setId])).rows[0].revision;
    const lines = (await client.query(
      `SELECT f.label, d.decision, d.note FROM findings f JOIN decisions d ON d.finding_id=f.id
       WHERE f.set_id=$1 ORDER BY f.chainage_m, f.number`,
      [ctx.setId]
    )).rows.map((r) => r.decision === 'accept' ? `${r.label} accepted` : `${r.label} disputed: ${r.note}`);
    const subject = `Spanwise decision: ${corridorRow.rows[0].name} revision ${revision} ${newState}`;
    const body = lines.join('\n');
    const outboxRes = await client.query(
      `INSERT INTO email_outbox (kind, ref_id, to_email, subject, body, state) VALUES ('decision_summary',$1,$2,$3,$4,'queued') RETURNING id`,
      [ctx.token, analystEmail, subject, body]
    );
    emailId = String(outboxRes.rows[0].id);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* rolled back */ }
    throw err;
  } finally {
    client.release();
  }
  await trySendWithinLimit(emailId);
  const after = await loadSet(pool, ctx.setId);
  return json(200, {
    set: await setJson(pool, after, false),
    summary: { accepted, disputed: disputed.length },
  });
});

