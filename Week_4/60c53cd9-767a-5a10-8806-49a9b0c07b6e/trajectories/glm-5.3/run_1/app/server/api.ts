// The API routes. The error precedence order (API: Error precedence) is applied
// in one place, by the guard sequence every route runs through.
import type { Config } from './config.js';
import type { AppClock } from './clock.js';
import type { Store, Account } from './store/store.js';
import { hashPassword, verifyPassword } from './store/store.js';
import { apiError, FIELD_MSG, MSG, type ApiError, type FieldErrors } from './domain/errors.js';
import { emptyReply, errorReply, jsonReply, parseJson, rawFieldText, rawIntLiteral, type Sender } from './domain/http.js';
import { parseQuery, queryFirst, queryValues, type QueryBag } from './domain/query.js';
import { parseSearchInput, encodeCursor, FACET_VALUES, searchQueryFor, type SearchInput } from './domain/searchInput.js';
import { publicUnit, sharedUnit, unitStatusForCell, runLapseCheck, queueIndexUpdate, parseUnit, parseHold, type HoldRow, type UnitRow } from './domain/units.js';
import { BAND_IDS, FACET_FIELDS, PAGE_SIZE, PRICE_MAX, PRICE_MIN, MAX_SAFE, STACKS, VIEW_VALUES, pricePerM2, pricePerSqft, STATUS_VALUES, type FacetField } from './domain/shared.js';
import { salesOfficeTime } from './clock.js';
import { MediaTokens } from './domain/media.js';
import { S3Client } from './services/s3.js';
import { MeiliClient } from './services/meili.js';
import { randomBytes, createHash } from 'node:crypto';

export interface RouteContext {
  config: Config;
  clock: AppClock;
  store: Store;
  s3: S3Client;
  meili: MeiliClient;
  mediaTokens: MediaTokens;
  indexWorker: { syncNow: () => void };
  photoUploads: Map<string, Promise<unknown>>;
}

export interface ApiRequest {
  method: string;
  path: string;
  query: QueryBag;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  cookies: Record<string, string>;
  remoteAddress: string;
  rawQuery: string;
}

const MAX_JSON = 16384;
const MAX_PHOTO = 5000000;

function header(req: ApiRequest, name: string): string | undefined {
  const value = req.headers[name];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export class Api {
  constructor(private readonly ctx: RouteContext) {}

  // Step 1 of the precedence order: body size and type.
  private bodyGuard(req: ApiRequest, kind: 'json' | 'photo' | 'empty'): { ok: true } | { ok: false; reply: Sender } {
    const limit = kind === 'photo' ? MAX_PHOTO : MAX_JSON;
    if (req.body.length > limit) {
      return { ok: false, reply: errorReply(apiError(413, 'too_large', MSG.tooLarge)) };
    }
    if (kind === 'empty' && req.body.length > 0 && req.method !== 'DELETE') {
      return { ok: true };
    }
    if (kind === 'json') {
      const type = (header(req, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (req.body.length > 0 && type !== 'application/json') {
        return { ok: false, reply: errorReply(apiError(415, 'unsupported_type', MSG.unsupportedType)) };
      }
    }
    if (kind === 'photo') {
      const type = (header(req, 'content-type') ?? '').toLowerCase();
      if (type !== 'image/png' && type !== 'image/jpeg') {
        return { ok: false, reply: errorReply(apiError(415, 'unsupported_image', MSG.unsupportedImage)) };
      }
      const signatureOk = type === 'image/png'
        ? req.body.subarray(0, 8).equals(PNG_SIGNATURE)
        : req.body.subarray(0, 3).equals(JPEG_SIGNATURE);
      if (!signatureOk) {
        return { ok: false, reply: errorReply(apiError(415, 'unsupported_image', MSG.unsupportedImage)) };
      }
    }
    return { ok: true };
  }

  // Step 2: cross-origin writes.
  private crossOriginGuard(req: ApiRequest): { ok: true } | { ok: false; reply: Sender } {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return { ok: true };
    const origin = header(req, 'origin');
    if (origin === undefined) return { ok: true };
    const allowed = new URL(this.ctx.config.publicUrl).origin;
    if (origin === allowed) return { ok: true };
    return { ok: false, reply: errorReply(apiError(403, 'cross_origin', MSG.crossOrigin)) };
  }

  // Step 3: session.
  private async session(req: ApiRequest): Promise<Account | null> {
    const token = req.cookies['hw_session'];
    if (!token) return null;
    return this.ctx.store.sessionAccount(token);
  }

  private unauthenticated(): Sender {
    return errorReply(apiError(401, 'unauthenticated', MSG.unauthenticated));
  }

  private forbidden(): Sender {
    return errorReply(apiError(403, 'forbidden', MSG.forbidden));
  }

  private notFound(): Sender {
    return errorReply(apiError(404, 'not_found', MSG.notFound));
  }

  async handle(req: ApiRequest): Promise<Sender> {
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    if (write) {
      const origin = this.crossOriginGuard(req);
      if (!origin.ok) return origin.reply;
    }

    switch (true) {
      case req.path === '/api/health' && req.method === 'GET':
        return this.health();
      case req.path === '/api/tower' && req.method === 'GET':
        return this.tower();
      case req.path === '/api/search' && req.method === 'GET':
        return this.search(req);
      case req.path.startsWith('/api/units/') && req.method === 'GET' && !req.path.slice('/api/units/'.length).includes('/'):
        return this.unit(req.path.slice('/api/units/'.length));
      case req.path === '/api/accounts' && req.method === 'POST':
        return this.createAccount(req);
      case req.path === '/api/session':
        if (req.method === 'POST') return this.signIn(req);
        if (req.method === 'GET') return this.getSession(req);
        if (req.method === 'DELETE') return this.signOut(req);
        return this.methodNotAllowed();
      case req.path === '/api/holds' && req.method === 'POST':
        return this.placeHold(req);
      case req.path === '/api/holds' && req.method === 'GET':
        return this.listHolds(req);
      case req.path.startsWith('/api/holds/'):
        return this.holdRoute(req);
      case req.path.startsWith('/api/shared/'):
        return this.sharedRoute(req);
      case req.path.startsWith('/api/console/'):
        return this.consoleRoute(req);
      default:
        return this.notFound();
    }
  }

  private methodNotAllowed(): Sender {
    return this.notFound();
  }

  // ---------- public reads ----------

  private async health(): Promise<Sender> {
    const ready = await this.ctx.store.schemaReady();
    if (!ready) return jsonReply(503, { status: 'starting' });
    return jsonReply(200, { status: 'ok' });
  }

  private async tower(): Promise<Sender> {
    const now = this.ctx.clock.nowIso();
    const [cells, pending] = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const units = await tx.query('SELECT * FROM units ORDER BY floor, stack');
      const pendingList = await tx.query('SELECT DISTINCT unit_code FROM pending_index_updates');
      return [units.rows.map(parseUnit), new Set(pendingList.rows.map((r) => String(r.unit_code)))] as const;
    });
    const units = cells.map((unit) => ({
      code: unit.code,
      floor: unit.floor,
      stack: unit.stack,
      status: unitStatusForCell(unit),
      syncing: pending.has(unit.code),
    }));
    const assets = {
      shell: this.mediaLink('models/tower-shell.glb', null, 'model/gltf-binary'),
      plates: Object.fromEntries(BAND_IDS.map((band) => [band, this.mediaLink(`models/plates/${band}.glb`, null, 'model/gltf-binary')])),
      facade: this.mediaLink('textures/facade.png', null, 'image/png'),
      ramp: this.mediaLink('textures/duotone-ramp.png', null, 'image/png'),
    };
    return jsonReply(200, { units, assets });
  }

  private mediaLink(key: string, unitCode: string | null, contentType: string): string {
    const token = this.ctx.mediaTokens.issue(
      { key, unitCode, contentType },
      this.ctx.config.mediaUrlSeconds,
      this.ctx.clock.now(),
    );
    return `/media/${token}`;
  }

  private async unit(code: string): Promise<Sender> {
    if (!/^\d{1,2}[A-H]$/.test(code)) return this.notFound();
    const now = this.ctx.clock.nowIso();
    const result = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const found = await tx.query('SELECT * FROM units WHERE code = $1', [code]);
      const pending = await tx.query('SELECT 1 FROM pending_index_updates WHERE unit_code = $1 LIMIT 1', [code]);
      return { unit: found.rows.length > 0 ? parseUnit(found.rows[0]) : null, syncing: pending.rows.length > 0 };
    });
    if (!result.unit || result.unit.withdrawn || !result.unit.released) return this.notFound();
    const viewUrl = result.unit.viewPhotographed && result.unit.viewPhotoKey
      ? this.mediaLink(result.unit.viewPhotoKey, result.unit.code, contentTypeForKey(result.unit.viewPhotoKey))
      : null;
    return jsonReply(200, { unit: publicUnit(result.unit, result.syncing, viewUrl) });
  }

  private syncingCache = new Set<string>();

  private async search(req: ApiRequest): Promise<Sender> {
    const parsed = parseSearchInput(req.query, null);
    if (!parsed.ok) return errorReply(parsed.error);
    const input: SearchInput = parsed.input;
    const session = await this.session(req);

    // Step 5: the anonymous search rate limit (Business rules).
    if (!session) {
      const limited = await this.searchRateLimited(req.remoteAddress);
      if (limited) return errorReply(apiError(429, 'search_rate_limited', MSG.searchRateLimited(limited.retryAfter), undefined), { 'retry-after': String(limited.retryAfter) });
    }

    const filters = parsed.input.filters;
    const limit = parsed.input.limit;
    const after = parsed.input.after;
    const q = filters.q;

    const now = this.ctx.clock.nowIso();
    const lapsedUnits = await this.ctx.store.transaction(async (tx) => {
      const lapsed = await runLapseCheck(tx, now);
      for (const code of lapsed) await queueIndexUpdate(tx, code, 'lapse');
      return lapsed;
    });

    // Wait up to half a second for lapsed index updates to confirm.
    if (lapsedUnits.length > 0) {
      this.ctx.indexWorker.syncNow();
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        const stillPending = await this.ctx.store.pendingUpdateUnits();
        if (!lapsedUnits.some((code) => stillPending.includes(code))) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const up = await this.ctx.meili.isUp();
    if (!up) return errorReply(apiError(503, 'search_unavailable', MSG.searchUnavailable));

    const filter = searchQueryFor(filters);
    const meili = await this.ctx.meili.search({
      q,
      filter: filter === '' ? undefined : filter,
      facets: ['bedrooms', 'band', 'facing', 'viewTag', 'status'],
      limit: 1000,
      sort: ['price:asc', 'floor:asc', 'stack:asc'],
    });
    if (!meili) return errorReply(apiError(503, 'search_unavailable', MSG.searchUnavailable));

    const indexCodes = meili.hits.map((hit) => String(hit.code));

    const verified = await this.verifyUnits(indexCodes);
    const matching = verified.filter((unit) => unitMatchesText(unit, q));
    const facets = facetCounts(matching);
    const priceStats = matching.length === 0
      ? null
      : { min: Math.min(...matching.map((u) => u.price)), max: Math.max(...matching.map((u) => u.price)) };

    const page = paginate(matching, after, limit);
    const nextCursor = page.length === limit ? encodeCursor(page[page.length - 1].price, page[page.length - 1].code) : null;

    return jsonReply(200, {
      total: matching.length,
      hits: page.map((unit) => publicUnit(unit, this.syncingCache.has(unit.code), unit.viewPhotographed && unit.viewPhotoKey ? this.mediaLink(unit.viewPhotoKey, unit.code, contentTypeForKey(unit.viewPhotoKey)) : null)),
      facets,
      priceStats,
      matchingCodes: matching.map((unit) => unit.code),
      nextCursor,
    });
  }

  private async verifyUnits(codes: string[]): Promise<UnitRow[]> {
    if (codes.length === 0) return [];
    const rows = await this.ctx.store.transaction(async (tx) => {
      const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
      const found = await tx.query(`SELECT * FROM units WHERE code IN (${placeholders}) AND released AND NOT withdrawn`, codes);
      const pending = await tx.query(`SELECT DISTINCT unit_code FROM pending_index_updates`);
      return { units: found.rows.map(parseUnit), pending: new Set(pending.rows.map((r) => String(r.unit_code))) };
    });
    this.syncingCache = rows.pending;
    const ordered = codes
      .map((code) => rows.units.find((u) => u.code === code))
      .filter((u): u is UnitRow => u !== undefined);
    ordered.sort(byPriceThenCode);
    return ordered;
  }

  private async searchRateLimited(address: string): Promise<{ retryAfter: number } | null> {
    const now = this.ctx.clock.nowIso();
    const limit = this.ctx.config.searchRateLimit;
    return this.ctx.store.transaction(async (tx) => {
      await tx.query('DELETE FROM search_rate_limit WHERE at < $1', [new Date(Date.now() - 60000).toISOString()]);
      const counted = await tx.query('SELECT count(*)::int AS c FROM search_rate_limit WHERE client_address = $1', [address]);
      if (Number(counted.rows[0].c) >= limit) {
        const oldest = await tx.query('SELECT min(at) AS m FROM search_rate_limit WHERE client_address = $1', [address]);
        const oldestAt = oldest.rows[0].m ? Date.parse(String(oldest.rows[0].m)) : Date.now();
        const retryAfter = Math.max(1, Math.ceil((oldestAt + 60000 - Date.now()) / 1000));
        return { retryAfter };
      }
      await tx.query('INSERT INTO search_rate_limit (client_address, at) VALUES ($1, $2)', [address, now]);
      return null;
    });
  }

  // ---------- identity ----------

  private async createAccount(req: ApiRequest): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const parsed = parseJson(req.body);
    if (!parsed.ok) return this.unprocessableFields({ name: FIELD_MSG.name, email: FIELD_MSG.email, password: FIELD_MSG.password });
    const body = parsed.json as Record<string, unknown>;
    const fields: FieldErrors = {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 1 || name.length > 80) fields.name = FIELD_MSG.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fields.email = FIELD_MSG.email;
    if (password.length < 10 || password.length > 200) fields.password = FIELD_MSG.password;
    if (Object.keys(fields).length > 0) return this.unprocessableFields(fields);

    // The same status and message whether or not the address exists, and an
    // existing account is never changed (DP-17).
    await this.ctx.store.createAccount(name, email, password);
    return jsonReply(202, { message: 'Your details are in. Sign in to continue.' });
  }

  private unprocessableFields(fields: FieldErrors): Sender {
    return errorReply(apiError(422, 'invalid', FIELD_MSG.base, fields));
  }

  private async signIn(req: ApiRequest): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const parsed = parseJson(req.body);
    if (!parsed.ok) return this.unprocessableFields({ email: FIELD_MSG.email, password: FIELD_MSG.password });
    const body = parsed.json as Record<string, unknown>;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return this.unprocessableFields({ email: FIELD_MSG.email, password: FIELD_MSG.password });
    }
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    if (email.length === 0 || password.length === 0) {
      return this.unprocessableFields({ email: FIELD_MSG.email, password: FIELD_MSG.password });
    }
    const account = await this.ctx.store.accountByEmail(email);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      return errorReply(apiError(401, 'sign_in_failed', MSG.signInFailed));
    }
    const token = await this.ctx.store.createSession(account.id);
    const reply = jsonReply(200, { account: { email: account.email, name: account.name, role: account.role } });
    reply.headers['set-cookie'] = `hw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${this.ctx.config.sessionSeconds}`;
    return reply;
  }

  private async getSession(req: ApiRequest): Promise<Sender> {
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    return jsonReply(200, { account: { email: account.email, name: account.name, role: account.role } });
  }

  private async signOut(req: ApiRequest): Promise<Sender> {
    const token = req.cookies['hw_session'];
    if (token) await this.ctx.store.deleteSession(token);
    const reply = emptyReply(204);
    reply.headers['set-cookie'] = 'hw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
    return reply;
  }

  // ---------- holds ----------

  private async listHolds(req: ApiRequest): Promise<Sender> {
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'buyer') return this.forbidden();
    const holds = await this.ctx.store.holdsForAccount(account.id);
    return jsonReply(200, { holds: holds.map((hold) => this.holdProjection(hold)) });
  }

  private async holdRoute(req: ApiRequest): Promise<Sender> {
    const rest = req.path.slice('/api/holds/'.length);
    if (req.method === 'GET' && /^[0-9a-f-]{36}$/.test(rest)) return this.getHold(req, rest);
    if (req.method === 'POST' && /^[0-9a-f-]{36}\/release$/.test(rest)) return this.releaseHold(req, rest.slice(0, 36));
    if (req.method === 'POST' && /^[0-9a-f-]{36}\/share$/.test(rest)) return this.createShare(req, rest.slice(0, 36));
    if (req.method === 'DELETE' && /^[0-9a-f-]{36}\/share$/.test(rest)) return this.revokeShare(req, rest.slice(0, 36));
    return this.notFound();
  }

  private async holdFor(account: Account, id: string): Promise<HoldRow | null> {
    // Another account's hold id answers exactly like one that never existed
    // (DP-30).
    return this.ctx.store.holdById(id, account.id);
  }

  private async getHold(req: ApiRequest, id: string): Promise<Sender> {
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'buyer') return this.forbidden();
    const hold = await this.holdFor(account, id);
    if (!hold) return this.notFound();
    return jsonReply(200, { hold: this.holdProjection(hold) });
  }

  private holdProjection(hold: HoldRow, shareUrl: string | null = null): Record<string, unknown> {
    return {
      id: hold.id,
      unitCode: hold.unitCode,
      status: hold.status,
      endedBy: hold.endedBy,
      quotedPrice: hold.quotedPrice,
      priceVersion: hold.priceVersion,
      createdAt: hold.createdAt,
      endsAt: hold.endsAt,
      endedAt: hold.endedAt,
      shareUrl: shareUrl ?? (hold.status === 'active' ? this.liveShareToken(hold.id) : null),
    };
  }

  private liveShareTokens = new Map<string, string>();

  private liveShareToken(holdId: string): string | null {
    return this.liveShareTokens.get(holdId) ?? null;
  }

  private async releaseHold(req: ApiRequest, id: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'buyer') return this.forbidden();
    const now = this.ctx.clock.nowIso();
    const result = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const found = await tx.query('SELECT * FROM holds WHERE id = $1 AND account_id = $2', [id, account.id]);
      if (found.rows.length === 0) return { kind: 'not_found' as const };
      const hold = parseHold(found.rows[0]);
      if (hold.status !== 'active') return { kind: 'hold_ended' as const };
      await tx.query(`UPDATE holds SET status = 'released', ended_by = 'buyer', ended_at = $1 WHERE id = $2 AND status = 'active'`, [now, id]);
      await tx.query(`UPDATE units SET status = 'available' WHERE code = $1 AND status = 'held'`, [hold.unitCode]);
      await tx.query('DELETE FROM share_tokens WHERE hold_id = $1', [id]);
      await queueIndexUpdate(tx, hold.unitCode, 'release');
      return { kind: 'ok' as const, holdId: id };
    });
    if (result.kind === 'not_found') return this.notFound();
    if (result.kind === 'hold_ended') return errorReply(apiError(409, 'hold_ended', MSG.holdEnded));
    this.liveShareTokens.delete(id);
    this.ctx.indexWorker.syncNow();
    const hold = await this.holdFor(account, id);
    if (!hold) return this.notFound();
    return jsonReply(200, { hold: this.holdProjection(hold) });
  }

  private async createShare(req: ApiRequest, id: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'buyer') return this.forbidden();
    const now = this.ctx.clock.nowIso();
    const result = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const found = await tx.query('SELECT * FROM holds WHERE id = $1 AND account_id = $2', [id, account.id]);
      if (found.rows.length === 0) return { kind: 'not_found' as const };
      const hold = parseHold(found.rows[0]);
      if (hold.status !== 'active') return { kind: 'hold_ended' as const };
      const token = randomBytes(24).toString('base64url');
      await tx.query('DELETE FROM share_tokens WHERE hold_id = $1', [id]);
      await tx.query('INSERT INTO share_tokens (token, hold_id) VALUES ($1, $2)', [token, id]);
      return { kind: 'ok' as const, token };
    });
    if (result.kind === 'not_found') return this.notFound();
    if (result.kind === 'hold_ended') return errorReply(apiError(409, 'hold_ended', MSG.holdEnded));
    this.liveShareTokens.set(id, `/shared/${result.token}`);
    return jsonReply(201, { shareUrl: `/shared/${result.token}` });
  }

  private async revokeShare(req: ApiRequest, id: string): Promise<Sender> {
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'buyer') return this.forbidden();
    const exists = await this.ctx.store.holdById(id, account.id);
    if (!exists) return this.notFound();
    await this.ctx.store.transaction(async (tx) => {
      await tx.query('DELETE FROM share_tokens WHERE hold_id = $1', [id]);
    });
    this.liveShareTokens.delete(id);
    return emptyReply(204);
  }

  // Placing a hold runs the full precedence order, including idempotency before
  // the attempt counter, and every conflict check inside one transaction so the
  // database decides the race (DP-20 through DP-27, DP-77).
  private async placeHold(req: ApiRequest): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const account = await this.session(req);
    if (!account) return this.unauthenticated();

    const raw = req.body.toString('utf8');
    const parsed = parseJson(req.body);
    if (!parsed.ok) return this.unprocessableFields({ unitCode: FIELD_MSG.unitCode, priceVersion: FIELD_MSG.priceVersion });
    const body = parsed.json as Record<string, unknown>;

    const idempotencyKey = header(req, 'idempotency-key');
    if (idempotencyKey !== undefined) {
      if (idempotencyKey.length === 0 || idempotencyKey.length > 100 || !/^[\x21-\x7e]+$/.test(idempotencyKey)) {
        return this.unprocessableFields({ idempotencyKey: FIELD_MSG.idempotencyKey });
      }
    }

    // unitCode and priceVersion shape checks, judged on the raw token for the
    // integer (Business rules: Prices on the wire).
    const unitCode = typeof body.unitCode === 'string' ? body.unitCode : undefined;
    if (unitCode === undefined) return this.unprocessableFields({ unitCode: FIELD_MSG.unitCode });
    const rawVersion = rawFieldText(raw, 'priceVersion');
    const versionText = typeof body.priceVersion === 'number' ? rawVersion ?? String(body.priceVersion) : null;
    if (versionText === null || !rawIntLiteral(versionText)) {
      return this.unprocessableFields({ priceVersion: FIELD_MSG.priceVersion });
    }
    const priceVersion = Number(versionText);
    if (priceVersion < 1) return this.unprocessableFields({ priceVersion: FIELD_MSG.priceVersion });

    // Step 4: a previously used Idempotency-Key replays or refuses, before rate
    // limits and attempts.
    if (idempotencyKey !== undefined) {
      const stored = await this.ctx.store.transaction(async (tx) => {
        const found = await tx.query('SELECT * FROM idempotency_keys WHERE account_id = $1 AND key = $2', [account.id, idempotencyKey]);
        return found.rows.length > 0 ? found.rows[0] : null;
      });
      if (stored) {
        const sameBody = String(stored.unit_code) === unitCode && Number(stored.price_version) === priceVersion;
        if (!sameBody) {
          return errorReply(apiError(409, 'idempotency_key_reused', MSG.idempotencyKeyReused));
        }
        return jsonReply(Number(stored.status), JSON.parse(String(stored.body)) as Record<string, unknown>);
      }
    }

    // Step 5: the hold attempt window (Business rules).
    const attempt = await this.countAttempt(account.id);
    if (attempt.limited) {
      return errorReply(
        apiError(429, 'hold_attempts', MSG.holdAttempts(attempt.retryAfter), undefined),
        { 'retry-after': String(attempt.retryAfter) },
      );
    }

    // Step 6: wrong role.
    if (account.role !== 'buyer') return this.forbidden();

    const now = this.ctx.clock.nowIso();
    const outcome = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);

      // Step 7: unknown, unreleased or withdrawn unit.
      const unitRow = await tx.query('SELECT * FROM units WHERE code = $1', [unitCode]);
      if (unitRow.rows.length === 0) return { code: 404 as const };
      const unit = parseUnit(unitRow.rows[0]);
      if (unit.withdrawn) return { code: 404 as const };
      if (!unit.released) return { code: 404 as const };

      // Step 9: state conflicts, in the published order.
      const ownActive = await tx.query(`SELECT 1 FROM holds WHERE account_id = $1 AND status = 'active' FOR UPDATE`, [account.id]);
      if (ownActive.rows.length > 0) return { code: 409 as const, kind: 'hold_limit' };
      const unitState = await tx.query(`SELECT status, price_version FROM units WHERE code = $1 FOR UPDATE`, [unitCode]);
      const status = String(unitState.rows[0].status);
      const currentVersion = Number(unitState.rows[0].price_version);
      if (status === 'reserved') return { code: 409 as const, kind: 'unit_reserved' };
      if (status !== 'available') return { code: 409 as const, kind: 'unit_unavailable' };

      const cooldown = await tx.query(
        `SELECT ended_at FROM holds WHERE account_id = $1 AND unit_code = $2 AND ended_by IN ('buyer','lapse') ORDER BY ended_at DESC LIMIT 1`,
        [account.id, unitCode],
      );
      if (cooldown.rows.length > 0) {
        const endedAt = Date.parse(String(cooldown.rows[0].ended_at));
        const until = endedAt + this.ctx.config.holdCooldownSeconds * 1000;
        if (Date.parse(now) < until) {
          return { code: 409 as const, kind: 'hold_cooldown', until };
        }
      }
      if (priceVersion !== currentVersion) {
        return { code: 409 as const, kind: 'price_changed', price: unit.price, priceVersion: currentVersion };
      }

      const holdId = crypto.randomUUID();
      const endsAt = new Date(Date.parse(now) + this.ctx.config.holdSeconds * 1000).toISOString();
      const inserted = await tx.query(
        `INSERT INTO holds (id, unit_code, account_id, status, ended_by, quoted_price, price_version, created_at, ends_at, ended_at)
         VALUES ($1, $2, $3, 'active', NULL, $4, $5, $6, $7, NULL)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [holdId, unitCode, account.id, String(unit.price), String(priceVersion), now, endsAt],
      );
      if (inserted.rows.length === 0) {
        // Lost the race: decide which conflict the loser sees.
        const again = await tx.query(`SELECT status FROM units WHERE code = $1`, [unitCode]);
        return { code: 409 as const, kind: String(again.rows[0].status) === 'reserved' ? 'unit_reserved' : 'unit_unavailable' };
      }
      await tx.query(`UPDATE units SET status = 'held' WHERE code = $1 AND status = 'available'`, [unitCode]);
      await queueIndexUpdate(tx, unitCode, 'hold');
      return { code: 201 as const, hold: parseHold(inserted.rows[0]) };
    });

    let reply: Sender;
    if (outcome.code === 201) {
      this.ctx.indexWorker.syncNow();
      reply = jsonReply(201, { hold: this.holdProjection(outcome.hold) });
    } else if (outcome.code === 404) {
      reply = this.notFound();
    } else if (outcome.kind === 'hold_limit') {
      reply = errorReply(apiError(409, 'hold_limit', MSG.holdLimit));
    } else if (outcome.kind === 'unit_reserved') {
      reply = errorReply(apiError(409, 'unit_reserved', MSG.unitReserved));
    } else if (outcome.kind === 'unit_unavailable') {
      reply = errorReply(apiError(409, 'unit_unavailable', MSG.unitUnavailable));
    } else if (outcome.kind === 'hold_cooldown') {
      const when = salesOfficeTime(outcome.until ?? 0, this.ctx.config.salesOfficeTz);
      reply = errorReply(apiError(409, 'hold_cooldown', MSG.holdCooldown(when)));
    } else if (outcome.kind === 'price_changed') {
      reply = errorReply(apiError(409, 'price_changed', MSG.priceChanged));
    } else {
      reply = this.notFound();
    }

    // Step 4 storage: only requests that reached this point store a key.
    if (idempotencyKey !== undefined) {
      await this.ctx.store.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO idempotency_keys (account_id, key, unit_code, price_version, status, body)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (account_id, key) DO NOTHING`,
          [account.id, idempotencyKey, unitCode, String(priceVersion), String(reply.status), reply.body.toString('utf8')],
        );
      });
    }
    return reply;
  }

  private async countAttempt(accountId: string): Promise<{ limited: false } | { limited: true; retryAfter: number }> {
    const now = Date.now();
    const windowMs = this.ctx.config.holdAttemptWindowSeconds * 1000;
    return this.ctx.store.transaction(async (tx) => {
      await tx.query('DELETE FROM hold_attempts WHERE at < $1', [new Date(now - windowMs).toISOString()]);
      const counted = await tx.query('SELECT at FROM hold_attempts WHERE account_id = $1 ORDER BY at', [accountId]);
      if (counted.rows.length >= 3) {
        const oldest = Date.parse(String(counted.rows[0].at));
        return { limited: true, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
      }
      await tx.query('INSERT INTO hold_attempts (account_id, at) VALUES ($1, $2)', [accountId, new Date(now).toISOString()]);
      return { limited: false } as const;
    });
  }

  // ---------- shared links ----------

  private async sharedRoute(req: ApiRequest): Promise<Sender> {
    const token = req.path.slice('/api/shared/'.length);
    if (req.method !== 'GET') {
      return errorReply(apiError(405, 'read_only', MSG.readOnly));
    }
    if (token.includes('/')) return this.notFound();
    const now = this.ctx.clock.nowIso();
    const result = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const found = await tx.query(
        `SELECT h.*, s.token FROM share_tokens s JOIN holds h ON h.id = s.hold_id WHERE s.token = $1`,
        [token],
      );
      if (found.rows.length === 0) return null;
      const hold = parseHold(found.rows[0]);
      if (hold.status !== 'active') return null;
      const unitRow = await tx.query('SELECT * FROM units WHERE code = $1', [hold.unitCode]);
      if (unitRow.rows.length === 0) return null;
      const unit = parseUnit(unitRow.rows[0]);
      if (unit.withdrawn || !unit.released) return null;
      return { hold, unit };
    });
    if (!result) return this.notFound();
    const viewUrl = result.unit.viewPhotographed && result.unit.viewPhotoKey
      ? this.mediaLink(result.unit.viewPhotoKey, result.unit.code, contentTypeForKey(result.unit.viewPhotoKey))
      : null;
    return jsonReply(
      200,
      { unit: sharedUnit(result.unit, viewUrl), endsAt: result.hold.endsAt },
      { 'cache-control': 'no-store' },
    );
  }

  // ---------- coordinator console ----------

  private async consoleRoute(req: ApiRequest): Promise<Sender> {
    const rest = req.path.slice('/api/console/'.length);
    const account = await this.session(req);
    if (!account) return this.unauthenticated();
    if (account.role !== 'coordinator') return this.forbidden();

    if (req.method === 'GET' && rest === 'units') return this.consoleUnits();
    if (req.method === 'GET' && rest === 'holds') return this.consoleHolds();
    if (rest.startsWith('units/')) {
      const tail = rest.slice('units/'.length);
      const parts = tail.split('/');
      const code = parts[0];
      const action = parts[1];
      if (req.method === 'GET' && code && action === 'prices') return this.consoleUnitPrices(req, code);
      if (req.method === 'PUT' && action === 'price') return this.consoleSavePrice(req, code);
      if (req.method === 'PUT' && action === 'view-photo') return this.consoleUploadPhoto(req, code);
      if (req.method === 'POST' && action === 'withdraw') return this.consoleWithdraw(req, code);
    }
    if (rest.startsWith('bands/') && rest.endsWith('/release') && req.method === 'POST') {
      return this.consoleReleaseBand(req, rest.slice('bands/'.length, -'/release'.length));
    }
    if (rest.startsWith('holds/') && rest.endsWith('/convert') && req.method === 'POST') {
      return this.consoleConvert(req, rest.slice('holds/'.length, -'/convert'.length));
    }
    return this.notFound();
  }

  private async consoleUnits(): Promise<Sender> {
    const now = this.ctx.clock.nowIso();
    const units = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const all = await tx.query(`
        SELECT u.*, h.id AS hold_id, h.buyer_email, h.buyer_name, h.quoted_price AS hold_quoted_price,
               h.created_at AS hold_created_at, h.ends_at AS hold_ends_at
        FROM units u
        LEFT JOIN (
          SELECT ho.id, ho.unit_code, ho.quoted_price, ho.created_at, ho.ends_at, a.email AS buyer_email, a.name AS buyer_name
          FROM holds ho JOIN accounts a ON a.id = ho.account_id WHERE ho.status = 'active'
        ) h ON h.unit_code = u.code
        ORDER BY u.floor, u.stack
      `);
      return all.rows;
    });
    return jsonReply(200, {
      units: units.map((row) => {
        const unit = parseUnit(row);
        return {
          code: unit.code,
          floor: unit.floor,
          stack: unit.stack,
          band: unit.band,
          status: unitStatusForCell(unit),
          price: unit.price,
          priceVersion: unit.priceVersion,
          viewPhotographed: unit.viewPhotographed,
          viewPhoto: unit.viewPhotoKey ? { key: unit.viewPhotoKey, size: unit.viewPhotoSize, checksum: unit.viewPhotoChecksum } : null,
          hold: row.hold_id
            ? {
                id: String(row.hold_id),
                buyerEmail: String(row.buyer_email),
                quotedPrice: Number(row.hold_quoted_price),
                createdAt: String(row.hold_created_at),
                endsAt: String(row.hold_ends_at),
              }
            : null,
        };
      }),
    });
  }

  private async consoleHolds(): Promise<Sender> {
    const now = this.ctx.clock.nowIso();
    const holds = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const rows = await tx.query(`
        SELECT h.id, h.unit_code, h.quoted_price, h.price_version, h.created_at, h.ends_at, a.email, a.name
        FROM holds h JOIN accounts a ON a.id = h.account_id
        WHERE h.status = 'active'
        ORDER BY h.created_at DESC
      `);
      return rows.rows;
    });
    return jsonReply(200, {
      holds: holds.map((row) => ({
        id: String(row.id),
        unitCode: String(row.unit_code),
        buyerEmail: String(row.email),
        buyerName: String(row.name),
        quotedPrice: Number(row.quoted_price),
        priceVersion: Number(row.price_version),
        createdAt: String(row.created_at),
        endsAt: String(row.ends_at),
      })),
    });
  }

  private async consoleUnitPrices(req: ApiRequest, code: string): Promise<Sender> {
    if (!/^\d{1,2}[A-H]$/.test(code)) return this.notFound();
    const unit = await this.ctx.store.unitByCode(code);
    if (!unit) return this.notFound();
    const versions = await this.ctx.store.transaction(async (tx) => {
      const rows = await tx.query(
        'SELECT version, price, set_by, set_at FROM price_versions WHERE unit_code = $1 ORDER BY version DESC',
        [code],
      );
      return rows.rows.map((row) => ({
        version: Number(row.version),
        price: Number(row.price),
        setBy: String(row.set_by),
        setAt: String(row.set_at),
      }));
    });
    return jsonReply(200, { versions });
  }

  private async consoleSavePrice(req: ApiRequest, code: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    if (!/^\d{1,2}[A-H]$/.test(code)) return this.notFound();
    const account = await this.session(req);
    if (!account || account.role !== 'coordinator') return this.forbidden();
    const raw = req.body.toString('utf8');
    const parsed = parseJson(req.body);
    if (!parsed.ok) return this.unprocessableFields({ price: FIELD_MSG.consolePrice, expectedVersion: FIELD_MSG.expectedVersion });
    const body = parsed.json as Record<string, unknown>;
    const fields: FieldErrors = {};
    const rawPrice = rawFieldText(raw, 'price');
    if (typeof body.price !== 'number' || rawPrice === null || !rawIntLiteral(rawPrice)) {
      fields.price = FIELD_MSG.consolePrice;
    } else if (Number(rawPrice) < PRICE_MIN || Number(rawPrice) > PRICE_MAX) {
      fields.price = FIELD_MSG.consolePrice;
    }
    const rawVersion = rawFieldText(raw, 'expectedVersion');
    if (typeof body.expectedVersion !== 'number' || rawVersion === null || !rawIntLiteral(rawVersion) || Number(rawVersion) < 1) {
      fields.expectedVersion = FIELD_MSG.expectedVersion;
    }
    if (Object.keys(fields).length > 0) return this.unprocessableFields(fields);
    const price = Number(rawPrice);
    const expectedVersion = Number(rawVersion);

    const now = this.ctx.clock.nowIso();
    const outcome = await this.ctx.store.transaction(async (tx) => {
      const unitRow = await tx.query(`SELECT * FROM units WHERE code = $1 FOR UPDATE`, [code]);
      if (unitRow.rows.length === 0) return { code: 'not_found' as const };
      const unit = parseUnit(unitRow.rows[0]);
      if (unit.withdrawn) return { code: 'unit_withdrawn' as const };
      if (unit.priceVersion !== expectedVersion) return { code: 'stale' as const };
      const newVersion = expectedVersion + 1;
      await tx.query('UPDATE units SET price = $1, price_version = $2 WHERE code = $3', [String(price), String(newVersion), code]);
      await tx.query(
        'INSERT INTO price_versions (unit_code, version, price, set_by, set_at) VALUES ($1, $2, $3, $4, $5)',
        [code, String(newVersion), String(price), account.name, now],
      );
      await queueIndexUpdate(tx, code, 'price');
      return { code: 'ok' as const, version: newVersion };
    });
    if (outcome.code === 'not_found') return this.notFound();
    if (outcome.code === 'unit_withdrawn') return errorReply(apiError(409, 'unit_withdrawn', MSG.unitWithdrawn));
    if (outcome.code === 'stale') return errorReply(apiError(412, 'stale_price', MSG.stalePrice));
    this.ctx.indexWorker.syncNow();
    return jsonReply(200, { code, price, priceVersion: outcome.version });
  }

  private async consoleUploadPhoto(req: ApiRequest, code: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'photo');
    if (!guard.ok) return guard.reply;
    if (!/^\d{1,2}[A-H]$/.test(code)) return this.notFound();
    const account = await this.session(req);
    if (!account || account.role !== 'coordinator') return this.forbidden();
    const body = req.body;

    const size = decodeImageSize(body);
    if (size === null) {
      return this.unprocessableFields({ photo: FIELD_MSG.photoCorrupt });
    }
    if (size.width < 1024 || size.height < 512) {
      return this.unprocessableFields({ photo: FIELD_MSG.photoSmall });
    }

    const unit = await this.ctx.store.unitByCode(code);
    if (!unit || unit.withdrawn) return errorReply(apiError(409, 'unit_withdrawn', MSG.unitWithdrawn));
    if (!unit.released) return this.notFound();

    // One upload per unit at a time (DP-69).
    const existing = this.ctx.photoUploads.get(code);
    if (existing) return errorReply(apiError(409, 'upload_in_progress', MSG.uploadInProgress));

    const contentType = (header(req, 'content-type') ?? '').toLowerCase();
    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    const checksum = createHash('md5').update(body).digest('hex');
    const key = `views/units/${code}/${checksum}.${extension}`;

    const upload = (async () => {
      try {
        await this.ctx.s3.putObject(key, body, contentType);
      } catch {
        return { code: 'storage_unavailable' as const };
      }
      const head = await this.ctx.s3.headObject(key).catch(() => null);
      if (!head || head.size !== body.length || head.etag !== checksum) {
        return { code: 'upload_unconfirmed' as const };
      }
      const now = this.ctx.clock.nowIso();
      await this.ctx.store.transaction(async (tx) => {
        await tx.query(
          'UPDATE units SET view_photographed = true, view_photo_key = $1, view_photo_size = $2, view_photo_checksum = $3 WHERE code = $4',
          [key, String(body.length), checksum, code],
        );
        await queueIndexUpdate(tx, code, 'photo');
      });
      return { code: 'ok' as const, key, size: body.length, checksum };
    })();

    this.ctx.photoUploads.set(code, upload);
    const result = await upload;
    this.ctx.photoUploads.delete(code);
    if (result.code === 'storage_unavailable') {
      return errorReply(apiError(503, 'storage_unavailable', MSG.storageUnavailable));
    }
    if (result.code === 'upload_unconfirmed') {
      return errorReply(apiError(502, 'upload_unconfirmed', MSG.uploadUnconfirmed));
    }
    this.ctx.indexWorker.syncNow();
    return jsonReply(200, {
      code,
      viewPhotographed: true,
      viewPhoto: { key: result.key, size: result.size, checksum: result.checksum },
    });
  }

  private async consoleWithdraw(req: ApiRequest, code: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    if (!/^\d{1,2}[A-H]$/.test(code)) return this.notFound();
    const account = await this.session(req);
    if (!account || account.role !== 'coordinator') return this.forbidden();
    const now = this.ctx.clock.nowIso();
    const outcome = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const unitRow = await tx.query(`SELECT * FROM units WHERE code = $1 FOR UPDATE`, [code]);
      if (unitRow.rows.length === 0) return { code: 'not_found' as const };
      const unit = parseUnit(unitRow.rows[0]);
      if (unit.withdrawn) return { code: 'unit_withdrawn' as const };
      if (!unit.released) return { code: 'not_released' as const };
      await tx.query(`UPDATE units SET withdrawn = true, status = 'withdrawn' WHERE code = $1`, [code]);
      const active = await tx.query(`SELECT id FROM holds WHERE unit_code = $1 AND status = 'active'`, [code]);
      for (const holdRow of active.rows) {
        await tx.query(
          `UPDATE holds SET status = 'released', ended_by = 'withdrawal', ended_at = $1 WHERE id = $2 AND status = 'active'`,
          [now, String(holdRow.id)],
        );
      }
      await tx.query('DELETE FROM share_tokens WHERE hold_id IN (SELECT id FROM holds WHERE unit_code = $1)', [code]);
      await queueIndexUpdate(tx, code, 'withdrawal');
      return { code: 'ok' as const };
    });
    if (outcome.code === 'not_found') return this.notFound();
    if (outcome.code === 'unit_withdrawn') return errorReply(apiError(409, 'unit_withdrawn', MSG.unitWithdrawn));
    if (outcome.code === 'not_released') return errorReply(apiError(409, 'not_released', MSG.notReleased));
    this.ctx.indexWorker.syncNow();
    return jsonReply(200, { code, status: 'withdrawn' });
  }

  private async consoleReleaseBand(req: ApiRequest, band: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const account = await this.session(req);
    if (!account || account.role !== 'coordinator') return this.forbidden();
    if (!(BAND_IDS as readonly string[]).includes(band)) return this.notFound();
    const now = this.ctx.clock.nowIso();
    const outcome = await this.ctx.store.transaction(async (tx) => {
      const released = await tx.query(
        `UPDATE units SET released = true, status = 'available' WHERE band = $1 AND NOT released RETURNING code`,
        [band],
      );
      if (released.rows.length === 0) return { code: 'already_released' as const };
      for (const row of released.rows) {
        await queueIndexUpdate(tx, String(row.code), 'band_release');
      }
      return { code: 'ok' as const, count: released.rows.length };
    });
    if (outcome.code === 'already_released') {
      return errorReply(apiError(409, 'already_released', MSG.alreadyReleased));
    }
    this.ctx.indexWorker.syncNow();
    // Wait up to five seconds for the index to confirm, as Business rules say.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const pending = await this.ctx.store.pendingUpdateUnits();
      if (pending.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return jsonReply(200, { band, releasedUnits: outcome.count });
  }

  private async consoleConvert(req: ApiRequest, holdId: string): Promise<Sender> {
    const guard = this.bodyGuard(req, 'json');
    if (!guard.ok) return guard.reply;
    const account = await this.session(req);
    if (!account || account.role !== 'coordinator') return this.forbidden();
    const now = this.ctx.clock.nowIso();
    const outcome = await this.ctx.store.transaction(async (tx) => {
      await runLapseCheck(tx, now);
      const found = await tx.query(`SELECT * FROM holds WHERE id = $1 FOR UPDATE`, [holdId]);
      if (found.rows.length === 0) return { code: 'not_found' as const };
      const hold = parseHold(found.rows[0]);
      if (hold.status !== 'active') return { code: 'hold_ended' as const };
      const unitRow = await tx.query(`SELECT * FROM units WHERE code = $1 FOR UPDATE`, [hold.unitCode]);
      const unit = parseUnit(unitRow.rows[0]);
      if (unit.withdrawn) return { code: 'hold_ended' as const };
      await tx.query(
        `UPDATE holds SET status = 'converted', ended_by = 'conversion', ended_at = $1 WHERE id = $2 AND status = 'active'`,
        [now, holdId],
      );
      await tx.query(`UPDATE units SET status = 'reserved' WHERE code = $1`, [hold.unitCode]);
      await tx.query('DELETE FROM share_tokens WHERE hold_id = $1', [holdId]);
      await queueIndexUpdate(tx, hold.unitCode, 'conversion');
      return { code: 'ok' as const };
    });
    if (outcome.code === 'not_found') return this.notFound();
    if (outcome.code === 'hold_ended') return errorReply(apiError(409, 'hold_ended', MSG.holdEnded));
    this.ctx.indexWorker.syncNow();
    this.liveShareTokens.delete(holdId);
    const hold = await this.ctx.store.transaction(async (tx) => {
      const found = await tx.query('SELECT * FROM holds WHERE id = $1', [holdId]);
      return found.rows.length > 0 ? parseHold(found.rows[0]) : null;
    });
    if (!hold) return this.notFound();
    return jsonReply(200, { hold: this.holdProjection(hold) });
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// Decodes a PNG or JPEG header to its pixel size, returning null when the bytes
// cannot be decoded (Business rules: View photographs).
export function decodeImageSize(body: Buffer): { width: number; height: number } | null {
  if (body.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (body.length < 33) return null;
    if (body.readUInt32BE(12) !== 0x49484452) return null;
    return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
  }
  if (body.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    let position = 2;
    while (position + 9 < body.length) {
      if (body[position] !== 0xff) return null;
      const marker = body[position + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 || marker === 0xc9 || marker === 0xca || marker === 0xcb) {
        const height = body.readUInt16BE(position + 5);
        const width = body.readUInt16BE(position + 7);
        return { width, height };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        position += 2;
        continue;
      }
      const length = body.readUInt16BE(position + 2);
      if (length < 2) return null;
      position += 2 + length;
    }
    return null;
  }
  return null;
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith('.glb')) return 'model/gltf-binary';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function unitMatchesText(unit: UnitRow, q: string): boolean {
  if (q === '') return true;
  const words = q.split(/\s+/).filter((word) => word.length > 0);
  const haystacks = [unit.code, unit.facing, unit.viewTag, unit.band];
  return words.every((word) => {
    const lower = word.toLowerCase();
    return haystacks.some((field) => field.toLowerCase().split(/\s+/).some((part) => part.startsWith(lower)));
  });
}

function facetCounts(units: UnitRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const field of FACET_FIELDS) {
    const values: Record<string, number> = {};
    for (const value of FACET_VALUES[field]) values[value] = 0;
    for (const unit of units) {
      const value = facetValueOf(unit, field);
      if (value !== null && value in values) values[value] += 1;
    }
    out[field] = values;
  }
  return out;
}

function facetValueOf(unit: UnitRow, field: FacetField): string | null {
  switch (field) {
    case 'bedrooms': return String(unit.bedrooms);
    case 'band': return unit.band;
    case 'facing': return unit.facing;
    case 'view': return unit.viewTag;
    case 'status': return unit.status === 'held' || unit.status === 'reserved' ? unit.status : 'available';
  }
}

function byPriceThenCode(a: UnitRow, b: UnitRow): number {
  if (a.price !== b.price) return a.price - b.price;
  return compareCodes(a.code, b.code);
}

function compareCodes(a: string, b: string): number {
  const fa = Number(a.slice(0, -1));
  const fb = Number(b.slice(0, -1));
  if (fa !== fb) return fa - fb;
  return a.slice(-1) < b.slice(-1) ? -1 : a.slice(-1) === b.slice(-1) ? 0 : 1;
}

function paginate(units: UnitRow[], after: { price: number; code: string } | null, limit: number): UnitRow[] {
  if (!after) return units.slice(0, limit);
  return units.filter((unit) => {
    if (unit.price !== after.price) return unit.price > after.price;
    return compareCodes(unit.code, after.code) > 0;
  }).slice(0, limit);
}
