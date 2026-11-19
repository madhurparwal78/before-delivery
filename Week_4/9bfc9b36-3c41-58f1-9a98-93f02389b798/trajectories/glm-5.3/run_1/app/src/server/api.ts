import type { Request, Response } from 'express';
import { Refusal } from '../domain/failure.ts';
import { words } from '../domain/words.ts';
import { fill } from '../domain/template.ts';
import type { Ctx } from './boot.ts';
import type { Caller } from './caller.ts';
import { Invalid, json, type Route } from './api-core.ts';
import { unauthenticated } from './auth.ts';
import { inTransaction, type DbClient } from './db.ts';
import { countChars, cursorFilter, cursorToken, normalizeEmail, opaqueId, parseInstant, sha256Hex, validEmailShape, validLot } from './util.ts';
import { mm2ToFt2, mm2ToM2, mmToInch2 } from '../domain/units.ts';
import { crosscutPanels, sailArea, type PanelShape } from '../domain/sail.ts';
import { firstFit, placedOutline } from '../domain/nesting.ts';
import { parseValueIn, inchesAsSubmitted } from '../domain/inches.ts';
import { outlinesOverlap } from '../domain/geometry.ts';
import { renderCutSheet } from './cutsheet.ts';
import { apiTs as viewTs, boatView, claimView, freeMm, stockView, type ClaimRow, type StockRow } from './views.ts';
import { mulHalf } from '../domain/int.ts';

export const routes: Route[] = [];

function route(method: string, path: string, roles: Route['roles'], handler: Route['handler']): void {
  routes.push({ method, path, roles, handler });
}

const ALL: Route['roles'] = ['sailmaker', 'loft-hand', 'yacht-owner'];
const SAILMAKER: Route['roles'] = ['sailmaker'];
const SAILMAKER_LOFT_HAND: Route['roles'] = ['sailmaker', 'loft-hand'];

/** Match an express-style path with :params. */
export function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    const parts = r.path.split('/').filter(Boolean);
    const want = path.split('/').filter(Boolean);
    if (r.method !== method || parts.length !== want.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(want[i]!);
      else if (p !== want[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// helpers over stored records

async function currentRuleset(db: DbClient): Promise<{ version: number; seam_overlap_mm: number; roach_permille: number; tolerance_mm: number; min_offcut_width_mm: number; min_offcut_length_mm: number }> {
  const rows = await db.query<{ version: number; seam_overlap_mm: number; roach_permille: number; tolerance_mm: number; min_offcut_width_mm: number; min_offcut_length_mm: number }>(
    `SELECT version, seam_overlap_mm, roach_permille, tolerance_mm, min_offcut_width_mm, min_offcut_length_mm
     FROM rulesets WHERE effective_at <= now() ORDER BY effective_at DESC, version DESC LIMIT 1`,
  );
  if (rows.length === 0) throw new Refusal(503, 'database_unavailable', words.errors.database_unavailable);
  return rows[0]!;
}

async function nextCode(db: DbClient, name: string, prefix: string, pad: number): Promise<string> {
  const rows = await db.query<{ next_value: number }>(`UPDATE sequences SET next_value = next_value + 1 WHERE name = $1 RETURNING next_value - 1 AS next_value`, [name]);
  const n = rows[0]?.next_value ?? 1;
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

async function audit(db: DbClient, actorEmail: string, action: string, target: string, before: unknown, after: unknown, reason: string | null): Promise<void> {
  await db.query(
    `INSERT INTO audit_trail (id, at, actor_email, action, target, before, after, reason) VALUES ($1, now(), $2, $3, $4, $5, $6, $7)`,
    [opaqueId('audit'), actorEmail, action, target, JSON.stringify(before ?? null), JSON.stringify(after ?? null), reason],
  );
}

async function postLedgerPair(db: DbClient, opts: {
  stockCode: string; drawing: string; actorEmail: string; reason: string;
  lines: { account: string; amount: number; stockCode: string }[];
}): Promise<{ pairId: string; lines: { line_id: number; pair_id: string; posted_at: string; account: string; amount_mm2: number; stock_code: string; drawing_code: string; actor_email: string; reason: string }[] }> {
  const posted = new Date();
  const rows = await db.query<{ next_value: number }>(`UPDATE sequences SET next_value = next_value + 2 WHERE name = 'ledger' RETURNING next_value - 2 AS next_value`);
  let lineId = rows[0]?.next_value ?? 1201;
  const pairId = opaqueId('pair');
  const out: { line_id: number; pair_id: string; posted_at: string; account: string; amount_mm2: number; stock_code: string; drawing_code: string; actor_email: string; reason: string }[] = [];
  for (const line of opts.lines) {
    await db.query(
      `INSERT INTO ledger_line (line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [lineId, pairId, posted, line.account, line.amount, line.stockCode, opts.drawing, opts.actorEmail, opts.reason],
    );
    out.push({ line_id: lineId, pair_id: pairId, posted_at: viewTs(posted), account: line.account, amount_mm2: line.amount, stock_code: line.stockCode, drawing_code: opts.drawing, actor_email: opts.actorEmail, reason: opts.reason });
    lineId += 1;
  }
  return { pairId, lines: out };
}

// ---------------------------------------------------------------------------
// Session

route('GET', '/api/health', [], async (_req, res, ctx) => {
  let dbUp = false;
  let identityUp = false;
  try {
    await ctx.db.query('SELECT 1');
    dbUp = true;
  } catch { dbUp = false; }
  try {
    await ctx.keycloak.jwks();
    identityUp = true;
  } catch { identityUp = false; }
  if (!dbUp) { json(res, 503, { status: 'unavailable', dependency: 'database' }); return; }
  if (!identityUp) { json(res, 503, { status: 'unavailable', dependency: 'identity' }); return; }
  json(res, 200, { status: 'ok' });
});

route('POST', '/api/session', [], async (req, res, ctx) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const email = typeof body['email'] === 'string' ? body['email'] : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  if (!email) invalid.add('email', words.fields.required);
  if (!password) invalid.add('password', words.fields.required);
  invalid.throwIfAny();
  let token: { access_token: string; expires_in: number };
  try {
    token = await ctx.keycloak.passwordToken(normalizeEmail(email), password);
  } catch (err) {
    if ((err as { kind?: string }).kind === 'bad_credentials') {
      throw new Refusal(401, 'bad_credentials', words.errors.bad_credentials);
    }
    throw new Refusal(503, 'identity_unavailable', words.errors.identity_unavailable);
  }
  const caller = await signInAccount(ctx, token.access_token);
  if (!caller) throw new Refusal(401, 'bad_credentials', words.errors.bad_credentials);
  await finishSignIn(res, ctx, caller, token);
});

async function signInAccount(ctx: Ctx, token: string): Promise<Caller | null> {
  try {
    const { decodeJwt } = await import('jose');
    const claims = decodeJwt(token);
    const sub = claims.sub;
    if (!sub) return null;
    const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
      `SELECT id, email_norm, display_name, role FROM accounts WHERE kc_user_id = $1 AND deleted = false`, [sub],
    );
    const row = rows[0];
    if (!row) {
      const tokenEmail = String(claims['email'] ?? emailFromToken(claims) ?? '').toLowerCase();
      const byEmail = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
        `SELECT id, email_norm, display_name, role FROM accounts WHERE email_norm = $1 AND deleted = false`,
        [tokenEmail],
      );
      const b = byEmail[0];
      if (!b) return null;
      await ctx.db.query(`UPDATE accounts SET kc_user_id = $1 WHERE id = $2`, [sub, b.id]);
      return { id: b.id, email: b.email_norm, displayName: b.display_name, role: b.role };
    }
    return { id: row.id, email: row.email_norm, displayName: row.display_name, role: row.role };
  } catch {
    return null;
  }
}

function emailFromToken(claims: Record<string, unknown>): string | null {
  const preferred = claims['preferred_username'];
  return typeof preferred === 'string' ? preferred : null;
}

async function finishSignIn(res: Response, ctx: Ctx, caller: Caller, token: { access_token: string; expires_in: number }): Promise<void> {
  const sessionToken = opaqueId('sess');
  const expires = new Date(Date.now() + token.expires_in * 1000);
  await ctx.db.query(
    `INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, now(), $3)`,
    [sessionToken, caller.id, expires],
  );
  res.setHeader('set-cookie', `boltrope_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/`);
  json(res, 200, {
    account: accountBody(caller),
    access_token: token.access_token,
    expires_in: token.expires_in,
  });
}

route('GET', '/api/session', [], async (req, res, ctx) => {
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.['boltrope_session'];
  if (!cookie) throw unauthenticated();
  const caller = await signInByCookie(ctx, cookie);
  if (!caller) throw unauthenticated();
  const clientToken = await clientCredentialsFor(ctx, caller);
  json(res, 200, {
    account: accountBody(caller),
    access_token: clientToken.access_token,
    expires_in: clientToken.expires_in,
  });
});

async function signInByCookie(ctx: Ctx, cookie: string): Promise<Caller | null> {
  const rows = await ctx.db.query<{ account_id: string }>(`SELECT account_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`, [cookie]);
  const row = rows[0];
  if (!row) return null;
  const acc = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: Caller['role'] }>(
    `SELECT id, email_norm, display_name, role FROM accounts WHERE id = $1 AND deleted = false`, [row.account_id],
  );
  const a = acc[0];
  return a ? { id: a.id, email: a.email_norm, displayName: a.display_name, role: a.role } : null;
}

async function clientCredentialsFor(ctx: Ctx, caller: Caller): Promise<{ access_token: string; expires_in: number }> {
  // The session endpoint returns a bearer token for the caller. There is no password to reuse,
  // so the server signs the caller in by the realm's token exchange on its own credentials.
  const res = await fetch(`${ctx.config.keycloakUrl}/realms/${ctx.config.keycloakRealm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: ctx.config.authClientId,
      client_secret: ctx.config.authClientSecret,
      subject_token: await serviceToken(ctx),
      requested_subject: caller.id,
    }),
  });
  if (!res.ok) {
    // Fall back to a client-credentials token; role checks read the database anyway.
    return serviceTokenPair(ctx);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function serviceTokenPair(ctx: Ctx): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${ctx.config.keycloakUrl}/realms/${ctx.config.keycloakRealm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ctx.config.authClientId,
      client_secret: ctx.config.authClientSecret,
    }),
  });
  if (!res.ok) throw new Refusal(503, 'identity_unavailable', words.errors.identity_unavailable);
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function serviceToken(ctx: Ctx): Promise<string> {
  const pair = await serviceTokenPair(ctx);
  return pair.access_token;
}

route('DELETE', '/api/session', ALL, async (req, res, ctx) => {
  const cookie = (req as unknown as { cookies?: Record<string, string> }).cookies?.['boltrope_session'];
  if (cookie) await ctx.db.query(`DELETE FROM sessions WHERE token_hash = $1`, [cookie]);
  res.setHeader('set-cookie', 'boltrope_session=; HttpOnly; SameSite=Lax; Path=/');
  res.status(204);
  res.setHeader('cache-control', 'private, no-store');
  res.end();
});

function accountBody(caller: Caller): Record<string, unknown> {
  return { id: caller.id, email: caller.email, display_name: caller.displayName, role: caller.role };
}

function bodyJson(req: Request): Record<string, unknown> {
  const body = (req as unknown as { body?: unknown }).body;
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
}

// ---------------------------------------------------------------------------
// Accounts

route('GET', '/api/accounts', SAILMAKER, async (_req, res, ctx, _caller) => {
  const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: string }>(
    `SELECT id, email_norm, display_name, role FROM accounts WHERE deleted = false ORDER BY id DESC`,
  );
  json(res, 200, { items: rows.map((a) => ({ id: a.id, email: a.email_norm, display_name: a.display_name, role: a.role })), next_cursor: null, total: rows.length });
});

route('POST', '/api/accounts', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const email = typeof body['email'] === 'string' ? body['email'] : '';
  const displayName = typeof body['display_name'] === 'string' ? body['display_name'] : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  const role = body['role'];
  if (!email) invalid.add('email', words.fields.required);
  else if (!validEmailShape(email)) invalid.add('email', words.fields.email);
  if (!displayName) invalid.add('display_name', words.fields.required);
  else if (countChars(displayName) < 1 || countChars(displayName) > 80) invalid.add('display_name', fill(words.fields.textLength, { min: 1, max: 80 }));
  if (!password) invalid.add('password', words.fields.required);
  else if (countChars(password) < 12 || countChars(password) > 128) invalid.add('password', words.fields.password);
  if (role !== 'yacht-owner' && role !== 'loft-hand') invalid.add('role', words.fields.roleUnknown);
  invalid.throwIfAny();
  const emailNorm = normalizeEmail(email);
  const account = await inTransaction(ctx.db, async (db) => {
    const existing = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE email_norm = $1 FOR UPDATE`, [emailNorm]);
    if (existing.length > 0) throw new Refusal(409, 'email_taken', words.errors.email_taken);
    const id = await nextCode(db, 'account', 'A-', 2);
    await db.query(
      `INSERT INTO accounts (id, email_norm, display_name, role, kc_user_id, deleted, created_at) VALUES ($1,$2,$3,$4,null,false,now())`,
      [id, emailNorm, displayName, role],
    );
    await audit(db, caller.email, 'account.create', id, null, { id, email: emailNorm, display_name: displayName, role }, null);
    return id;
  });
  let kcUser: { id: string; email: string } | null = null;
  try {
    kcUser = await ctx.keycloak.ensureUser(emailNorm, password, role as string);
    await ctx.db.query(`UPDATE accounts SET kc_user_id = $1 WHERE id = $2`, [kcUser.id, account]);
  } catch {
    // The identity keeper will re-create the user on its next pass.
  }
  const rows = await ctx.db.query<{ email_norm: string; display_name: string; role: string }>(
    `SELECT email_norm, display_name, role FROM accounts WHERE id = $1`, [account],
  );
  json(res, 201, { id: account, email: rows[0]!.email_norm, display_name: rows[0]!.display_name, role: rows[0]!.role });
});

route('PATCH', '/api/accounts/:id', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: string; deleted: boolean }>(
    `SELECT id, email_norm, display_name, role, deleted FROM accounts WHERE id = $1`, [req.params['id'] as string],
  );
  if (rows.length === 0 || rows[0]!.deleted) throw notFoundRefusal();
  const before = rows[0]!;
  if ('role' in body) {
    await audit(ctx.db, caller.email, 'account.role_change_refused', before.id, before.role, body['role'], null);
    throw new Refusal(403, 'role_change_forbidden', words.errors.role_change_forbidden);
  }
  const invalid = new Invalid();
  const displayName = typeof body['display_name'] === 'string' ? body['display_name'] : '';
  if (!displayName) invalid.add('display_name', words.fields.required);
  else if (countChars(displayName) < 1 || countChars(displayName) > 80) invalid.add('display_name', fill(words.fields.textLength, { min: 1, max: 80 }));
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    await db.query(`UPDATE accounts SET display_name = $1 WHERE id = $2`, [displayName, before.id]);
    await audit(db, caller.email, 'account.rename', before.id, before.display_name, displayName, null);
  });
  json(res, 200, { id: before.id, email: before.email_norm, display_name: displayName, role: before.role });
});

route('DELETE', '/api/accounts/:id', SAILMAKER, async (req, res, ctx, caller) => {
  const rows = await ctx.db.query<{ id: string; email_norm: string; deleted: boolean; kc_user_id: string | null }>(
    `SELECT id, email_norm, deleted, kc_user_id FROM accounts WHERE id = $1`, [req.params['id'] as string],
  );
  if (rows.length === 0 || rows[0]!.deleted) throw notFoundRefusal();
  const target = rows[0]!;
  const boats = await ctx.db.query<{ code: string }>(`SELECT code FROM boats WHERE owner_id = $1`, [target.id]);
  if (boats.length > 0) throw new Refusal(409, 'account_in_use', words.errors.account_in_use);
  await inTransaction(ctx.db, async (db) => {
    await db.query(`UPDATE accounts SET deleted = true WHERE id = $1`, [target.id]);
    await audit(db, caller.email, 'account.delete', target.id, target.email_norm, null, null);
  });
  if (target.kc_user_id) {
    try {
      await ctx.keycloak.deleteUser(target.kc_user_id);
    } catch {
      // The identity keeper will notice the missing user and leave it deleted.
    }
  }
  await ctx.db.query(`DELETE FROM sessions WHERE account_id = $1`, [target.id]);
  res.status(204);
  res.setHeader('cache-control', 'private, no-store');
  res.end();
});

route('GET', '/api/admin/roles', SAILMAKER, async (_req, res) => {
  json(res, 200, { items: [
    { ability: 'manage accounts', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'record measurements', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'submit measurements', sailmaker: 'no', 'loft-hand': 'no', 'yacht-owner': 'own boats' },
    { ability: 'decide submissions', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'draw and issue sails', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'claim, lay and cut', sailmaker: 'yes', 'loft-hand': 'assigned drawings with authority', 'yacht-owner': 'no' },
    { ability: 'manage stock and ledger', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'record payments', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
    { ability: 'view cut sheets', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'while sight is granted' },
  ] });
});

function notFoundRefusal(): Refusal {
  return new Refusal(404, 'not_found', words.errors.not_found);
}

// ---------------------------------------------------------------------------
// Rule sets

route('GET', '/api/rulesets', SAILMAKER, async (_req, res, ctx) => {
  const rows = await ctx.db.query<{ version: number; effective_at: Date; seam_overlap_mm: number; roach_permille: number; tolerance_mm: number; min_offcut_width_mm: number; min_offcut_length_mm: number; revision: number }>(
    `SELECT version, effective_at, seam_overlap_mm, roach_permille, tolerance_mm, min_offcut_width_mm, min_offcut_length_mm, revision FROM rulesets ORDER BY version DESC`,
  );
  const now = Date.now();
  json(res, 200, {
    items: rows.map((r) => ({
      version: r.version, effective_at: viewTs(r.effective_at), current: r.effective_at.getTime() <= now,
      seam_overlap_mm: r.seam_overlap_mm, roach_permille: r.roach_permille, tolerance_mm: r.tolerance_mm,
      min_offcut_width_mm: r.min_offcut_width_mm, min_offcut_length_mm: r.min_offcut_length_mm, revision: r.revision,
    })),
    next_cursor: null, total: rows.length,
  });
});

const RULE_MEMBERS = ['seam_overlap_mm', 'roach_permille', 'tolerance_mm', 'min_offcut_width_mm', 'min_offcut_length_mm'] as const;
const RULE_BOUNDS: Record<string, [number, number]> = {
  seam_overlap_mm: [0, 100], roach_permille: [1000, 1300], tolerance_mm: [1, 100],
  min_offcut_width_mm: [1, 2000], min_offcut_length_mm: [1, 60000],
};

function ruleFields(body: Record<string, unknown>, invalid: Invalid): { seam: number; roach: number; tolerance: number; minWidth: number; minLength: number } {
  const out: Record<string, number> = {};
  for (const member of RULE_MEMBERS) {
    const value = body[member];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      invalid.add(member, fill(words.fields.wholeNumber, { min: RULE_BOUNDS[member][0], max: RULE_BOUNDS[member][1] }));
      out[member] = 0;
    } else if (value < RULE_BOUNDS[member][0] || value > RULE_BOUNDS[member][1]) {
      invalid.add(member, fill(words.fields.wholeNumber, { min: RULE_BOUNDS[member][0], max: RULE_BOUNDS[member][1] }));
      out[member] = value;
    } else {
      out[member] = value;
    }
  }
  return { seam: out['seam_overlap_mm']!, roach: out['roach_permille']!, tolerance: out['tolerance_mm']!, minWidth: out['min_offcut_width_mm']!, minLength: out['min_offcut_length_mm']! };
}

route('POST', '/api/rulesets', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const figures = ruleFields(body, invalid);
  const effectiveAtRaw = typeof body['effective_at'] === 'string' ? body['effective_at'] : '';
  if (!effectiveAtRaw) invalid.add('effective_at', words.fields.required);
  const effectiveAt = parseInstant(effectiveAtRaw);
  if (!effectiveAtRaw) { /* already flagged */ }
  else if (!effectiveAt || effectiveAt.getTime() <= Date.now()) invalid.add('effective_at', words.fields.badInstant);
  invalid.throwIfAny();
  const version = await inTransaction(ctx.db, async (db) => {
    const next = await db.query<{ next_value: number }>(`SELECT COALESCE(MAX(version),0)+1 AS next_value FROM rulesets`);
    const v = next[0]!.next_value;
    await db.query(
      `INSERT INTO rulesets (version,effective_at,seam_overlap_mm,roach_permille,tolerance_mm,min_offcut_width_mm,min_offcut_length_mm,revision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
      [v, effectiveAt, figures.seam, figures.roach, figures.tolerance, figures.minWidth, figures.minLength],
    );
    await audit(db, caller.email, 'ruleset.create', `v${v}`, null, { version: v, effective_at: effectiveAt ? viewTs(effectiveAt) : null }, null);
    return v;
  });
  json(res, 201, {
    version, effective_at: viewTs(effectiveAt!), current: false,
    seam_overlap_mm: figures.seam, roach_permille: figures.roach, tolerance_mm: figures.tolerance,
    min_offcut_width_mm: figures.minWidth, min_offcut_length_mm: figures.minLength, revision: 1,
  });
});

route('PATCH', '/api/rulesets/:version', SAILMAKER, async (req, res, ctx, caller) => {
  const version = Number(req.params['version']);
  const rows = await ctx.db.query<{ version: number; effective_at: Date; revision: number }>(
    `SELECT version, effective_at, revision FROM rulesets WHERE version = $1`, [version],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const target = rows[0]!;
  if (target.effective_at.getTime() <= Date.now()) {
    await audit(ctx.db, caller.email, 'ruleset.update', `v${version}`, null, null, null);
    throw new Refusal(409, 'sealed', words.errors.sealed);
  }
  const ifMatch = req.header('if-match');
  if (!ifMatch) throw new Refusal(428, 'precondition_required', words.errors.precondition_required);
  if (ifMatch.replace(/"/g, '') !== String(target.revision)) throw new Refusal(412, 'stale_revision', words.errors.stale_revision);
  const body = bodyJson(req);
  const invalid = new Invalid();
  const figures = ruleFields(body, invalid);
  const effectiveAtRaw = typeof body['effective_at'] === 'string' ? body['effective_at'] : '';
  if (!effectiveAtRaw) invalid.add('effective_at', words.fields.required);
  const effectiveAt = parseInstant(effectiveAtRaw);
  if (!effectiveAtRaw) { /* flagged */ }
  else if (!effectiveAt || effectiveAt.getTime() <= Date.now()) invalid.add('effective_at', words.fields.badInstant);
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    await db.query(
      `UPDATE rulesets SET effective_at=$1, seam_overlap_mm=$2, roach_permille=$3, tolerance_mm=$4, min_offcut_width_mm=$5, min_offcut_length_mm=$6, revision=revision+1 WHERE version=$7`,
      [effectiveAt, figures.seam, figures.roach, figures.tolerance, figures.minWidth, figures.minLength, version],
    );
    await audit(db, caller.email, 'ruleset.update', `v${version}`, null, { effective_at: viewTs(effectiveAt!) }, null);
  });
  json(res, 200, {
    version, effective_at: viewTs(effectiveAt!), current: false,
    seam_overlap_mm: figures.seam, roach_permille: figures.roach, tolerance_mm: figures.tolerance,
    min_offcut_width_mm: figures.minWidth, min_offcut_length_mm: figures.minLength, revision: target.revision + 1,
  });
});

// ---------------------------------------------------------------------------
// Cloths, closures, boats, measurements, photos

route('GET', '/api/cloths', SAILMAKER_LOFT_HAND, async (_req, res, ctx) => {
  const rows = await ctx.db.query<{ code: string; name: string; weight: string; width_mm: number; usable_width_mm: number; rate_pence_per_m2: number }>(
    `SELECT code, name, weight, width_mm, usable_width_mm, rate_pence_per_m2 FROM cloths ORDER BY code`,
  );
  json(res, 200, { items: rows, next_cursor: null, total: rows.length });
});

route('GET', '/api/closures', SAILMAKER_LOFT_HAND, async (_req, res, ctx) => {
  const rows = await ctx.db.query<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM closures ORDER BY date`);
  json(res, 200, { items: rows.map((r) => ({ date: r.date })), next_cursor: null, total: rows.length });
});

async function boatRow(db: DbClient, code: string): Promise<{ code: string; name: string; class_name: string; owner_id: string; notes: string; revision: number } | null> {
  const rows = await db.query<{ code: string; name: string; class_name: string; owner_id: string; notes: string; revision: number }>(
    `SELECT code, name, class_name, owner_id, notes, revision FROM boats WHERE code = $1`, [code],
  );
  return rows[0] ?? null;
}

async function boatVisible(db: DbClient, caller: Caller, code: string): Promise<boolean> {
  if (caller.role === 'sailmaker') return true;
  if (caller.role === 'yacht-owner') {
    const rows = await db.query<{ owner_id: string }>(`SELECT owner_id FROM boats WHERE code = $1`, [code]);
    return rows.length > 0 && rows[0]!.owner_id === caller.id;
  }
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM drawings d WHERE d.boat_code = $1 AND d.assigned_to = $2`, [code, caller.id],
  );
  return (rows[0]?.n ?? 0) > 0;
}

route('GET', '/api/boats', ALL, async (_req, res, ctx, caller) => {
  const rules = await currentRuleset(ctx.db);
  let rows: { code: string; name: string; class_name: string; owner_id: string; notes: string; revision: number }[];
  if (caller.role === 'sailmaker') {
    rows = await ctx.db.query(`SELECT code, name, class_name, owner_id, notes, revision FROM boats ORDER BY code`);
  } else if (caller.role === 'yacht-owner') {
    rows = await ctx.db.query(`SELECT code, name, class_name, owner_id, notes, revision FROM boats WHERE owner_id = $1 ORDER BY code`, [caller.id]);
  } else {
    rows = await ctx.db.query(
      `SELECT DISTINCT b.code, b.name, b.class_name, b.owner_id, b.notes, b.revision FROM boats b
       JOIN drawings d ON d.boat_code = b.code WHERE d.assigned_to = $1 ORDER BY b.code`, [caller.id],
    );
  }
  const items: Record<string, unknown>[] = [];
  for (const b of rows) {
    const owner = await accountRef(ctx.db, b.owner_id);
    items.push(await boatView(ctx.db, b, owner, rules.tolerance_mm, rules.version, caller.role));
  }
  json(res, 200, { items, next_cursor: null, total: items.length });
});

async function accountRef(db: DbClient, id: string): Promise<{ email_norm: string; display_name: string; deleted: boolean }> {
  const rows = await db.query<{ email_norm: string; display_name: string; deleted: boolean }>(
    `SELECT email_norm, display_name, deleted FROM accounts WHERE id = $1`, [id],
  );
  return rows[0] ?? { email_norm: '', display_name: '', deleted: true };
}

route('GET', '/api/boats/:code', ALL, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  if (!(await boatVisible(ctx.db, caller, code))) throw notFoundRefusal();
  const boat = await boatRow(ctx.db, code);
  if (!boat) throw notFoundRefusal();
  const rules = await currentRuleset(ctx.db);
  const owner = await accountRef(ctx.db, boat.owner_id);
  if (caller.role === 'sailmaker') res.setHeader('etag', `"${boat.revision}"`);
  json(res, 200, await boatView(ctx.db, boat, owner, rules.tolerance_mm, rules.version, caller.role));
});

route('POST', '/api/boats', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const name = typeof body['name'] === 'string' ? body['name'] : '';
  const className = typeof body['class_name'] === 'string' ? body['class_name'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  const ownerEmail = typeof body['owner_email'] === 'string' ? body['owner_email'] : '';
  if (!name) invalid.add('name', words.fields.required);
  else if (countChars(name) > 60) invalid.add('name', fill(words.fields.textLength, { min: 1, max: 60 }));
  if (!className) invalid.add('class_name', words.fields.required);
  else if (countChars(className) > 60) invalid.add('class_name', fill(words.fields.textLength, { min: 1, max: 60 }));
  if (notes && countChars(notes) > 500) invalid.add('notes', fill(words.fields.textLength, { min: 0, max: 500 }));
  let owner: { id: string; email_norm: string; display_name: string; role: string } | null = null;
  if (!ownerEmail) invalid.add('owner_email', words.fields.required);
  else {
    const rows = await ctx.db.query<{ id: string; email_norm: string; display_name: string; role: string }>(
      `SELECT id, email_norm, display_name, role FROM accounts WHERE email_norm = $1 AND role = 'yacht-owner' AND deleted = false`, [normalizeEmail(ownerEmail)],
    );
    owner = rows[0] ?? null;
    if (!owner) invalid.add('owner_email', words.fields.ownerEmail);
  }
  invalid.throwIfAny();
  const code = await inTransaction(ctx.db, async (db) => {
    const c = await nextCode(db, 'boat', 'B-', 2);
    await db.query(
      `INSERT INTO boats (code, name, class_name, owner_id, notes, revision, created_at) VALUES ($1,$2,$3,$4,$5,1,now())`,
      [c, name, className, owner!.id, notes],
    );
    await audit(db, caller.email, 'boat.create', c, null, { code: c, name }, null);
    return c;
  });
  const boat = await boatRow(ctx.db, code);
  const acc = await accountRef(ctx.db, boat!.owner_id);
  const rules = await currentRuleset(ctx.db);
  json(res, 201, await boatView(ctx.db, boat!, acc, rules.tolerance_mm, rules.version, caller.role));
});

route('PATCH', '/api/boats/:code', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const boat = await boatRow(ctx.db, code);
  if (!boat) throw notFoundRefusal();
  const ifMatch = req.header('if-match');
  if (!ifMatch) throw new Refusal(428, 'precondition_required', words.errors.precondition_required);
  if (ifMatch.replace(/"/g, '') !== String(boat.revision)) throw new Refusal(412, 'stale_revision', words.errors.stale_revision);
  const body = bodyJson(req);
  const invalid = new Invalid();
  const name = typeof body['name'] === 'string' ? body['name'] : '';
  const className = typeof body['class_name'] === 'string' ? body['class_name'] : '';
  const notes = typeof body['notes'] === 'string' ? body['notes'] : '';
  if (!name) invalid.add('name', words.fields.required);
  else if (countChars(name) > 60) invalid.add('name', fill(words.fields.textLength, { min: 1, max: 60 }));
  if (!className) invalid.add('class_name', words.fields.required);
  else if (countChars(className) > 60) invalid.add('class_name', fill(words.fields.textLength, { min: 1, max: 60 }));
  if (notes && countChars(notes) > 500) invalid.add('notes', fill(words.fields.textLength, { min: 0, max: 500 }));
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    await db.query(`UPDATE boats SET name=$1, class_name=$2, notes=$3, revision=revision+1 WHERE code=$4`, [name, className, notes, code]);
    await audit(db, caller.email, 'boat.update', code, { name: boat.name }, { name }, null);
  });
  const updated = await boatRow(ctx.db, code);
  const acc = await accountRef(ctx.db, updated!.owner_id);
  const rules = await currentRuleset(ctx.db);
  res.setHeader('etag', `"${updated!.revision}"`);
  json(res, 200, await boatView(ctx.db, updated!, acc, rules.tolerance_mm, rules.version, caller.role));
});

const DIMENSIONS = ['I', 'J', 'P', 'E', 'LL', 'LP'] as const;

route('POST', '/api/boats/:code/measurements', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const boat = await boatRow(ctx.db, code);
  if (!boat) throw notFoundRefusal();
  const body = bodyJson(req);
  const invalid = new Invalid();
  const dimension = body['dimension'];
  const valueMm = body['value_mm'];
  const measuredOn = typeof body['measured_on'] === 'string' ? body['measured_on'] : '';
  if (typeof dimension !== 'string' || !(DIMENSIONS as readonly string[]).includes(dimension)) invalid.add('dimension', words.fields.dimensionUnknown);
  if (typeof valueMm !== 'number' || !Number.isInteger(valueMm) || valueMm < 1 || valueMm > 60000) invalid.add('value_mm', words.fields.lengthRange);
  const onDate = measuredOn && /^\d{4}-\d{2}-\d{2}$/.test(measuredOn) ? new Date(`${measuredOn}T00:00:00Z`) : null;
  if (!measuredOn) invalid.add('measured_on', words.fields.required);
  else if (!onDate || Number.isNaN(onDate.getTime()) || onDate < new Date('2020-01-01T00:00:00Z') || onDate > new Date('2030-12-31T00:00:00Z')) invalid.add('measured_on', words.fields.badDate);
  invalid.throwIfAny();
  const rules = await currentRuleset(ctx.db);
  const previous = await currentValue(ctx.db, code, dimension as string);
  if (previous !== null) {
    const asInches = mulHalf(Number(valueMm), 254, 10);
    if (Math.abs(asInches - previous) <= rules.tolerance_mm) {
      throw new Refusal(422, 'invalid', words.errors.invalid, { value_mm: words.fields.unitSlip });
    }
  }
  await inTransaction(ctx.db, async (db) => {
    const id = opaqueId('m');
    const ord = await db.query<{ n: number }>(
      `SELECT COALESCE(MAX(ord),0)+1 AS n FROM measurements WHERE boat_code=$1 AND dimension=$2`, [code, dimension],
    );
    await db.query(
      `INSERT INTO measurements (id, boat_code, dimension, value_mm, measured_on, source, submission_id, recorded_at, ord)
       VALUES ($1,$2,$3,$4,$5,'sailmaker',null,now(),$6)`,
      [id, code, dimension, valueMm, measuredOn, ord[0]!.n],
    );
    await audit(db, caller.email, 'measurement.record', id, null, { boat: code, dimension, value_mm: valueMm }, null);
    await stepBackDrawings(db, code);
  });
  const updated = await boatRow(ctx.db, code);
  const acc = await accountRef(ctx.db, updated!.owner_id);
  json(res, 201, await boatView(ctx.db, updated!, acc, rules.tolerance_mm, rules.version, caller.role));
});

async function currentValue(db: DbClient, boatCode: string, dimension: string): Promise<number | null> {
  const rows = await db.query<{ value_mm: number }>(
    `SELECT value_mm FROM measurements WHERE boat_code=$1 AND dimension=$2 ORDER BY ord DESC LIMIT 1`, [boatCode, dimension],
  );
  return rows[0]?.value_mm ?? null;
}

async function stepBackDrawings(db: DbClient, boatCode: string): Promise<void> {
  const affected = await db.query<{ code: string }>(
    `SELECT code FROM drawings WHERE boat_code=$1 AND status IN ('drawn','nested')`, [boatCode],
  );
  for (const d of affected) {
    await db.query(`DELETE FROM lays WHERE claim_id IN (SELECT id FROM claims WHERE drawing_code=$1 AND status='held')`, [d.code]);
    await db.query(
      `UPDATE drawings SET status='measuring', area_mm2=null, panels=null, luff_mm=null, foot_mm=null, draw_boat_name=null, draw_owner_name=null, draw_dims=null WHERE code=$1`,
      [d.code],
    );
  }
}

route('PUT', '/api/measurements/:id/photo', SAILMAKER, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const rows = await ctx.db.query<{ id: string; boat_code: string; photo_key: string | null; photo_sha256: string | null; photo_size: number | null; photo_content_type: string | null }>(
    `SELECT id, boat_code, photo_key, photo_sha256, photo_size, photo_content_type FROM measurements WHERE id = $1`, [id],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const target = rows[0]!;
  const contentType = String(req.header('content-type') ?? '');
  const bytes = (req as unknown as { body?: Buffer }).body as Buffer;
  if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
    throw new Refusal(415, 'unsupported_media', words.errors.unsupported_media);
  }
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const signatureOk = contentType === 'image/jpeg' ? jpeg : png;
  if (!signatureOk) throw new Refusal(415, 'unsupported_media', words.errors.unsupported_media);
  const sha = sha256Hex(bytes);
  if (target.photo_key) {
    if (target.photo_sha256 === sha && target.photo_size === bytes.length) {
      const boat = await boatRow(ctx.db, target.boat_code);
      const acc = await accountRef(ctx.db, boat!.owner_id);
      const rules = await currentRuleset(ctx.db);
      json(res, 200, await boatView(ctx.db, boat!, acc, rules.tolerance_mm, rules.version, caller.role));
      return;
    }
    throw new Refusal(409, 'photo_exists', words.errors.photo_exists);
  }
  const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
  const key = `tape-photos/${target.boat_code}/${id}/${sha}.${ext}`;
  let confirmed = false;
  try {
    confirmed = await ctx.store.putConfirmed(key, bytes, contentType, { sha256: sha });
  } catch {
    confirmed = false;
  }
  if (!confirmed) throw new Refusal(503, 'store_unavailable', words.errors.store_photo);
  await inTransaction(ctx.db, async (db) => {
    await db.query(
      `UPDATE measurements SET photo_key=$1, photo_size=$2, photo_sha256=$3, photo_content_type=$4 WHERE id=$5`,
      [key, bytes.length, sha, contentType, id],
    );
    await audit(db, caller.email, 'photo.attach', id, null, { key, sha256: sha }, null);
  });
  const boat = await boatRow(ctx.db, target.boat_code);
  const acc = await accountRef(ctx.db, boat!.owner_id);
  const rules = await currentRuleset(ctx.db);
  json(res, 200, await boatView(ctx.db, boat!, acc, rules.tolerance_mm, rules.version, caller.role));
});

route('GET', '/api/measurements/:id/photo', ALL, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const rows = await ctx.db.query<{ boat_code: string; photo_key: string | null; photo_sha256: string | null; photo_content_type: string | null }>(
    `SELECT boat_code, photo_key, photo_sha256, photo_content_type FROM measurements WHERE id = $1`, [id],
  );
  if (rows.length === 0 || !rows[0]!.photo_key) throw notFoundRefusal();
  const target = rows[0]!;
  if (!(await boatVisible(ctx.db, caller, target.boat_code))) throw notFoundRefusal();
  let bytes: Buffer | null;
  try {
    bytes = await ctx.store.get(target.photo_key!);
  } catch {
    throw new Refusal(503, 'store_unavailable', words.errors.store_photo);
  }
  if (!bytes) throw notFoundRefusal();
  res.status(200);
  res.setHeader('content-type', target.photo_content_type ?? 'application/octet-stream');
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('etag', `"${target.photo_sha256}"`);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-disposition', `inline; filename="${id}.${target.photo_content_type === 'image/png' ? 'png' : 'jpg'}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.end(bytes);
});

// ---------------------------------------------------------------------------
// Submissions

route('POST', '/api/boats/:code/submissions', ['yacht-owner'], async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const boat = await boatRow(ctx.db, code);
  if (!boat || boat.owner_id !== caller.id) throw notFoundRefusal();
  const body = bodyJson(req);
  const invalid = new Invalid();
  const dimension = body['dimension'];
  const measuredOn = typeof body['measured_on'] === 'string' ? body['measured_on'] : '';
  const note = typeof body['note'] === 'string' ? body['note'] : '';
  if (typeof dimension !== 'string' || !(DIMENSIONS as readonly string[]).includes(dimension)) invalid.add('dimension', words.fields.dimensionUnknown);
  const onDate = measuredOn && /^\d{4}-\d{2}-\d{2}$/.test(measuredOn) ? new Date(`${measuredOn}T00:00:00Z`) : null;
  if (!measuredOn) invalid.add('measured_on', words.fields.required);
  else if (!onDate || Number.isNaN(onDate.getTime()) || onDate < new Date('2020-01-01T00:00:00Z') || onDate > new Date('2030-12-31T00:00:00Z')) invalid.add('measured_on', words.fields.badDate);
  if (note && countChars(note) > 200) invalid.add('note', fill(words.fields.textLength, { min: 0, max: 200 }));
  const hasMm = 'value_mm' in body && body['value_mm'] !== undefined && body['value_mm'] !== null;
  const hasIn = 'value_in' in body && body['value_in'] !== undefined && body['value_in'] !== null;
  let mm: number | null = null;
  let asSubmitted = '';
  if (hasMm && hasIn || !hasMm && !hasIn) {
    invalid.add('value_mm', words.fields.bothUnits);
  } else if (hasMm) {
    const v = body['value_mm'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 60000) invalid.add('value_mm', words.fields.lengthRange);
    else { mm = v; asSubmitted = `${v} mm`; }
  } else {
    const text = body['value_in'];
    if (typeof text !== 'string') invalid.add('value_in', words.fields.inches);
    else {
      const parsed = parseValueIn(text);
      if (parsed === null) invalid.add('value_in', words.fields.inches);
      else if (parsed < 1 || parsed > 60000) invalid.add('value_in', words.fields.lengthRange);
      else { mm = parsed; asSubmitted = inchesAsSubmitted(text); }
    }
  }
  invalid.throwIfAny();
  // Unit-slip guard for a millimetre submission with a current value.
  const rules = await currentRuleset(ctx.db);
  if (hasMm && mm !== null) {
    const previous = await currentValue(ctx.db, code, dimension as string);
    if (previous !== null) {
      const asInches = mulHalf(mm, 254, 10);
      if (Math.abs(asInches - previous) <= rules.tolerance_mm) {
        throw new Refusal(422, 'invalid', words.errors.invalid, { value_mm: words.fields.unitSlip });
      }
    }
  }
  await rateLimit(ctx, caller, 'submission');
  const id = await inTransaction(ctx.db, async (db) => {
    const sid = await nextCode(db, 'submission', 'S-', 4);
    await db.query(
      `INSERT INTO submissions (id, boat_code, dimension, value_mm, as_submitted, measured_on, note, status, submitted_by, submitted_at, decided_at, decided_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,now(),null,null,null)`,
      [sid, code, dimension, mm, asSubmitted, measuredOn, note, caller.id],
    );
    await audit(db, caller.email, 'submission.create', sid, null, { status: 'pending' }, null);
    return sid;
  });
  const rows = await ctx.db.query<SubmissionRow>(`${submissionSelect()} WHERE s.id = $1`, [id]);
  json(res, 201, submissionBody(rows[0]!, caller.role));
});

function submissionSelect(): string {
  return `SELECT s.id, s.boat_code, s.dimension, s.value_mm, s.as_submitted, s.measured_on, s.note, s.status,
          s.submitted_at, s.decided_at, s.decided_by, s.reason, a.email_norm AS owner_email, a.display_name AS owner_name, a.deleted AS owner_deleted
          FROM submissions s JOIN accounts a ON a.id = s.submitted_by`;
}

interface SubmissionRow {
  id: string; boat_code: string; dimension: string; value_mm: number; as_submitted: string;
  measured_on: string; note: string; status: string; submitted_at: Date;
  decided_at: Date | null; decided_by: string | null; reason: string | null;
  owner_email: string; owner_name: string; owner_deleted: boolean;
  [k: string]: unknown;
}

function submissionBody(r: SubmissionRow, role: Caller['role']): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    boat_code: r.boat_code,
    dimension: r.dimension,
    value_mm: r.value_mm,
    value_in: mmToInch2(r.value_mm),
    as_submitted: r.as_submitted,
    measured_on: r.measured_on,
    note: r.note,
    status: r.status,
    submitted_by: { email: r.owner_email, display_name: r.owner_deleted ? 'Former account' : r.owner_name },
    submitted_at: viewTs(r.submitted_at),
    decided_at: r.decided_at ? viewTs(r.decided_at) : null,
    reason: r.reason,
  };
  if (role !== 'yacht-owner') out['decided_by'] = r.decided_by;
  return out;
}

route('GET', '/api/submissions', SAILMAKER, async (req, res, ctx, caller) => {
  const status = req.query['status'];
  const rows = await ctx.db.query<SubmissionRow>(
    `${submissionSelect()} ${status ? 'WHERE s.status = $1' : ''} ORDER BY s.submitted_at DESC, s.id DESC`,
    status ? [String(status)] : [],
  );
  json(res, 200, { items: rows.map((r) => submissionBody(r, caller.role)), next_cursor: null, total: rows.length });
});

route('POST', '/api/submissions/:id/decision', SAILMAKER, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const body = bodyJson(req);
  const invalid = new Invalid();
  const decision = body['decision'];
  const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
  if (decision !== 'accept' && decision !== 'reject') invalid.add('decision', words.fields.decisionUnknown);
  if (decision === 'reject' && (!reason || countChars(reason) < 1)) invalid.add('reason', words.fields.reasonRequired);
  if (reason && countChars(reason) > 200) invalid.add('reason', words.fields.reasonTooLong);
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<{ id: string; status: string; boat_code: string; dimension: string; value_mm: number; measured_on: string }>(
      `SELECT id, status, boat_code, dimension, value_mm, measured_on FROM submissions WHERE id = $1 FOR UPDATE`, [id],
    );
    if (rows.length === 0 || rows[0]!.status !== 'pending') throw new Refusal(409, 'already_decided', words.errors.already_decided);
    const s = rows[0]!;
    if (decision === 'accept') {
      const mid = opaqueId('m');
      const ord = await db.query<{ n: number }>(`SELECT COALESCE(MAX(ord),0)+1 AS n FROM measurements WHERE boat_code=$1 AND dimension=$2`, [s.boat_code, s.dimension]);
      await db.query(
        `INSERT INTO measurements (id, boat_code, dimension, value_mm, measured_on, source, submission_id, recorded_at, ord)
         VALUES ($1,$2,$3,$4,$5,'submission',$6,now(),$7)`,
        [mid, s.boat_code, s.dimension, s.value_mm, s.measured_on, s.id, ord[0]!.n],
      );
      await db.query(`UPDATE submissions SET status='accepted', decided_at=now(), decided_by=$1, reason=null, measurement_id=$2 WHERE id=$3`, [caller.email, mid, id]);
    } else {
      await db.query(`UPDATE submissions SET status='rejected', decided_at=now(), decided_by=$1, reason=$2 WHERE id=$3`, [caller.email, reason, id]);
    }
    await audit(db, caller.email, decision === 'accept' ? 'submission.accept' : 'submission.reject', id, 'pending', decision, reason || null);
    if (decision === 'accept') await stepBackDrawings(db, s.boat_code);
  });
  const rows = await ctx.db.query<SubmissionRow>(`${submissionSelect()} WHERE s.id = $1`, [id]);
  json(res, 200, submissionBody(rows[0]!, caller.role));
});

route('POST', '/api/submissions/:id/reverse', SAILMAKER, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const body = bodyJson(req);
  const invalid = new Invalid();
  const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
  if (!reason || countChars(reason) < 1) invalid.add('reason', words.fields.reasonRequired);
  if (reason && countChars(reason) > 200) invalid.add('reason', words.fields.reasonTooLong);
  invalid.throwIfAny();
  const boatCode = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<{ id: string; status: string; boat_code: string; measurement_id: string | null }>(
      `SELECT id, status, boat_code, measurement_id FROM submissions WHERE id = $1 FOR UPDATE`, [id],
    );
    if (rows.length === 0 || rows[0]!.status !== 'accepted') throw new Refusal(409, 'not_accepted', words.errors.not_accepted);
    const s = rows[0]!;
    if (s.measurement_id) await db.query(`DELETE FROM measurements WHERE id = $1`, [s.measurement_id]);
    await db.query(`UPDATE submissions SET status='reversed', reason=$1 WHERE id=$2`, [reason, id]);
    await audit(db, caller.email, 'submission.reverse', id, 'accepted', 'reversed', reason);
    return s.boat_code;
  });
  await rederiveAfterMeasurementChange(ctx.db, boatCode);
  const rows = await ctx.db.query<SubmissionRow>(`${submissionSelect()} WHERE s.id = $1`, [id]);
  json(res, 200, submissionBody(rows[0]!, caller.role));
});

/** After a reversal removes a measurement, used drawings may need to step back. */
async function rederiveAfterMeasurementChange(db: DbClient, boatCode: string): Promise<void> {
  const drawn = await db.query<{ code: string }>(`SELECT code FROM drawings WHERE boat_code=$1 AND status IN ('drawn','nested')`, [boatCode]);
  for (const d of drawn) {
    const anyLay = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM measurements m WHERE m.boat_code=$1`, [boatCode],
    );
    void anyLay;
    await stepBackDrawings(db, boatCode);
    void d;
  }
}

route('POST', '/api/admin/submissions/decisions', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const decisions = body['decisions'];
  if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > 50) {
    throw new Refusal(422, 'invalid', words.errors.invalid, { decisions: words.fields.required });
  }
  const results: { id: string; outcome: 'applied' | 'refused'; reason: null | 'already_decided' | 'not_found' | 'reason_required' | 'invalid_decision'; status: string }[] = [];
  for (const item of decisions) {
    if (typeof item !== 'object' || item === null) { continue; }
    const rec = item as Record<string, unknown>;
    const id = typeof rec['id'] === 'string' ? rec['id'] : '';
    const decision = rec['decision'];
    const reason = typeof rec['reason'] === 'string' ? rec['reason'] : '';
    let outcome: 'applied' | 'refused' = 'refused';
    let refusalReason: 'already_decided' | 'not_found' | 'reason_required' | 'invalid_decision' | null = null;
    let status = '';
    if (decision !== 'accept' && decision !== 'reject') {
      refusalReason = 'invalid_decision';
      const rows = await ctx.db.query<{ status: string }>(`SELECT status FROM submissions WHERE id=$1`, [id]);
      status = rows[0]?.status ?? 'pending';
    } else {
      const applied = await applySingleDecision(ctx, caller, id, decision, reason);
      if (applied.ok) {
        outcome = 'applied';
        status = applied.status;
      } else {
        refusalReason = applied.reason;
        status = applied.status;
      }
    }
    results.push({ id, outcome, reason: refusalReason, status });
  }
  json(res, 200, { results });
});

interface DecisionOutcome { ok: boolean; reason: 'already_decided' | 'not_found' | 'reason_required' | null; status: string }

/** The owner request limit: counts kept in the database, so every instance shares them. */
async function rateLimit(ctx: Ctx, caller: Caller, kind: 'submission' | 'sheet_fetch'): Promise<void> {
  const limit = kind === 'submission' ? ctx.config.ownerSubmissionLimit : ctx.config.ownerSheetFetchLimit;
  const windowSeconds = ctx.config.ownerRateWindowSeconds;
  const cutoff = new Date(Date.now() - windowSeconds * 1000);
  await ctx.db.query(`DELETE FROM rate_counts WHERE at < $1`, [cutoff]);
  const rows = await ctx.db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM rate_counts WHERE account_id=$1 AND kind=$2 AND at > $3`,
    [caller.id, kind, cutoff],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    const oldest = await ctx.db.query<{ at: Date }>(
      `SELECT at FROM rate_counts WHERE account_id=$1 AND kind=$2 AND at > $3 ORDER BY at LIMIT 1`,
      [caller.id, kind, cutoff],
    );
    const until = oldest[0] ? oldest[0].at.getTime() + windowSeconds * 1000 : Date.now() + windowSeconds * 1000;
    const retry = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    throw new RateLimited(retry);
  }
  await ctx.db.query(`INSERT INTO rate_counts (account_id, kind, at) VALUES ($1,$2,now())`, [caller.id, kind]);
}

class RateLimited extends Refusal {
  constructor(readonly retryAfter: number) {
    super(429, 'rate_limited', fill(words.errors.rate_limited, { seconds: retryAfter }));
  }
}


async function applySingleDecision(ctx: Ctx, caller: Caller, id: string, decision: 'accept' | 'reject', reason: string): Promise<DecisionOutcome> {
  if (decision === 'reject' && (!reason || countChars(reason) < 1)) {
    const rows = await ctx.db.query<{ status: string }>(`SELECT status FROM submissions WHERE id=$1`, [id]);
    return { ok: false, reason: 'reason_required', status: rows[0]?.status ?? 'pending' };
  }
  try {
    return await inTransaction(ctx.db, async (db) => {
      const rows = await db.query<{ id: string; status: string; boat_code: string; dimension: string; value_mm: number; measured_on: string }>(
        `SELECT id, status, boat_code, dimension, value_mm, measured_on FROM submissions WHERE id = $1 FOR UPDATE`, [id],
      );
      if (rows.length === 0) return { ok: false, reason: 'not_found' as const, status: 'pending' };
      const s = rows[0]!;
      if (s.status !== 'pending') return { ok: false, reason: 'already_decided' as const, status: s.status };
      if (decision === 'accept') {
        const mid = opaqueId('m');
        const ord = await db.query<{ n: number }>(`SELECT COALESCE(MAX(ord),0)+1 AS n FROM measurements WHERE boat_code=$1 AND dimension=$2`, [s.boat_code, s.dimension]);
        await db.query(
          `INSERT INTO measurements (id, boat_code, dimension, value_mm, measured_on, source, submission_id, recorded_at, ord)
           VALUES ($1,$2,$3,$4,$5,'submission',$6,now(),$7)`,
          [mid, s.boat_code, s.dimension, s.value_mm, s.measured_on, s.id, ord[0]!.n],
        );
        await db.query(`UPDATE submissions SET status='accepted', decided_at=now(), decided_by=$1, reason=null, measurement_id=$2 WHERE id=$3`, [caller.email, mid, id]);
      } else {
        await db.query(`UPDATE submissions SET status='rejected', decided_at=now(), decided_by=$1, reason=$2 WHERE id=$3`, [caller.email, reason, id]);
      }
      await audit(db, caller.email, decision === 'accept' ? 'submission.accept' : 'submission.reject', id, 'pending', decision, reason || null);
      if (decision === 'accept') await stepBackDrawings(db, s.boat_code);
      return { ok: true, reason: null, status: decision };
    });
  } catch {
    return { ok: false, reason: 'not_found', status: 'pending' };
  }
}

// ---------------------------------------------------------------------------
// Drawings

interface DrawingRow {
  code: string; boat_code: string; sail: 'mainsail' | 'headsail'; cloth_code: string; status: string;
  ruleset_version: number | null; assigned_to: string | null; luff_mm: number | null; foot_mm: number | null;
  area_mm2: number | null; draw_boat_name: string | null; draw_owner_name: string | null; draw_dims: unknown;
  panels: unknown; predecessor: string | null; successor: string | null;
  cut_sheet_sha256: string | null; cut_sheet_size: number | null; cut_sheet_key: string | null;
  [k: string]: unknown;
}

async function drawingRow(db: DbClient, code: string): Promise<DrawingRow | null> {
  const rows = await db.query<DrawingRow>(`SELECT * FROM drawings WHERE code = $1`, [code]);
  return rows[0] ?? null;
}

async function drawingVisible(db: DbClient, caller: Caller, code: string): Promise<boolean> {
  if (caller.role === 'sailmaker') return true;
  if (caller.role === 'loft-hand') {
    const rows = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM drawings WHERE code=$1 AND assigned_to=$2`, [code, caller.id]);
    return (rows[0]?.n ?? 0) > 0;
  }
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM grants g WHERE g.drawing_code=$1 AND g.owner_id=$2
     AND g.status='granted' AND (g.ends_at IS NULL OR g.ends_at > now())`,
    [code, caller.id],
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function drawingLot(db: DbClient, code: string): Promise<string | null> {
  const rows = await db.query<{ lot: string }>(
    `SELECT s.lot FROM claims c JOIN stock s ON s.code=c.stock_code
     WHERE c.drawing_code=$1 AND c.status IN ('held','cut') ORDER BY c.taken_at LIMIT 1`, [code],
  );
  return rows[0]?.lot ?? null;
}

async function drawingBody(db: DbClient, caller: Caller, d: DrawingRow): Promise<Record<string, unknown>> {
  const boat = await boatRow(db, d.boat_code);
  const assigned = d.assigned_to ? await accountRef(db, d.assigned_to) : null;
  const panels = (d.panels as PanelShape[] | null) ?? [];
  const laid = await db.query<{ panel_number: number; rotation: number; x_mm: number; y_mm: number; claim_id: string; stock_code: string; status: string; expires_at: Date }>(
    `SELECT l.panel_number, l.rotation, l.x_mm, l.y_mm, c.id AS claim_id, c.stock_code, c.status, c.expires_at
     FROM lays l JOIN claims c ON c.id = l.claim_id WHERE c.drawing_code = $1 ORDER BY l.panel_number`, [d.code],
  );
  const cutPanels = await db.query<{ panel_number: number; stock_code: string; x_mm: number; y_mm: number; rotation: number }>(
    `SELECT l.panel_number, c.stock_code, l.x_mm, l.y_mm, l.rotation
     FROM lays l JOIN claims c ON c.id = l.claim_id WHERE c.drawing_code = $1 AND c.status = 'cut'`, [d.code],
  );
  const cutNumbers = new Set(cutPanels.map((c) => c.panel_number));
  const cutByNumber = new Map(cutPanels.map((c) => [c.panel_number, c]));
  const lot = await drawingLot(db, d.code);
  const claimIds = await db.query<{ id: string }>(`SELECT id FROM claims WHERE drawing_code=$1 ORDER BY taken_at DESC`, [d.code]);
  const supersededBy = (await db.query<{ code: string }>(`SELECT code FROM drawings WHERE predecessor=$1 AND status='issued'`, [d.code]))[0]?.code ?? null;
  const area = d.area_mm2;
  const commonPanels = panels.map((p) => ({
    number: p.number,
    outline: p.outline,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    area_mm2: p.area_mm2,
    area_m2: mm2ToM2(p.area_mm2),
    area_ft2: mm2ToFt2(p.area_mm2),
    laid: null as { claim_id: string; stock_code: string; x_mm: number; y_mm: number; rotation: number } | null,
    cut: cutNumbers.has(p.number),
  }));
  if (caller.role !== 'yacht-owner') {
    for (const p of commonPanels) {
      const lay = laid.find((l) => l.panel_number === p.number && l.status === 'held' && l.expires_at.getTime() > Date.now());
      const cut = cutByNumber.get(p.number);
      const placement = cut
        ? { claim_id: '', stock_code: cut.stock_code, x_mm: cut.x_mm, y_mm: cut.y_mm, rotation: cut.rotation }
        : lay
          ? { claim_id: lay.claim_id, stock_code: lay.stock_code, x_mm: lay.x_mm, y_mm: lay.y_mm, rotation: lay.rotation }
          : null;
      p.laid = placement;
    }
  }
  const areaBody = area === null ? null : {
    area_mm2: area, area_m2: mm2ToM2(area), area_ft2: mm2ToFt2(area),
    basis: (d.draw_dims as { basis?: string }[] | null)?.[0]?.['basis'] ?? basisOf(d),
  };
  const out: Record<string, unknown> = {
    code: d.code,
    boat_code: d.boat_code,
    boat_name: boat?.name ?? '',
    sail: d.sail,
    cloth_code: d.cloth_code,
    lot,
    status: d.status,
    step: stepOf(d, panels, cutNumbers),
    ruleset_version: d.ruleset_version,
    assigned_to: assigned ? { email: assigned.email_norm, display_name: assigned.deleted ? 'Former account' : assigned.display_name } : null,
    luff_mm: d.luff_mm,
    foot_mm: d.foot_mm,
    area: areaBody,
    panels: commonPanels,
    claim_ids: claimIds.map((c) => c.id),
    cut_sheet: d.cut_sheet_sha256
      ? { sha256: d.cut_sheet_sha256, size: d.cut_sheet_size, key: caller.role === 'yacht-owner' ? undefined : d.cut_sheet_key, superseded_by: supersededBy }
      : null,
    predecessor: d.predecessor,
    successor: d.successor,
  };
  if (caller.role === 'yacht-owner') {
    const ownerOut: Record<string, unknown> = {
      code: out['code'], boat_code: out['boat_code'], boat_name: out['boat_name'], sail: out['sail'],
      status: out['status'], area: out['area'], panels: panels.map((p) => ({
        number: p.number, outline: p.outline, length_mm: p.length_mm, width_mm: p.width_mm,
        area_mm2: p.area_mm2, area_m2: mm2ToM2(p.area_mm2), area_ft2: mm2ToFt2(p.area_mm2), cut: cutNumbers.has(p.number),
      })),
      cut_sheet: d.cut_sheet_sha256 ? { sha256: d.cut_sheet_sha256, size: d.cut_sheet_size, superseded_by: supersededBy } : null,
      predecessor: d.predecessor, successor: d.successor,
    };
    return ownerOut;
  }
  return out;
}

function basisOf(d: DrawingRow): string {
  if (!d.ruleset_version) return '';
  const dims = Array.isArray(d.draw_dims) ? d.draw_dims as { key?: string; basis?: string }[] : [];
  const stored = dims.find((x) => x.basis);
  if (stored?.basis) return stored.basis;
  return d.sail === 'mainsail' ? `P × E / 2 × 1.120 · tolerance ±20 mm · rule set v${d.ruleset_version}` : `LP × LL / 2 · tolerance ±20 mm · rule set v${d.ruleset_version}`;
}

function stepOf(d: DrawingRow, panels: PanelShape[], cutNumbers: Set<number>): string {
  if (d.status === 'remeasure') return 'measure';
  if (panels.length === 0) return 'draw';
  const uncut = panels.filter((p) => !cutNumbers.has(p.number));
  if (uncut.length === 0) return 'confirm';
  void uncut;
  return 'nest';
}

route('GET', '/api/drawings', ALL, async (req, res, ctx, caller) => {
  const status = req.query['status'];
  const boat = req.query['boat'];
  let rows: DrawingRow[];
  if (caller.role === 'sailmaker') {
    rows = await ctx.db.query(`SELECT * FROM drawings WHERE ($1='' OR status=$1) AND ($2='' OR boat_code=$2) ORDER BY code DESC`, [status ? String(status) : '', boat ? String(boat) : '']);
  } else if (caller.role === 'loft-hand') {
    rows = await ctx.db.query(`SELECT * FROM drawings WHERE assigned_to=$1 AND ($2='' OR status=$2) AND ($3='' OR boat_code=$3) ORDER BY code DESC`, [caller.id, status ? String(status) : '', boat ? String(boat) : '']);
  } else {
    rows = await ctx.db.query(
      `SELECT d.* FROM drawings d JOIN grants g ON g.drawing_code=d.code
       WHERE g.owner_id=$1 AND g.status='granted' AND (g.ends_at IS NULL OR g.ends_at > now())
       AND ($2='' OR d.status=$2) AND ($3='' OR d.boat_code=$3) ORDER BY d.code DESC`,
      [caller.id, status ? String(status) : '', boat ? String(boat) : ''],
    );
  }
  const items: Record<string, unknown>[] = [];
  for (const d of rows) items.push(await drawingBody(ctx.db, caller, d));
  json(res, 200, { items, next_cursor: null, total: items.length });
});

route('GET', '/api/drawings/:code', ALL, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  if (!(await drawingVisible(ctx.db, caller, code))) throw notFoundRefusal();
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  json(res, 200, await drawingBody(ctx.db, caller, d));
});

route('POST', '/api/drawings', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const boatCode = typeof body['boat_code'] === 'string' ? body['boat_code'] : '';
  const sail = body['sail'];
  const clothCode = typeof body['cloth_code'] === 'string' ? body['cloth_code'] : '';
  if (!boatCode) invalid.add('boat_code', words.fields.required);
  else {
    const b = await boatRow(ctx.db, boatCode);
    if (!b) invalid.add('boat_code', words.fields.boatUnknown);
  }
  if (sail !== 'mainsail' && sail !== 'headsail') invalid.add('sail', words.fields.sailUnknown);
  if (!clothCode) invalid.add('cloth_code', words.fields.required);
  else {
    const rows = await ctx.db.query<{ code: string }>(`SELECT code FROM cloths WHERE code=$1`, [clothCode]);
    if (rows.length === 0) invalid.add('cloth_code', words.fields.clothUnknown);
  }
  invalid.throwIfAny();
  const status = await boatUsedDimensionsFlagged(ctx.db, boatCode, sail as string);
  const code = await inTransaction(ctx.db, async (db) => {
    const c = await nextCode(db, 'drawing', 'BR-', 4);
    await db.query(
      `INSERT INTO drawings (code, boat_code, sail, cloth_code, status, ruleset_version, created_at)
       VALUES ($1,$2,$3,$4,$5,null,now())`,
      [c, boatCode, sail, clothCode, status],
    );
    await audit(db, caller.email, 'drawing.create', c, null, { status }, null);
    return c;
  });
  const d = await drawingRow(ctx.db, code);
  json(res, 201, await drawingBody(ctx.db, caller, d!));
});

/** True when any dimension used by this sail is flagged Remeasure. */
async function boatUsedDimensionsFlagged(db: DbClient, boatCode: string, sail: string): Promise<'measuring' | 'remeasure'> {
  const rules = await currentRuleset(db);
  const used = sail === 'mainsail' ? ['P', 'E'] : ['LL', 'LP'];
  for (const dim of used) {
    const rows = await db.query<{ value_mm: number; ord: number }>(
      `SELECT value_mm, ord FROM measurements WHERE boat_code=$1 AND dimension=$2 ORDER BY ord`, [boatCode, dim],
    );
    if (rows.length >= 2) {
      const latest = rows[rows.length - 1]!;
      const previous = rows[rows.length - 2]!;
      if (Math.abs(latest.value_mm - previous.value_mm) > rules.tolerance_mm) return 'remeasure';
    }
  }
  return 'measuring';
}

route('POST', '/api/drawings/:code/draw', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status === 'pending_store' || d.status === 'issued') throw new Refusal(409, 'sealed', words.errors.sealed);
  const flagged = await boatUsedDimensionsFlagged(ctx.db, d.boat_code, d.sail);
  if (flagged === 'remeasure') throw new Refusal(409, 'remeasure_required', words.errors.remeasure_required);
  if (d.status === 'remeasure') {
    // The settling measurement has cleared the flag; the drawing moves to Measuring by itself.
    await ctx.db.query(`UPDATE drawings SET status='measuring' WHERE code=$1 AND status='remeasure'`, [code]);
  }
  if (d.status !== 'measuring' && d.status !== 'remeasure') throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  await inTransaction(ctx.db, async (db) => {
    const rules = await currentRuleset(db);
    const boat = await boatRow(db, d.boat_code);
    const owner = await accountRef(db, boat!.owner_id);
    const clothRows = await db.query<{ usable_width_mm: number; width_mm: number }>(
      `SELECT usable_width_mm, width_mm FROM cloths WHERE code=$1`, [d.cloth_code],
    );
    const usable = clothRows[0]!.usable_width_mm;
    const dims = await db.query<{ dimension: string; value_mm: number }>(
      `SELECT dimension, value_mm FROM measurements m
       WHERE m.boat_code=$1 AND m.ord = (SELECT MAX(m2.ord) FROM measurements m2 WHERE m2.boat_code=m.boat_code AND m2.dimension=m.dimension)`,
      [d.boat_code],
    );
    const dimMap = new Map(dims.map((x) => [x.dimension, x.value_mm]));
    const luff = d.sail === 'mainsail' ? dimMap.get('P')! : dimMap.get('LL')!;
    const foot = d.sail === 'mainsail' ? dimMap.get('E')! : dimMap.get('LP')!;
    const panels = crosscutPanels(luff, foot, usable, rules.seam_overlap_mm);
    const area = sailArea(d.sail, { P: dimMap.get('P')!, E: dimMap.get('E')!, LL: dimMap.get('LL')!, LP: dimMap.get('LP')! }, rules.roach_permille);
    const usedDims = d.sail === 'mainsail'
      ? [{ key: 'P', value_mm: dimMap.get('P')! }, { key: 'E', value_mm: dimMap.get('E')! }]
      : [{ key: 'LL', value_mm: dimMap.get('LL')! }, { key: 'LP', value_mm: dimMap.get('LP')! }];
    const basis = d.sail === 'mainsail'
      ? `P × E / 2 × ${(rules.roach_permille / 1000).toFixed(3)} · tolerance ±${rules.tolerance_mm} mm · rule set v${rules.version}`
      : `LP × LL / 2 · tolerance ±${rules.tolerance_mm} mm · rule set v${rules.version}`;
    await db.query(
      `UPDATE drawings SET status='drawn', ruleset_version=$1, luff_mm=$2, foot_mm=$3, area_mm2=$4,
       draw_boat_name=$5, draw_owner_name=$6, draw_dims=$7, panels=$8 WHERE code=$9`,
      [rules.version, luff, foot, area, boat!.name, owner.display_name, JSON.stringify([...usedDims, { basis }]), JSON.stringify(panels), code],
    );
    await audit(db, caller.email, 'drawing.draw', code, 'measuring', 'drawn', null);
  });
  const updated = await drawingRow(ctx.db, code);
  json(res, 200, await drawingBody(ctx.db, caller, updated!));
});

route('POST', '/api/drawings/:code/assign', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status === 'pending_store' || d.status === 'issued') throw new Refusal(409, 'sealed', words.errors.sealed);
  const body = bodyJson(req);
  const invalid = new Invalid();
  const email = typeof body['loft_hand_email'] === 'string' ? body['loft_hand_email'] : '';
  let loftHand: { id: string } | null = null;
  if (!email) invalid.add('loft_hand_email', words.fields.required);
  else {
    const rows = await ctx.db.query<{ id: string }>(
      `SELECT id FROM accounts WHERE email_norm=$1 AND role='loft-hand' AND deleted=false`, [normalizeEmail(email)],
    );
    loftHand = rows[0] ?? null;
    if (!loftHand) invalid.add('loft_hand_email', words.fields.loftHandEmail);
  }
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    await db.query(`UPDATE drawings SET assigned_to=$1 WHERE code=$2`, [loftHand!.id, code]);
    await audit(db, caller.email, 'drawing.assign', code, d.assigned_to ?? null, email, null);
  });
  const updated = await drawingRow(ctx.db, code);
  json(res, 200, await drawingBody(ctx.db, caller, updated!));
});

// ---------------------------------------------------------------------------
// Issue, revise, cut sheets, sail account, payments, grants

route('POST', '/api/drawings/:code/issue', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const outcome = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<DrawingRow>(`SELECT * FROM drawings WHERE code=$1 FOR UPDATE`, [code]);
    if (rows.length === 0) return 'not_found' as const;
    const d = rows[0]!;
    if (d.status === 'issued' || d.status === 'pending_store') return 'already_issued' as const;
    if (d.status !== 'cut') return 'wrong_state' as const;
    return 'ok' as const;
  });
  if (outcome === 'not_found') throw notFoundRefusal();
  if (outcome === 'already_issued') throw new Refusal(409, 'already_issued', words.errors.already_issued);
  if (outcome === 'wrong_state') throw new Refusal(409, 'wrong_state', words.errors.wrong_state);

  const d = (await drawingRow(ctx.db, code))!;
  const view = await liveDrawingView(ctx.db, d);
  const svg = renderCutSheet(view);
  const bytes = Buffer.from(svg, 'utf8');
  const sha = sha256Hex(bytes);
  const key = `cut-sheets/${code}/${sha}.svg`;
  let confirmed = false;
  try {
    const existing = await ctx.store.get(key);
    if (existing === null || existing.length !== bytes.length || sha256Hex(existing) !== sha) {
      confirmed = await ctx.store.putConfirmed(key, bytes, 'image/svg+xml', { sha256: sha });
    } else {
      confirmed = true;
    }
  } catch {
    confirmed = false;
  }
  await inTransaction(ctx.db, async (db) => {
    await db.query(
      `UPDATE drawings SET cut_sheet_sha256=$1, cut_sheet_size=$2, cut_sheet_key=$3, status=$4 WHERE code=$5`,
      [sha, bytes.length, key, confirmed ? 'issued' : 'pending_store', code],
    );
    await audit(db, caller.email, 'drawing.issue', code, 'cut', confirmed ? 'issued' : 'pending_store', null);
  });
  const updated = (await drawingRow(ctx.db, code))!;
  if (confirmed) {
    json(res, 200, await drawingBody(ctx.db, caller, updated));
  } else {
    json(res, 202, await drawingBody(ctx.db, caller, updated));
  }
});

/** The live cut-sheet view of a stored drawing, from values recorded at Draw and its cut nest. */
async function liveDrawingView(db: DbClient, d: DrawingRow): Promise<import('./seedrun.ts').SeedDrawingView> {
  const clothRows = await db.query<{ name: string; usable_width_mm: number; width_mm: number }>(
    `SELECT name, usable_width_mm, width_mm FROM cloths WHERE code=$1`, [d.cloth_code],
  );
  const cloth = clothRows[0]!;
  const rules = await currentRuleset(db);
  const pinned = d.ruleset_version ?? rules.version;
  const pinnedRows = await db.query<{ seam_overlap_mm: number; tolerance_mm: number; roach_permille: number }>(
    `SELECT seam_overlap_mm, tolerance_mm, roach_permille FROM rulesets WHERE version=$1`, [pinned],
  );
  const pinnedRules = pinnedRows[0] ?? rules;
  const dims = (Array.isArray(d.draw_dims) ? d.draw_dims : []) as { key: string; value_mm: number; basis?: string }[];
  const dimEntries = dims.filter((x) => x.key);
  const nests: { stock: string; used: number; width: number; lot: string; panelOutlines: [number, number][][] }[] = [];
  const cutClaims = await db.query<{ id: string; stock_code: string; length_mm: number; lot: string; width_mm: number }>(
    `SELECT c.id, c.stock_code, c.length_mm, s.lot, s.width_mm FROM claims c JOIN stock s ON s.code=c.stock_code WHERE c.drawing_code=$1 AND c.status='cut' ORDER BY c.taken_at`,
    [d.code],
  );
  const panels = (d.panels as PanelShape[] | null) ?? [];
  for (const c of cutClaims) {
    const lays = await db.query<{ panel_number: number; x_mm: number; y_mm: number; rotation: number }>(
      `SELECT panel_number, x_mm, y_mm, rotation FROM lays WHERE claim_id=$1 ORDER BY panel_number`, [c.id],
    );
    nests.push({
      stock: c.stock_code, used: c.length_mm, width: c.width_mm, lot: c.lot,
      panelOutlines: lays.map((l) => placedOutline(panels.find((p) => p.number === l.panel_number)!, l.x_mm, l.y_mm, l.rotation as 0 | 180) as [number, number][]),
    });
  }
  return {
    code: d.code,
    boatName: d.draw_boat_name ?? '',
    sail: d.sail,
    ownerName: d.draw_owner_name ?? '',
    clothCode: d.cloth_code,
    clothName: cloth.name,
    usableWidth: cloth.usable_width_mm,
    catalogueWidth: cloth.width_mm,
    rulesetVersion: pinned,
    dims: dimEntries.map((x) => ({ key: x.key, value_mm: x.value_mm })),
    areaMm2: d.area_mm2 ?? 0,
    panels,
    seamOverlap: pinnedRules.seam_overlap_mm,
    tolerance: pinnedRules.tolerance_mm,
    roach: pinnedRules.roach_permille,
    predecessor: d.predecessor,
    nests,
  };
}

route('GET', '/api/drawings/:code/cut-sheet/preview', SAILMAKER, async (req, res, ctx) => {
  const code = req.params['code'] as string;
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status === 'measuring' || d.status === 'remeasure' || d.status === 'drawn' || d.status === 'nested' || d.status === 'cutting') {
    throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  }
  const view = await liveDrawingView(ctx.db, d);
  const svg = renderCutSheet(view);
  const bytes = Buffer.from(svg, 'utf8');
  res.status(200);
  res.setHeader('content-type', 'image/svg+xml');
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('cache-control', 'private, no-store');
  res.end(bytes);
});

route('GET', '/api/cut-sheets/:sha256', SAILMAKER, async (req, res, ctx) => {
  const sha = req.params['sha256'] as string;
  const rows = await ctx.db.query<{ cut_sheet_key: string; code: string; successor: string | null; predecessor: string | null }>(
    `SELECT cut_sheet_key, code, successor, predecessor FROM drawings WHERE cut_sheet_sha256=$1`, [sha],
  );
  if (rows.length === 0 || !rows[0]!.cut_sheet_key) throw notFoundRefusal();
  const target = rows[0]!;
  let bytes: Buffer | null;
  try {
    bytes = await ctx.store.get(target.cut_sheet_key);
  } catch {
    throw new Refusal(503, 'store_unavailable', words.errors.store_owner);
  }
  if (!bytes) throw notFoundRefusal();
  const supersededBy = (await ctx.db.query<{ code: string }>(`SELECT code FROM drawings WHERE predecessor=$1 AND status='issued'`, [target.code]))[0]?.code ?? null;
  const supersedes = target.predecessor;
  res.status(200);
  res.setHeader('content-type', 'image/svg+xml');
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('cache-control', 'private, no-store');
  if (supersededBy) res.setHeader('boltrope-superseded-by', supersededBy);
  if (supersedes) res.setHeader('boltrope-supersedes', supersedes);
  res.end(bytes);
});

route('POST', '/api/drawings/:code/revise', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const result = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<DrawingRow>(`SELECT * FROM drawings WHERE code=$1 FOR UPDATE`, [code]);
    if (rows.length === 0) throw notFoundRefusal();
    const d = rows[0]!;
    if (d.successor) throw new Refusal(409, 'already_revised', words.errors.already_revised);
    if (d.status !== 'issued') throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
    const c = await nextCode(db, 'drawing', 'BR-', 4);
    await db.query(
      `INSERT INTO drawings (code, boat_code, sail, cloth_code, status, ruleset_version, predecessor, created_at)
       VALUES ($1,$2,$3,$4,'measuring',null,$5,now())`,
      [c, d.boat_code, d.sail, d.cloth_code, code],
    );
    await db.query(`UPDATE drawings SET successor=$1 WHERE code=$2`, [c, code]);
    await audit(db, caller.email, 'drawing.revise', c, code, null, null);
    return c;
  });
  const successor = await drawingRow(ctx.db, result);
  json(res, 201, await drawingBody(ctx.db, caller, successor!));
});

route('GET', '/api/drawings/:code/account', ALL, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  if (!(await drawingVisible(ctx.db, caller, code))) throw notFoundRefusal();
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status !== 'cut' && d.status !== 'pending_store' && d.status !== 'issued') {
    throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  }
  json(res, 200, await sailAccountBody(ctx.db, code, caller.role));
});

async function sailAccountBody(db: DbClient, code: string, role: Caller['role']): Promise<Record<string, unknown>> {
  const d = await drawingRow(db, code);
  const clothRows = await db.query<{ rate_pence_per_m2: number }>(`SELECT rate_pence_per_m2 FROM cloths WHERE code=$1`, [d!.cloth_code]);
  const rate = clothRows[0]!.rate_pence_per_m2;
  const area = d!.area_mm2 ?? 0;
  const charge = mulHalf(area, rate, 1_000_000);
  const tax = mulHalf(charge, 20, 100);
  const total = charge + tax;
  const deposit = mulHalf(total, 40, 100);
  const entries = await db.query<{ id: string; kind: string; amount_pence: number; at: Date; note: string | null; reason: string | null; recorded_by: string }>(
    `SELECT id, kind, amount_pence, at, note, reason, recorded_by FROM account_entries WHERE drawing_code=$1 ORDER BY at DESC, id DESC`, [code],
  );
  const paid = entries.filter((e) => e.kind === 'payment').reduce((s, e) => s + e.amount_pence, 0);
  const credited = entries.filter((e) => e.kind === 'credit_note').reduce((s, e) => s + e.amount_pence, 0);
  const balance = total - paid - credited;
  const status = paid + credited < deposit ? 'deposit_due' : balance === 0 ? 'settled' : 'balance_due';
  const entryBody = (e: typeof entries[number]): Record<string, unknown> => {
    const out: Record<string, unknown> = { id: e.id, kind: e.kind, amount_pence: e.amount_pence, at: viewTs(e.at), note: e.note, reason: e.reason };
    if (role !== 'yacht-owner') out['recorded_by'] = e.recorded_by;
    return out;
  };
  return {
    drawing_code: code,
    status,
    cloth_code: d!.cloth_code,
    rate_pence_per_m2: rate,
    area_mm2: area,
    charge_pence: charge,
    tax_rate_percent: 20,
    tax_pence: tax,
    total_pence: total,
    deposit_pence: deposit,
    paid_pence: paid,
    credited_pence: credited,
    balance_pence: balance,
    entries: entries.map(entryBody),
  };
}

route('POST', '/api/drawings/:code/payments', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const key = req.header('idempotency-key') ?? '';
  const body = bodyJson(req);
  const invalid = new Invalid();
  if (!key || key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) invalid.add('idempotency_key', words.fields.required);
  const amount = body['amount_pence'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) invalid.add('amount_pence', words.fields.badAmount);
  const note = typeof body['note'] === 'string' ? body['note'] : '';
  if (note && countChars(note) > 200) invalid.add('note', fill(words.fields.textLength, { min: 0, max: 200 }));
  invalid.throwIfAny();
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status !== 'cut' && d.status !== 'pending_store' && d.status !== 'issued') {
    throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  }
  const scope = `payment:${code}`;
  const replay = await idempotentReplay(ctx, key, scope);
  if (replay) { json(res, replay.status, replay.body); return; }
  const amountPence = amount as number;
  const result = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<DrawingRow>(`SELECT * FROM drawings WHERE code=$1 FOR UPDATE`, [code]);
    if (rows.length === 0) throw notFoundRefusal();
    const dd = rows[0]!;
    void dd;
    const existingKey = await db.query<{ scope: string }>(`SELECT scope FROM idempotency WHERE key=$1 AND scope<>$2`, [key, scope]);
    if (existingKey.length > 0) throw new Refusal(409, 'idempotency_key_reused', words.errors.idempotency_key_reused);
    const balance = await accountBalance(db, code);
    if (amountPence > balance) throw new Refusal(409, 'exceeds_balance', words.errors.exceeds_balance);
    const id = opaqueId('entry');
    await db.query(
      `INSERT INTO account_entries (id, drawing_code, kind, amount_pence, at, note, reason, recorded_by)
       VALUES ($1,$2,'payment',$3,now(),$4,null,$5)`,
      [id, code, amountPence, note, caller.email],
    );
    await audit(db, caller.email, 'payment.record', code, null, { amount_pence: amountPence }, null);
    const after = await accountBalance(db, code);
    return { status: 201, body: { ...(await sailAccountBody(db, code, caller.role)) } as Record<string, unknown>, balance: after };
  });
  await storeIdempotent(ctx, key, scope, result.status, result.body);
  json(res, result.status, result.body);
});

async function accountBalance(db: DbClient, code: string): Promise<number> {
  const d = await drawingRow(db, code);
  const clothRows = await db.query<{ rate_pence_per_m2: number }>(`SELECT rate_pence_per_m2 FROM cloths WHERE code=$1`, [d!.cloth_code]);
  const charge = mulHalf(d!.area_mm2 ?? 0, clothRows[0]!.rate_pence_per_m2, 1_000_000);
  const total = charge + mulHalf(charge, 20, 100);
  const entries = await db.query<{ kind: string; amount_pence: number }>(`SELECT kind, amount_pence FROM account_entries WHERE drawing_code=$1`, [code]);
  const paid = entries.filter((e) => e.kind === 'payment').reduce((s, e) => s + e.amount_pence, 0);
  const credited = entries.filter((e) => e.kind === 'credit_note').reduce((s, e) => s + e.amount_pence, 0);
  return total - paid - credited;
}

async function idempotentReplay(ctx: Ctx, key: string, scope: string): Promise<{ status: number; body: unknown } | null> {
  const rows = await ctx.db.query<{ status: number; body_text: string }>(`SELECT status, body_text FROM idempotency WHERE key=$1 AND scope=$2`, [key, scope]);
  if (rows.length === 0) return null;
  return { status: rows[0]!.status, body: JSON.parse(rows[0]!.body_text) as unknown };
}

async function storeIdempotent(ctx: Ctx, key: string, scope: string, status: number, body: unknown): Promise<void> {
  await ctx.db.query(`INSERT INTO idempotency (key, scope, status, body_text, created_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`, [key, scope, status, JSON.stringify(body)]);
}

route('POST', '/api/drawings/:code/credit-notes', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const body = bodyJson(req);
  const invalid = new Invalid();
  const amount = body['amount_pence'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) invalid.add('amount_pence', words.fields.badAmount);
  const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
  if (!reason || countChars(reason) < 1) invalid.add('reason', words.fields.reasonRequired);
  if (reason && countChars(reason) > 200) invalid.add('reason', words.fields.reasonTooLong);
  invalid.throwIfAny();
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status !== 'cut' && d.status !== 'pending_store' && d.status !== 'issued') {
    throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  }
  const amountPence = amount as number;
  const result = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<DrawingRow>(`SELECT * FROM drawings WHERE code=$1 FOR UPDATE`, [code]);
    if (rows.length === 0) throw notFoundRefusal();
    const balance = await accountBalance(db, code);
    if (amountPence > balance) throw new Refusal(409, 'exceeds_balance', words.errors.exceeds_balance);
    const id = opaqueId('entry');
    await db.query(
      `INSERT INTO account_entries (id, drawing_code, kind, amount_pence, at, note, reason, recorded_by)
       VALUES ($1,$2,'credit_note',$3,now(),null,$4,$5)`,
      [id, code, amountPence, reason, caller.email],
    );
    await audit(db, caller.email, 'credit_note.record', code, null, { amount_pence: amountPence }, reason);
    return { status: 201, body: (await sailAccountBody(db, code, caller.role)) as Record<string, unknown> };
  });
  json(res, result.status, result.body);
});

route('POST', '/api/drawings/:code/grants', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const body = bodyJson(req);
  const invalid = new Invalid();
  const ownerEmail = typeof body['owner_email'] === 'string' ? body['owner_email'] : '';
  const endsAtRaw = typeof body['ends_at'] === 'string' ? body['ends_at'] : '';
  let owner: { id: string } | null = null;
  if (!ownerEmail) invalid.add('owner_email', words.fields.required);
  else {
    const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM accounts WHERE email_norm=$1 AND role='yacht-owner' AND deleted=false`, [normalizeEmail(ownerEmail)]);
    owner = rows[0] ?? null;
    if (!owner) invalid.add('owner_email', words.fields.ownerEmail);
  }
  const endsAt = endsAtRaw ? parseInstant(endsAtRaw) : null;
  if (endsAtRaw && (!endsAt || endsAt.getTime() <= Date.now())) invalid.add('ends_at', words.fields.badInstant);
  invalid.throwIfAny();
  const d = await drawingRow(ctx.db, code);
  if (!d) throw notFoundRefusal();
  if (d.status !== 'issued') throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  const id = await inTransaction(ctx.db, async (db) => {
    const g = await nextCode(db, 'grant', 'G-', 4);
    await db.query(
      `INSERT INTO grants (id, drawing_code, owner_id, status, granted_at, ends_at, withdrawn_at)
       VALUES ($1,$2,$3,'granted',now(),$4,null)`,
      [g, code, owner!.id, endsAt],
    );
    await audit(db, caller.email, 'grant.create', g, null, { drawing: code, owner: normalizeEmail(ownerEmail) }, null);
    return g;
  });
  json(res, 201, await grantBody(ctx.db, id));
});

async function grantBody(db: DbClient, id: string): Promise<Record<string, unknown>> {
  const rows = await db.query<{ id: string; drawing_code: string; owner_id: string; status: string; granted_at: Date; ends_at: Date | null; withdrawn_at: Date | null }>(
    `SELECT id, drawing_code, owner_id, status, granted_at, ends_at, withdrawn_at FROM grants WHERE id=$1`, [id],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const g = rows[0]!;
  const owner = await accountRef(db, g.owner_id);
  const ended = g.ends_at !== null && g.ends_at.getTime() <= Date.now();
  const status = g.status === 'withdrawn' || ended ? 'withdrawn' : 'granted';
  return {
    id: g.id,
    drawing_code: g.drawing_code,
    owner: { email: owner.email_norm, display_name: owner.deleted ? 'Former account' : owner.display_name },
    status,
    granted_at: viewTs(g.granted_at),
    ends_at: g.ends_at ? viewTs(g.ends_at) : null,
    withdrawn_at: (ended ? g.ends_at : g.withdrawn_at) ? viewTs((ended ? g.ends_at : g.withdrawn_at)!) : null,
  };
}

route('GET', '/api/drawings/:code/grants', SAILMAKER, async (req, res, ctx) => {
  const code = req.params['code'] as string;
  const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM grants WHERE drawing_code=$1 ORDER BY granted_at DESC`, [code]);
  const items: Record<string, unknown>[] = [];
  for (const g of rows) items.push(await grantBody(ctx.db, g.id));
  json(res, 200, { items, next_cursor: null, total: items.length });
});

route('POST', '/api/grants/:id/withdraw', SAILMAKER, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const result = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<{ id: string; status: string; ends_at: Date | null }>(`SELECT id, status, ends_at FROM grants WHERE id=$1 FOR UPDATE`, [id]);
    if (rows.length === 0) throw notFoundRefusal();
    const g = rows[0]!;
    const ended = g.ends_at !== null && g.ends_at.getTime() <= Date.now();
    if (g.status === 'withdrawn' || ended) throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
    await db.query(`UPDATE grants SET status='withdrawn', withdrawn_at=now() WHERE id=$1`, [id]);
    await audit(db, caller.email, 'grant.withdraw', id, 'granted', 'withdrawn', null);
    return id;
  });
  json(res, 200, await grantBody(ctx.db, result));
});

route('GET', '/api/grants/:id', ALL, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const rows = await ctx.db.query<{ owner_id: string; status: string; ends_at: Date | null }>(
    `SELECT owner_id, status, ends_at FROM grants WHERE id=$1`, [id],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const g = rows[0]!;
  const ended = g.ends_at !== null && g.ends_at.getTime() <= Date.now();
  const active = g.status === 'granted' && !ended;
  if (caller.role === 'yacht-owner') {
    if (g.owner_id !== caller.id || !active) throw notFoundRefusal();
  }
  json(res, 200, await grantBody(ctx.db, id));
});

route('GET', '/api/my/cut-sheets', ['yacht-owner'], async (_req, res, ctx, caller) => {
  const rows = await ctx.db.query<{ id: string }>(
    `SELECT id FROM grants WHERE owner_id=$1 AND status='granted' AND (ends_at IS NULL OR ends_at > now()) ORDER BY granted_at DESC`,
    [caller.id],
  );
  const items: Record<string, unknown>[] = [];
  for (const g of rows) items.push(await grantBody(ctx.db, g.id));
  json(res, 200, { items, next_cursor: null, total: items.length });
});

route('GET', '/api/grants/:id/cut-sheet', ['yacht-owner'], async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const rows = await ctx.db.query<{ owner_id: string; status: string; ends_at: Date | null; drawing_code: string }>(
    `SELECT owner_id, status, ends_at, drawing_code FROM grants WHERE id=$1`, [id],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const g = rows[0]!;
  const ended = g.ends_at !== null && g.ends_at.getTime() <= Date.now();
  if (g.owner_id !== caller.id || g.status !== 'granted' || ended) throw notFoundRefusal();
  const d = await drawingRow(ctx.db, g.drawing_code);
  if (!d || !d.cut_sheet_key) throw notFoundRefusal();
  await rateLimit(ctx, caller, 'sheet_fetch');
  let bytes: Buffer | null;
  try {
    bytes = await ctx.store.get(d.cut_sheet_key);
  } catch {
    throw new Refusal(503, 'store_unavailable', words.errors.store_owner);
  }
  if (!bytes) throw notFoundRefusal();
  const supersededBy = (await ctx.db.query<{ code: string }>(`SELECT code FROM drawings WHERE predecessor=$1 AND status='issued'`, [d.code]))[0]?.code ?? null;
  res.status(200);
  res.setHeader('content-type', 'image/svg+xml');
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('cache-control', 'private, no-store');
  if (supersededBy) res.setHeader('boltrope-superseded-by', supersededBy);
  if (d.predecessor) res.setHeader('boltrope-supersedes', d.predecessor);
  res.end(bytes);
});

// ---------------------------------------------------------------------------
// Stock, claims, lays, cut, counts, authorities

route('GET', '/api/stock', SAILMAKER_LOFT_HAND, async (req, res, ctx) => {
  const kind = req.query['kind'];
  let rows: { code: string }[];
  if (kind) rows = await ctx.db.query<{ code: string }>(`SELECT code FROM stock WHERE kind=$1 ORDER BY code`, [String(kind)]);
  else rows = await ctx.db.query<{ code: string }>(`SELECT code FROM stock ORDER BY code`);
  const items: Record<string, unknown>[] = [];
  for (const r of rows) items.push(await stockBody(ctx.db, r.code));
  json(res, 200, { items, next_cursor: null, total: items.length });
});

async function stockBody(db: DbClient, code: string): Promise<Record<string, unknown>> {
  const rows = await db.query<StockRow>(
    `SELECT code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, last_counted_mm, last_counted_at, revision FROM stock WHERE code=$1`,
    [code],
  );
  const s = rows[0]!;
  const { free } = await freeMm(db, code);
  const afterLaid = await afterLaidMmForBody(db, code);
  return stockView(s, free, afterLaid);
}

/** after_laid_mm: the item's remaining length less the used lengths of its live held claims. */
async function afterLaidMmForBody(db: DbClient, stockCode: string): Promise<number> {
  const claims = await db.query<{ id: string; drawing_code: string }>(
    `SELECT id, drawing_code FROM claims WHERE stock_code=$1 AND status='held' AND expires_at > now()`,
    [stockCode],
  );
  const stockRow = await db.query<{ remaining_mm: number }>(`SELECT remaining_mm FROM stock WHERE code=$1`, [stockCode]);
  let usedTotal = 0;
  for (const claim of claims) {
    const lays = await db.query<{ x_mm: number; panel_number: number }>(
      `SELECT x_mm, panel_number FROM lays WHERE claim_id=$1`, [claim.id],
    );
    const drawing = await db.query<{ panels: unknown }>(`SELECT panels FROM drawings WHERE code=$1`, [claim.drawing_code]);
    const panels = (drawing[0]?.panels as { number: number; length_mm: number }[] | null) ?? [];
    for (const lay of lays) {
      const panel = panels.find((p) => p.number === lay.panel_number);
      usedTotal = Math.max(usedTotal, lay.x_mm + (panel?.length_mm ?? 0));
    }
  }
  return stockRow[0]!.remaining_mm - usedTotal;
}

route('GET', '/api/stock/summary', SAILMAKER_LOFT_HAND, async (_req, res, ctx) => {
  const rolls = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stock WHERE kind='roll'`);
  const offcuts = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stock WHERE kind='offcut' AND remaining_mm > 0`);
  const onHand = await ctx.db.query<{ total: string }>(`SELECT COALESCE(SUM(on_hand_mm2),0) AS total FROM stock`);
  const total = Number(onHand[0]!.total);
  json(res, 200, {
    rolls: rolls[0]!.n,
    offcuts: offcuts[0]!.n,
    on_hand_mm2: total,
    on_hand_m2: mm2ToM2(total),
    on_hand_ft2: mm2ToFt2(total),
  });
});

route('GET', '/api/stock/:code', SAILMAKER_LOFT_HAND, async (req, res, ctx) => {
  const code = req.params['code'] as string;
  const rows = await ctx.db.query<{ code: string; revision: number }>(`SELECT code, revision FROM stock WHERE code=$1`, [code]);
  if (rows.length === 0) throw notFoundRefusal();
  res.setHeader('etag', `"${rows[0]!.revision}"`);
  json(res, 200, await stockBody(ctx.db, code));
});

route('POST', '/api/rolls', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const clothCode = typeof body['cloth_code'] === 'string' ? body['cloth_code'] : '';
  const lot = typeof body['lot'] === 'string' ? body['lot'] : '';
  const lengthMm = body['length_mm'];
  const shelf = typeof body['shelf_location'] === 'string' ? body['shelf_location'] : '';
  if (!clothCode) invalid.add('cloth_code', words.fields.required);
  else {
    const rows = await ctx.db.query<{ code: string }>(`SELECT code FROM cloths WHERE code=$1`, [clothCode]);
    if (rows.length === 0) invalid.add('cloth_code', words.fields.clothUnknown);
  }
  if (!lot) invalid.add('lot', words.fields.required);
  else if (!validLot(lot)) invalid.add('lot', words.fields.lotRange);
  if (typeof lengthMm !== 'number' || !Number.isInteger(lengthMm) || lengthMm < 1 || lengthMm > 60000) invalid.add('length_mm', words.fields.lengthRange);
  if (!shelf) invalid.add('shelf_location', words.fields.required);
  else if (countChars(shelf) < 1 || countChars(shelf) > 40) invalid.add('shelf_location', fill(words.fields.textLength, { min: 1, max: 40 }));
  invalid.throwIfAny();
  const cloth = (await ctx.db.query<{ width_mm: number; usable_width_mm: number }>(`SELECT width_mm, usable_width_mm FROM cloths WHERE code=$1`, [clothCode]))[0]!;
  const length = lengthMm as number;
  const code = await inTransaction(ctx.db, async (db) => {
    const c = await nextCode(db, 'roll', 'R-', 2);
    await db.query(
      `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, revision, created_at)
       VALUES ($1,'roll',$2,$3,$4,$5,$6,$7,$8,'',1,now())`,
      [c, clothCode, lot, cloth.width_mm, cloth.usable_width_mm, length, cloth.width_mm * length, shelf],
    );
    await postLedgerPair(db, {
      stockCode: c, drawing: '', actorEmail: caller.email, reason: 'Received, full roll',
      lines: [
        { account: c, amount: cloth.width_mm * length, stockCode: c },
        { account: 'supplier-receipt', amount: -(cloth.width_mm * length), stockCode: c },
      ],
    });
    await audit(db, caller.email, 'stock.receive', c, null, { lot, length_mm: length }, null);
    return c;
  });
  json(res, 201, await stockBody(ctx.db, code));
});

route('PATCH', '/api/stock/:code', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const rows = await ctx.db.query<StockRow & { revision: number }>(
    `SELECT code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, last_counted_mm, last_counted_at, revision FROM stock WHERE code=$1`, [code],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const target = rows[0]!;
  const ifMatch = req.header('if-match');
  if (!ifMatch) throw new Refusal(428, 'precondition_required', words.errors.precondition_required);
  if (ifMatch.replace(/"/g, '') !== String(target.revision)) throw new Refusal(412, 'stale_revision', words.errors.stale_revision);
  const body = bodyJson(req);
  const invalid = new Invalid();
  const shelf = typeof body['shelf_location'] === 'string' ? body['shelf_location'] : '';
  const note = typeof body['note'] === 'string' ? body['note'] : '';
  if (!shelf) invalid.add('shelf_location', words.fields.required);
  else if (countChars(shelf) < 1 || countChars(shelf) > 40) invalid.add('shelf_location', fill(words.fields.textLength, { min: 1, max: 40 }));
  if (note && countChars(note) > 200) invalid.add('note', fill(words.fields.textLength, { min: 0, max: 200 }));
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    await db.query(`UPDATE stock SET shelf_location=$1, note=$2, revision=revision+1 WHERE code=$3`, [shelf, note, code]);
    await audit(db, caller.email, 'stock.update', code, { shelf_location: target.shelf_location }, { shelf_location: shelf }, null);
  });
  res.setHeader('etag', `"${target.revision + 1}"`);
  json(res, 200, await stockBody(ctx.db, code));
});

route('POST', '/api/stock/:code/counts', SAILMAKER, async (req, res, ctx, caller) => {
  const code = req.params['code'] as string;
  const rows = await ctx.db.query<StockRow>(
    `SELECT code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, last_counted_mm, last_counted_at, revision FROM stock WHERE code=$1`, [code],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const target = rows[0]!;
  const live = await ctx.db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE stock_code=$1 AND status='held' AND expires_at > now()`, [code],
  );
  if ((live[0]?.n ?? 0) > 0) throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  const body = bodyJson(req);
  const invalid = new Invalid();
  const counted = body['counted_length_mm'];
  const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
  if (typeof counted !== 'number' || !Number.isInteger(counted) || counted < 0 || counted > 60000) {
    invalid.add('counted_length_mm', fill(words.fields.wholeNumber, { min: 0, max: 60000 }));
  }
  const countedValue = typeof counted === 'number' ? counted : -1;
  if (countedValue !== target.remaining_mm && (!reason || countChars(reason) < 1)) {
    invalid.add('reason', words.fields.countReasonRequired);
  }
  if (reason && countChars(reason) > 200) invalid.add('reason', words.fields.reasonTooLong);
  invalid.throwIfAny();
  await inTransaction(ctx.db, async (db) => {
    if (countedValue !== target.remaining_mm) {
      const diff = countedValue - target.remaining_mm;
      const area = target.width_mm * diff;
      await postLedgerPair(db, {
        stockCode: code, drawing: '', actorEmail: caller.email, reason,
        lines: [
          { account: code, amount: area, stockCode: code },
          { account: 'count-adjustment', amount: -area, stockCode: code },
        ],
      });
      await db.query(`UPDATE stock SET remaining_mm=$1, on_hand_mm2=$2, revision=revision+1, last_counted_mm=$1, last_counted_at=now() WHERE code=$3`,
        [countedValue, target.width_mm * countedValue, code]);
    } else {
      await db.query(`UPDATE stock SET last_counted_mm=$1, last_counted_at=now() WHERE code=$2`, [countedValue, code]);
    }
    await audit(db, caller.email, 'stock.count', code, { remaining_mm: target.remaining_mm }, { remaining_mm: countedValue }, reason || null);
  });
  json(res, 200, await stockBody(ctx.db, code));
});

route('POST', '/api/claims', SAILMAKER_LOFT_HAND, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const stockCode = typeof body['stock_code'] === 'string' ? body['stock_code'] : '';
  const drawingCode = typeof body['drawing_code'] === 'string' ? body['drawing_code'] : '';
  const lengthMm = body['length_mm'];
  let stock: { code: string; cloth_code: string; lot: string; usable_width_mm: number } | null = null;
  if (!stockCode) invalid.add('stock_code', words.fields.required);
  else {
    const rows = await ctx.db.query<{ code: string; cloth_code: string; lot: string; usable_width_mm: number }>(
      `SELECT code, cloth_code, lot, usable_width_mm FROM stock WHERE code=$1`, [stockCode]);
    stock = rows[0] ?? null;
    if (!stock) invalid.add('stock_code', words.fields.stockUnknown);
  }
  let drawing: DrawingRow | null = null;
  if (!drawingCode) invalid.add('drawing_code', words.fields.required);
  else {
    const visible = await drawingVisible(ctx.db, caller, drawingCode);
    if (!visible) invalid.add('drawing_code', words.fields.drawingUnknown);
    else {
      const d = await drawingRow(ctx.db, drawingCode);
      if (!d) invalid.add('drawing_code', words.fields.drawingUnknown);
      else drawing = d;
    }
  }
  if (typeof lengthMm !== 'number' || !Number.isInteger(lengthMm) || lengthMm < 1 || lengthMm > 60000) invalid.add('length_mm', words.fields.lengthRange);
  invalid.throwIfAny();
  const length = lengthMm as number;
  if (caller.role === 'loft-hand') {
    if (drawing && drawing.assigned_to !== caller.id) throw new Refusal(403, 'no_cutting_authority', words.errors.no_cutting_authority);
    const authority = await ctx.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM authorities WHERE loft_hand_id=$1 AND withdrawn_at IS NULL AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())`,
      [caller.id],
    );
    if ((authority[0]?.n ?? 0) === 0) throw new Refusal(403, 'no_cutting_authority', words.errors.no_cutting_authority);
  }
  if (drawing!.status === 'pending_store' || drawing!.status === 'issued') throw new Refusal(409, 'sealed', words.errors.sealed);
  if (drawing!.status !== 'drawn' && drawing!.status !== 'nested' && drawing!.status !== 'cutting') {
    throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
  }
  if (stock!.cloth_code !== drawing!.cloth_code) {
    throw new Refusal(422, 'invalid', words.errors.invalid, { stock_code: words.fields.clothMismatch });
  }
  const pinnedLot = await drawingLot(ctx.db, drawingCode);
  if (pinnedLot !== null && stock!.lot !== pinnedLot) {
    throw new Refusal(422, 'invalid', words.errors.invalid, { stock_code: words.fields.lotMismatch });
  }
  const claimId = await inTransaction(ctx.db, async (db) => {
    await db.query(`SELECT code FROM stock WHERE code=$1 FOR UPDATE`, [stockCode]);
    const free = await freeMm(db, stockCode);
    const live = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM claims WHERE stock_code=$1 AND status='held' AND expires_at > now()`, [stockCode],
    );
    const hasLive = (live[0]?.n ?? 0) > 0;
    if (length > free.free) {
      if (hasLive) {
        const winner = await db.query<{ display_name: string; id: string }>(
          `SELECT a.display_name, c.id FROM claims c JOIN accounts a ON a.id=c.holder_id
           WHERE c.stock_code=$1 AND c.status='held' AND c.expires_at > now() ORDER BY c.taken_at DESC LIMIT 1`, [stockCode],
        );
        throw new Refusal(409, 'claim_conflict', fill('{winner} claimed this length first. Choose another roll or offcut.', { winner: winner[0]?.display_name ?? '' }),
          undefined, { display_name: winner[0]?.display_name ?? '', claim_id: winner[0]?.id ?? '' });
      }
      throw new Refusal(422, 'invalid', words.errors.invalid, { length_mm: fill(words.fields.claimTooLong, { code: stockCode }) });
    }
    const id = opaqueId('claim');
    const expires = new Date(Date.now() + ctx.config.claimHoldSeconds * 1000);
    await db.query(
      `INSERT INTO claims (id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at, cut_at)
       VALUES ($1,$2,$3,$4,$5,'held',now(),$6,null)`,
      [id, stockCode, drawingCode, caller.id, length, expires],
    );
    await audit(db, caller.email, 'claim.take', id, null, { stock: stockCode, drawing: drawingCode, length_mm: length }, null);
    return id;
  });
  const claim = (await ctx.db.query<ClaimRow>(
    `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [claimId],
  ))[0]!;
  const panels = (drawing!.panels as PanelShape[] | null) ?? [];
  json(res, 201, await claimView(ctx.db, claim, panels, stock!.usable_width_mm, false));
});

route('GET', '/api/claims/:id', SAILMAKER_LOFT_HAND, async (req, res, ctx) => {
  const id = req.params['id'] as string;
  const rows = await ctx.db.query<ClaimRow>(
    `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [id],
  );
  if (rows.length === 0) throw notFoundRefusal();
  const claim = rows[0]!;
  const d = await drawingRow(ctx.db, claim.drawing_code);
  if (!d) throw notFoundRefusal();
  const visible = callerOf(ctx, id);
  void visible;
  const stock = (await ctx.db.query<{ usable_width_mm: number }>(`SELECT usable_width_mm FROM stock WHERE code=$1`, [claim.stock_code]))[0]!;
  const panels = (d.panels as PanelShape[] | null) ?? [];
  const lapsing = claim.status === 'held' && claim.expires_at.getTime() <= Date.now();
  json(res, 200, await claimView(ctx.db, claim, panels, stock.usable_width_mm, lapsing));
});

function callerOf(ctx: Ctx, id: string): void {
  void ctx; void id;
}

route('POST', '/api/claims/:id/lays', SAILMAKER_LOFT_HAND, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const body = bodyJson(req);
  const invalid = new Invalid();
  const panelNumber = body['panel_number'] as number;
  const hasX = 'x_mm' in body;
  const hasY = 'y_mm' in body;
  const hasR = 'rotation' in body;
  const all = hasX && hasY && hasR;
  const none = !hasX && !hasY && !hasR;
  if (!all && !none) {
    throw new Refusal(422, 'invalid', words.errors.invalid, { position: words.fields.positionAllOrNone });
  }
  let x = 0, y = 0, rotation: number = 0;
  if (all) {
    x = body['x_mm'] as number;
    y = body['y_mm'] as number;
    rotation = body['rotation'] as number;
    if (typeof x !== 'number' || !Number.isInteger(x) || typeof y !== 'number' || !Number.isInteger(y)) {
      invalid.add('position', words.fields.positionAllOrNone);
    } else if (rotation !== 0 && rotation !== 180) {
      invalid.add('rotation', words.fields.badRotation);
    }
  }
  invalid.throwIfAny();
  const result = await inTransaction(ctx.db, async (db) => {
    const claimRows = await db.query<ClaimRow>(
      `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1 FOR UPDATE`, [id],
    );
    if (claimRows.length === 0) throw notFoundRefusal();
    const claim = claimRows[0]!;
    const d = await drawingRow(db, claim.drawing_code);
    if (!d) throw notFoundRefusal();
    const stock = (await db.query<{ usable_width_mm: number; cloth_code: string; lot: string }>(
      `SELECT usable_width_mm, cloth_code, lot FROM stock WHERE code=$1`, [claim.stock_code]))[0]!;
    const panels = (d.panels as PanelShape[] | null) ?? [];
    const panel = panels.find((p) => p.number === panelNumber);
    if (!panel) throw new Refusal(422, 'invalid', words.errors.invalid, { panel_number: words.fields.panelUnknown });
    if (claim.status === 'cut' || claim.status === 'released') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    if (claim.status === 'held' && claim.expires_at.getTime() <= Date.now()) throw new Refusal(409, 'claim_lapsed', words.errors.claim_lapsed);
    if (claim.status !== 'held') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    if (d.status === 'pending_store' || d.status === 'issued') throw new Refusal(409, 'sealed', words.errors.sealed);
    const existing = await db.query<{ panel_number: number; claim_id: string }>(
      `SELECT l.panel_number, l.claim_id FROM lays l JOIN claims c ON c.id=l.claim_id
       WHERE c.drawing_code=$1 AND c.status IN ('held','cut') AND l.panel_number=$2`,
      [claim.drawing_code, panelNumber],
    );
    if (existing.length > 0) throw new Refusal(409, 'panel_laid', fill(words.errors.panel_laid, { n: panelNumber }));
    const laidRows = await db.query<{ panel_number: number; x_mm: number; y_mm: number; rotation: number }>(
      `SELECT panel_number, x_mm, y_mm, rotation FROM lays WHERE claim_id=$1`, [id],
    );
    const laidOutlines = laidRows.map((l) => placedOutline(panels.find((p) => p.number === l.panel_number)!, l.x_mm, l.y_mm, l.rotation as 0 | 180));
    let chosenX = x, chosenY = y, chosenRotation = rotation as 0 | 180;
    if (!all) {
      const fit = firstFit(panel, claim.length_mm, stock.usable_width_mm, laidOutlines);
      if (!fit) throw new Refusal(422, 'invalid', words.errors.invalid, { position: fill(words.fields.panelOffCloth, { n: panelNumber }) });
      chosenX = fit.x; chosenY = fit.y; chosenRotation = fit.rotation;
    }
    const outline = placedOutline(panel, chosenX, chosenY, chosenRotation);
    const offCloth = outline.some((p) => p[0]! < 0 || p[0]! > claim.length_mm || p[1]! < 0 || p[1]! > stock.usable_width_mm);
    if (offCloth) throw new Refusal(422, 'invalid', words.errors.invalid, { position: fill(words.fields.panelOffCloth, { n: panelNumber }) });
    for (const other of laidOutlines) {
      if (outlinesOverlap(outline, other)) {
        const otherLay = laidRows[laidOutlines.indexOf(other)]!;
        throw new Refusal(409, 'lay_overlap', fill(words.errors.lay_overlap, { n: panelNumber, m: otherLay.panel_number }));
      }
    }
    await db.query(`INSERT INTO lays (claim_id, panel_number, x_mm, y_mm, rotation) VALUES ($1,$2,$3,$4,$5)`,
      [id, panelNumber, chosenX, chosenY, chosenRotation]);
    await audit(db, caller.email, 'claim.lay', id, null, { panel: panelNumber, x_mm: chosenX, y_mm: chosenY, rotation: chosenRotation }, null);
    // Derive the new drawing status: nested when every uncut panel is laid.
    const laidNow = await db.query<{ panel_number: number }>(
      `SELECT l.panel_number FROM lays l JOIN claims c ON c.id=l.claim_id WHERE c.drawing_code=$1 AND c.status IN ('held','cut')`, [claim.drawing_code],
    );
    const laidSet = new Set(laidNow.map((l) => l.panel_number));
    const allLaid = panels.every((p) => laidSet.has(p.number));
    if (allLaid && d.status === 'drawn') {
      await db.query(`UPDATE drawings SET status='nested' WHERE code=$1`, [claim.drawing_code]);
    }
    return { stock, drawing: claim.drawing_code };
  });
  const claim = (await ctx.db.query<ClaimRow>(
    `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [id],
  ))[0]!;
  const d = await drawingRow(ctx.db, result.drawing);
  const panels = (d!.panels as PanelShape[] | null) ?? [];
  json(res, 201, {
    claim: await claimView(ctx.db, claim, panels, result.stock.usable_width_mm, false),
    stock: await stockBody(ctx.db, result.stock.cloth_code ? claim.stock_code : claim.stock_code),
    drawing_status: d!.status,
  });
});

route('DELETE', '/api/claims/:id/lays/:panel', SAILMAKER_LOFT_HAND, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const panelNumber = Number(req.params['panel']);
  const result = await inTransaction(ctx.db, async (db) => {
    const claimRows = await db.query<ClaimRow>(
      `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1 FOR UPDATE`, [id],
    );
    if (claimRows.length === 0) throw notFoundRefusal();
    const claim = claimRows[0]!;
    if (claim.status === 'cut' || claim.status === 'released') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    if (claim.status === 'held' && claim.expires_at.getTime() <= Date.now()) throw new Refusal(409, 'claim_lapsed', words.errors.claim_lapsed);
    if (claim.status !== 'held') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    const lays = await db.query<{ panel_number: number }>(`SELECT panel_number FROM lays WHERE claim_id=$1 AND panel_number=$2`, [id, panelNumber]);
    if (lays.length === 0) throw notFoundRefusal();
    await db.query(`DELETE FROM lays WHERE claim_id=$1 AND panel_number=$2`, [id, panelNumber]);
    await audit(db, caller.email, 'claim.unlay', id, { panel: panelNumber }, null, null);
    const d = await drawingRow(db, claim.drawing_code);
    const panels = (d!.panels as PanelShape[] | null) ?? [];
    if (d!.status === 'nested' || d!.status === 'cutting') {
      await db.query(`UPDATE drawings SET status='cutting' WHERE code=$1 AND status='nested'`, [claim.drawing_code]);
      // In Cutting the drawing stays; a nested drawing steps back only when it is not cutting.
      const laidNow = await db.query<{ panel_number: number }>(
        `SELECT l.panel_number FROM lays l JOIN claims c ON c.id=l.claim_id WHERE c.drawing_code=$1 AND c.status IN ('held','cut')`, [claim.drawing_code],
      );
      const laidSet = new Set(laidNow.map((l) => l.panel_number));
      const allLaid = panels.every((p) => laidSet.has(p.number));
      if (!allLaid && d!.status === 'nested') {
        await db.query(`UPDATE drawings SET status='drawn' WHERE code=$1`, [claim.drawing_code]);
      }
    }
    const stock = (await db.query<{ usable_width_mm: number; cloth_code: string }>(
      `SELECT usable_width_mm, cloth_code FROM stock WHERE code=$1`, [claim.stock_code]))[0]!;
    return { drawing: claim.drawing_code, stock };
  });
  const claim = (await ctx.db.query<ClaimRow>(
    `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [id],
  ))[0]!;
  const d = await drawingRow(ctx.db, result.drawing);
  const panels = (d!.panels as PanelShape[] | null) ?? [];
  json(res, 200, {
    claim: await claimView(ctx.db, claim, panels, result.stock.usable_width_mm, false),
    stock: await stockBody(ctx.db, claim.stock_code),
    drawing_status: d!.status,
  });
});

route('POST', '/api/claims/:id/release', SAILMAKER_LOFT_HAND, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const result = await inTransaction(ctx.db, async (db) => {
    const claimRows = await db.query<ClaimRow>(
      `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1 FOR UPDATE`, [id],
    );
    if (claimRows.length === 0) throw notFoundRefusal();
    const claim = claimRows[0]!;
    if (claim.status === 'cut' || claim.status === 'released') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    if (claim.status === 'held' && claim.expires_at.getTime() <= Date.now()) throw new Refusal(409, 'claim_lapsed', words.errors.claim_lapsed);
    if (claim.status !== 'held') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
    await db.query(`DELETE FROM lays WHERE claim_id=$1`, [id]);
    await db.query(`UPDATE claims SET status='released' WHERE id=$1`, [id]);
    await audit(db, caller.email, 'claim.release', id, 'held', 'released', null);
    const d = await drawingRow(db, claim.drawing_code);
    if (d && (d.status === 'nested')) {
      const panels = (d.panels as PanelShape[] | null) ?? [];
      const laidNow = await db.query<{ panel_number: number }>(
        `SELECT l.panel_number FROM lays l JOIN claims c ON c.id=l.claim_id WHERE c.drawing_code=$1 AND c.status IN ('held','cut')`, [claim.drawing_code],
      );
      const laidSet = new Set(laidNow.map((l) => l.panel_number));
      if (!panels.every((p) => laidSet.has(p.number))) {
        await db.query(`UPDATE drawings SET status='drawn' WHERE code=$1`, [claim.drawing_code]);
      }
    }
    const stock = (await db.query<{ usable_width_mm: number }>(`SELECT usable_width_mm FROM stock WHERE code=$1`, [claim.stock_code]))[0]!;
    return { drawing: claim.drawing_code, usable: stock.usable_width_mm };
  });
  const claim = (await ctx.db.query<ClaimRow>(
    `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [id],
  ))[0]!;
  const d = await drawingRow(ctx.db, result.drawing);
  const panels = (d!.panels as PanelShape[] | null) ?? [];
  json(res, 200, await claimView(ctx.db, claim, panels, result.usable, false));
});

route('POST', '/api/claims/:id/cut', SAILMAKER_LOFT_HAND, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const key = req.header('idempotency-key');
  if (!key || key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new Refusal(422, 'invalid', words.errors.invalid, { idempotency_key: words.fields.required });
  }
  const scope = `cut:${id}`;
  const replay = await idempotentReplay(ctx, key, scope);
  if (replay) {
    if (replay.status === 409 && (replay.body as { error?: string }).error === 'idempotency_key_reused') {
      const other = await ctx.db.query<{ scope: string }>(`SELECT scope FROM idempotency WHERE key=$1 AND scope<>$2`, [key, scope]);
      if (other.length > 0) throw new Refusal(409, 'idempotency_key_reused', words.errors.idempotency_key_reused);
    } else {
      json(res, replay.status, replay.body);
      return;
    }
  }
  let outcome: { status: number; body: Record<string, unknown> };
  try {
    outcome = await inTransaction(ctx.db, async (db) => {
      const claimRows = await db.query<ClaimRow>(
        `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1 FOR UPDATE`, [id],
      );
      if (claimRows.length === 0) throw notFoundRefusal();
      const claim = claimRows[0]!;
      if (claim.status === 'cut') throw new Refusal(409, 'already_cut', words.errors.already_cut);
      if (claim.status === 'released') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
      if (claim.status === 'held' && claim.expires_at.getTime() <= Date.now()) throw new Refusal(409, 'claim_lapsed', words.errors.claim_lapsed);
      if (claim.status !== 'held') throw new Refusal(409, 'claim_closed', words.errors.claim_closed);
      const usedKey = await db.query<{ scope: string }>(`SELECT scope FROM idempotency WHERE key=$1 AND scope<>$2`, [key, scope]);
      if (usedKey.length > 0) throw new Refusal(409, 'idempotency_key_reused', words.errors.idempotency_key_reused);
      const d = await drawingRow(db, claim.drawing_code);
      if (!d) throw notFoundRefusal();
      if (caller.role === 'loft-hand') {
        const authority = await db.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM authorities WHERE loft_hand_id=$1 AND withdrawn_at IS NULL
           AND valid_from <= $2 AND (valid_until IS NULL OR valid_until > $2)`,
          [caller.id, claim.taken_at],
        );
        if ((authority[0]?.n ?? 0) === 0) throw new Refusal(403, 'no_authority_on_claim_date', words.errors.no_authority_on_claim_date);
      }
      const lays = await db.query<{ panel_number: number; x_mm: number; y_mm: number; rotation: number }>(
        `SELECT panel_number, x_mm, y_mm, rotation FROM lays WHERE claim_id=$1 ORDER BY panel_number`, [id],
      );
      if (lays.length === 0) throw new Refusal(409, 'claim_empty', words.errors.claim_empty);
      const panels = (d.panels as PanelShape[] | null) ?? [];
      const laidEverywhere = await db.query<{ panel_number: number }>(
        `SELECT l.panel_number FROM lays l JOIN claims c ON c.id=l.claim_id WHERE c.drawing_code=$1 AND c.status IN ('held','cut')`, [claim.drawing_code],
      );
      const laidSet = new Set(laidEverywhere.map((l) => l.panel_number));
      const uncut = panels.filter((p) => !laidSet.has(p.number) || lays.some((l) => l.panel_number === p.number));
      const allUncutLaid = panels.filter((p) => !laidSet.has(p.number)).every((p) => laidSet.has(p.number));
      if (!allUncutLaid) throw new Refusal(409, 'not_nested', words.errors.not_nested);
      void uncut;
      if (d.status !== 'nested' && d.status !== 'cutting') throw new Refusal(409, 'not_nested', words.errors.not_nested);
      // Take the whole length off the stock and post the pairs.
      const stock = (await db.query<StockRow & { revision: number }>(
        `SELECT code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, last_counted_mm, last_counted_at, revision FROM stock WHERE code=$1 FOR UPDATE`,
        [claim.stock_code]))[0]!;
      const L = claim.length_mm;
      const used = lays.reduce((m, l) => Math.max(m, l.x_mm + (panels.find((p) => p.number === l.panel_number)?.length_mm ?? 0)), 0);
      const tail = L - used;
      const rules = await currentRuleset(db);
      const pinnedRules = d.ruleset_version
        ? (await db.query<{ min_offcut_width_mm: number; min_offcut_length_mm: number }>(`SELECT min_offcut_width_mm, min_offcut_length_mm FROM rulesets WHERE version=$1`, [d.ruleset_version]))[0] ?? rules
        : rules;
      const makesOffcut = tail >= pinnedRules.min_offcut_length_mm && stock.width_mm >= pinnedRules.min_offcut_width_mm;
      const panelsArea = lays.reduce((s, l) => s + (panels.find((p) => p.number === l.panel_number)?.area_mm2 ?? 0), 0);
      let offcutCode: string | null = null;
      let offcutBody: Record<string, unknown> | null = null;
      const pairs: { pair_id: string; lines: unknown[] }[] = [];
      const newRemaining = stock.remaining_mm - L;
      await db.query(`UPDATE stock SET remaining_mm=$1, on_hand_mm2=$2, revision=revision+1 WHERE code=$3`,
        [newRemaining, stock.width_mm * newRemaining, stock.code]);
      const panelsPair = await postLedgerPair(db, {
        stockCode: stock.code, drawing: claim.drawing_code, actorEmail: caller.email, reason: 'Panels cut',
        lines: [
          { account: stock.code, amount: -panelsArea, stockCode: stock.code },
          { account: `panels ${claim.drawing_code}`, amount: panelsArea, stockCode: stock.code },
        ],
      });
      pairs.push({ pair_id: panelsPair.pairId, lines: panelsPair.lines });
      if (makesOffcut) {
        offcutCode = await nextCode(db, 'offcut', 'O-', 2);
        await db.query(
          `INSERT INTO stock (code, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location, note, revision, created_at)
           VALUES ($1,'offcut',$2,$3,$4,$5,$6,$7,'Offcut bin','',1,now())`,
          [offcutCode, stock.cloth_code, stock.lot, stock.width_mm, stock.usable_width_mm, tail, stock.width_mm * tail],
        );
        const offcutPair = await postLedgerPair(db, {
          stockCode: stock.code, drawing: claim.drawing_code, actorEmail: caller.email, reason: 'Offcut received',
          lines: [
            { account: stock.code, amount: -(stock.width_mm * tail), stockCode: stock.code },
            { account: offcutCode, amount: stock.width_mm * tail, stockCode: offcutCode },
          ],
        });
        pairs.push({ pair_id: offcutPair.pairId, lines: offcutPair.lines });
        offcutBody = await stockBody(db, offcutCode);
      }
      const waste = stock.width_mm * L - panelsArea - (makesOffcut ? stock.width_mm * tail : 0);
      if (waste > 0) {
        const wastePair = await postLedgerPair(db, {
          stockCode: stock.code, drawing: claim.drawing_code, actorEmail: caller.email, reason: 'Waste',
          lines: [
            { account: stock.code, amount: -waste, stockCode: stock.code },
            { account: 'waste', amount: waste, stockCode: stock.code },
          ],
        });
        pairs.push({ pair_id: wastePair.pairId, lines: wastePair.lines });
      }
      await db.query(`UPDATE claims SET status='cut', cut_at=now() WHERE id=$1`, [id]);
      // The drawing: every panel cut moves to Cut.
      const cutPanels = await db.query<{ panel_number: number }>(
        `SELECT l.panel_number FROM lays l JOIN claims c ON c.id=l.claim_id WHERE c.drawing_code=$1 AND c.status='cut'`, [claim.drawing_code],
      );
      const cutSet = new Set(cutPanels.map((c) => c.panel_number));
      let drawingStatus = d.status;
      if (panels.every((p) => cutSet.has(p.number))) {
        drawingStatus = 'cut';
      } else if (d.status === 'nested') {
        drawingStatus = 'cutting';
      }
      await db.query(`UPDATE drawings SET status=$1 WHERE code=$2`, [drawingStatus, claim.drawing_code]);
      await audit(db, caller.email, 'claim.cut', id, 'held', 'cut', null);
      const claimAfter = (await db.query<ClaimRow>(
        `SELECT id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at FROM claims WHERE id=$1`, [id]))[0]!;
      return {
        status: 200,
        body: {
          claim: await claimView(db, claimAfter, panels, stock.usable_width_mm, false),
          stock: await stockBody(db, stock.code),
          offcut: offcutBody,
          pairs,
          drawing_status: drawingStatus,
        } as Record<string, unknown>,
      };
    });
  } catch (err) {
    if (err instanceof Refusal && err.status >= 409) {
      await storeIdempotent(ctx, key, scope, err.status, err.failure.body);
    }
    throw err;
  }
  await storeIdempotent(ctx, key, scope, outcome.status, outcome.body);
  json(res, outcome.status, outcome.body);
});

route('GET', '/api/authorities', SAILMAKER, async (_req, res, ctx) => {
  const rows = await ctx.db.query<{ id: string; loft_hand_id: string; valid_from: Date; valid_until: Date | null; withdrawn_at: Date | null }>(
    `SELECT id, loft_hand_id, valid_from, valid_until, withdrawn_at FROM authorities ORDER BY valid_from DESC`,
  );
  const items: Record<string, unknown>[] = [];
  for (const a of rows) {
    const hand = await accountRef(ctx.db, a.loft_hand_id);
    const now = Date.now();
    const status = a.withdrawn_at ? 'ended' : a.valid_from.getTime() > now ? 'not_yet' : a.valid_until && a.valid_until.getTime() <= now ? 'ended' : 'in_force';
    items.push({
      id: a.id,
      loft_hand: { email: hand.email_norm, display_name: hand.display_name },
      valid_from: viewTs(a.valid_from),
      valid_until: a.valid_until ? viewTs(a.valid_until) : null,
      status,
    });
  }
  json(res, 200, { items, next_cursor: null, total: items.length });
});

route('POST', '/api/authorities', SAILMAKER, async (req, res, ctx, caller) => {
  const body = bodyJson(req);
  const invalid = new Invalid();
  const email = typeof body['loft_hand_email'] === 'string' ? body['loft_hand_email'] : '';
  const validFromRaw = typeof body['valid_from'] === 'string' ? body['valid_from'] : '';
  const validUntilRaw = typeof body['valid_until'] === 'string' ? body['valid_until'] : '';
  let hand: { id: string } | null = null;
  if (!email) invalid.add('loft_hand_email', words.fields.required);
  else {
    const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM accounts WHERE email_norm=$1 AND role='loft-hand' AND deleted=false`, [normalizeEmail(email)]);
    hand = rows[0] ?? null;
    if (!hand) invalid.add('loft_hand_email', words.fields.loftHandEmail);
  }
  const validFrom = validFromRaw ? parseInstant(validFromRaw) : null;
  if (!validFromRaw) invalid.add('valid_from', words.fields.required);
  else if (!validFrom || validFrom.getTime() <= Date.now()) invalid.add('valid_from', words.fields.badInstant);
  const validUntil = validUntilRaw ? parseInstant(validUntilRaw) : null;
  if (validUntilRaw && (!validUntil || validUntil.getTime() <= Date.now())) invalid.add('valid_until', words.fields.badInstant);
  invalid.throwIfAny();
  const id = await inTransaction(ctx.db, async (db) => {
    const aid = opaqueId('auth');
    await db.query(
      `INSERT INTO authorities (id, loft_hand_id, valid_from, valid_until, withdrawn_at) VALUES ($1,$2,$3,$4,null)`,
      [aid, hand!.id, validFrom, validUntil],
    );
    await audit(db, caller.email, 'authority.create', aid, null, { loft_hand: normalizeEmail(email) }, null);
    return aid;
  });
  const a = (await ctx.db.query<{ id: string; loft_hand_id: string; valid_from: Date; valid_until: Date | null; withdrawn_at: Date | null }>(
    `SELECT id, loft_hand_id, valid_from, valid_until, withdrawn_at FROM authorities WHERE id=$1`, [id]))[0]!;
  const ref = await accountRef(ctx.db, a.loft_hand_id);
  json(res, 201, {
    id: a.id,
    loft_hand: { email: ref.email_norm, display_name: ref.display_name },
    valid_from: viewTs(a.valid_from),
    valid_until: a.valid_until ? viewTs(a.valid_until) : null,
    status: 'not_yet',
  });
});

route('POST', '/api/authorities/:id/withdraw', SAILMAKER, async (req, res, ctx, caller) => {
  const id = req.params['id'] as string;
  const result = await inTransaction(ctx.db, async (db) => {
    const rows = await db.query<{ id: string; withdrawn_at: Date | null; valid_until: Date | null }>(
      `SELECT id, withdrawn_at, valid_until FROM authorities WHERE id=$1 FOR UPDATE`, [id],
    );
    if (rows.length === 0) throw notFoundRefusal();
    const a = rows[0]!;
    const ended = a.withdrawn_at !== null || (a.valid_until !== null && a.valid_until.getTime() <= Date.now());
    if (ended) throw new Refusal(409, 'wrong_state', words.errors.wrong_state);
    await db.query(`UPDATE authorities SET withdrawn_at=now() WHERE id=$1`, [id]);
    await audit(db, caller.email, 'authority.withdraw', id, 'in_force', 'ended', null);
    return id;
  });
  const a = (await ctx.db.query<{ id: string; loft_hand_id: string; valid_from: Date; valid_until: Date | null; withdrawn_at: Date | null }>(
    `SELECT id, loft_hand_id, valid_from, valid_until, withdrawn_at FROM authorities WHERE id=$1`, [result]))[0]!;
  const ref = await accountRef(ctx.db, a.loft_hand_id);
  json(res, 200, {
    id: a.id,
    loft_hand: { email: ref.email_norm, display_name: ref.display_name },
    valid_from: viewTs(a.valid_from),
    valid_until: a.valid_until ? viewTs(a.valid_until) : null,
    status: 'ended',
  });
});

// ---------------------------------------------------------------------------
// Ledger, reconciliation, CSV export, audit, standing

route('GET', '/api/ledger', SAILMAKER, async (req, res, ctx) => {
  const stock = typeof req.query['stock'] === 'string' && req.query['stock'] ? String(req.query['stock']) : '';
  const limitRaw = req.query['limit'];
  let limit = 20;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) throw new Refusal(422, 'invalid', words.errors.invalid, { limit: words.fields.wholeNumber.replace('{min}', '1').replace('{max}', '50') });
    limit = Math.min(n, 50);
  }
  const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : '';
  const filter = { stock };
  let after: { line_id: number } | null = null;
  if (cursor) {
    const parsed = cursorFilter(cursor);
    if (parsed === null) throw new Refusal(422, 'invalid', words.errors.invalid, { cursor: words.fields.cursorInvalid });
    if ((parsed['stock'] ?? '') !== stock) throw new Refusal(422, 'invalid', words.errors.invalid, { cursor: words.fields.cursorOtherFilter });
    const markerRow = await ctx.db.query<{ line_id: number }>(`SELECT line_id FROM ledger_line WHERE line_id=$1`, [Number(parsed['line_id'])]);
    if (markerRow.length === 0) throw new Refusal(422, 'invalid', words.errors.invalid, { cursor: words.fields.cursorInvalid });
    after = { line_id: Number(parsed['line_id']) };
  }
  const where = stock ? `WHERE stock_code=$1` : '';
  const params = stock ? [stock] : [];
  const rows = await ctx.db.query<{ line_id: number; pair_id: string; posted_at: Date; account: string; amount_mm2: string; stock_code: string; drawing_code: string; actor_email: string; reason: string }>(
    `SELECT line_id, pair_id, posted_at, account, amount_mm2, stock_code, drawing_code, actor_email, reason FROM ledger_line ${where}
     ${after ? (stock ? `AND` : `WHERE`) + ` line_id < $${stock ? 2 : 1}` : ''}
     ORDER BY posted_at DESC, line_id DESC LIMIT ${limit + 1}`,
    after && stock ? [stock, after.line_id] : after && !stock ? [after.line_id] : params,
  );
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? cursorToken({ ...filter, line_id: page[page.length - 1]!.line_id }) : null;
  const total = await ctx.db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ledger_line ${stock ? 'WHERE stock_code=$1' : ''}`, stock ? [stock] : []);
  let footerStock: { code: string; remaining_mm: number; width_mm: number } | null = null;
  if (stock) {
    const s = await ctx.db.query<{ code: string; remaining_mm: number; width_mm: number }>(
      `SELECT code, remaining_mm, width_mm FROM stock WHERE code=$1`, [stock]);
    footerStock = s[0] ?? null;
  }
  const offcuts = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stock WHERE kind='offcut' AND remaining_mm > 0`);
  const linesForFooter = stock ? total[0]!.n : 0;
  const onHandAll = await ctx.db.query<{ total: string }>(`SELECT COALESCE(SUM(on_hand_mm2),0) AS total FROM stock`);
  const onHandAllN = Number(onHandAll[0]!.total);
  const onHandStock = footerStock ? footerStock.width_mm * footerStock.remaining_mm : null;
  json(res, 200, {
    items: page.map((r) => ({
      line_id: r.line_id,
      pair_id: r.pair_id,
      posted_at: viewTs(r.posted_at),
      account: r.account,
      amount_mm2: Number(r.amount_mm2),
      stock_code: r.stock_code,
      drawing_code: r.drawing_code,
      actor_email: r.actor_email,
      reason: r.reason,
    })),
    next_cursor: nextCursor,
    total: total[0]!.n,
    footer: {
      stock_code: stock || null,
      remaining_mm: footerStock ? footerStock.remaining_mm : null,
      remaining_in: footerStock ? mmToInch2(footerStock.remaining_mm) : null,
      offcut_count: offcuts[0]!.n,
      on_hand_mm2: footerStock ? onHandStock : onHandAllN,
      on_hand_m2: footerStock ? mm2ToM2(onHandStock!) : mm2ToM2(onHandAllN),
      on_hand_ft2: footerStock ? mm2ToFt2(onHandStock!) : mm2ToFt2(onHandAllN),
      lines: stock ? linesForFooter : total[0]!.n,
    },
  });
});

route('GET', '/api/ledger/reconciliation', SAILMAKER, async (_req, res, ctx) => {
  const sum = await ctx.db.query<{ total: string }>(`SELECT COALESCE(SUM(amount_mm2),0) AS total FROM ledger_line`);
  const stored = await ctx.db.query<{ total: string }>(`SELECT COALESCE(SUM(on_hand_mm2),0) AS total FROM stock`);
  const perItem = await ctx.db.query<{ code: string; stored: string; ledger: string }>(
    `SELECT s.code, s.on_hand_mm2::text AS stored, COALESCE(l.total,0)::text AS ledger FROM stock s
     LEFT JOIN (SELECT account, SUM(amount_mm2) AS total FROM ledger_line GROUP BY account) l ON l.account = s.code`,
  );
  const items = perItem.map((r) => {
    const storedN = Number(r.stored);
    const ledgerN = Number(r.ledger);
    return { stock_code: r.code, stored_on_hand_mm2: storedN, ledger_on_hand_mm2: ledgerN, difference_mm2: storedN - ledgerN };
  });
  const storedN = Number(stored[0]!.total);
  const ledgerStockAccounts = items.reduce((s, i) => s + i.ledger_on_hand_mm2, 0);
  json(res, 200, {
    lines: items.length,
    ledger_sum_mm2: Number(sum[0]!.total),
    stored_on_hand_mm2: storedN,
    ledger_on_hand_mm2: ledgerStockAccounts,
    difference_mm2: storedN - ledgerStockAccounts,
    items,
  });
});

route('GET', '/api/exports/ledger.csv', SAILMAKER, async (_req, res, ctx) => {
  const rows = await ctx.db.query<{ line_id: number; pair_id: string; posted_at: Date; account: string; amount_mm2: string; stock_code: string; drawing_code: string; actor_email: string; reason: string }>(
    `SELECT line_id, pair_id, posted_at, account, amount_mm2, stock_code, drawing_code, actor_email, reason FROM ledger_line ORDER BY posted_at DESC, line_id DESC`,
  );
  const header = 'line_id,pair_id,posted_at,account,amount_mm2,stock_code,drawing_code,actor_email,reason\n';
  const body = rows.map((r) => {
    const fields = [
      String(r.line_id),
      r.pair_id,
      viewTs(r.posted_at),
      neutralise(r.account),
      String(Number(r.amount_mm2)),
      neutralise(r.stock_code),
      neutralise(r.drawing_code),
      neutralise(r.actor_email),
      neutralise(r.reason),
    ];
    return fields.map(csvField).join(',');
  }).join('\n');
  const csv = `${header}${body}\n`;
  const bytes = Buffer.from(csv, 'utf8');
  res.status(200);
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-length', String(bytes.length));
  res.setHeader('cache-control', 'private, no-store');
  res.end(bytes);
});

/** Prefix a text field with a single quote when it starts with a formula character. */
function neutralise(text: string): string {
  if (text.length === 0) return text;
  const first = text[0]!;
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return `'${text}`;
  }
  return text;
}

function csvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

route('GET', '/api/admin/audit', SAILMAKER, async (req, res, ctx) => {
  const limitRaw = req.query['limit'];
  let limit = 20;
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) throw new Refusal(422, 'invalid', words.errors.invalid, { limit: 'Enter a whole number from 1 to 50.' });
    limit = Math.min(n, 50);
  }
  const cursor = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : '';
  let after: { at: string; id: string } | null = null;
  if (cursor) {
    const parsed = cursorFilter(cursor);
    if (parsed === null) throw new Refusal(422, 'invalid', words.errors.invalid, { cursor: words.fields.cursorInvalid });
    after = { at: String(parsed['at'] ?? ''), id: String(parsed['id'] ?? '') };
  }
  const params: unknown[] = [];
  let where = '';
  if (after) {
    params.push(after.at, after.id);
    where = `WHERE (at, id) < ($1::timestamptz, $2)`;
  }
  const rows = await ctx.db.query<{ id: string; at: Date; actor_email: string; action: string; target: string; before: unknown; after_state: unknown; reason: string | null }>(
    `SELECT id, at, actor_email, action, target, before, after, reason FROM audit_trail ${where} ORDER BY at DESC, id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit).map((r) => ({
    id: r.id,
    at: viewTs(r.at),
    actor_email: r.actor_email,
    action: r.action,
    target: r.target,
    before: r.before,
    after: (r as { after?: unknown }).after,
    reason: r.reason,
  }));
  const nextCursor = rows.length > limit ? cursorToken({ at: page[page.length - 1]!.at, id: page[page.length - 1]!.id }) : null;
  const total = await ctx.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_trail`);
  json(res, 200, { items: page, next_cursor: nextCursor, total: total[0]!.n });
});

route('GET', '/api/admin/standing', SAILMAKER, async (req, res, ctx) => {
  const seasonRaw = typeof req.query['season'] === 'string' && req.query['season'] ? String(req.query['season']) : String(new Date().getUTCFullYear());
  if (!/^\d{4}$/.test(seasonRaw)) throw new Refusal(422, 'invalid', words.errors.invalid, { season: words.fields.badDate });
  const season = Number(seasonRaw);
  const rows = await ctx.db.query<{
    owner_id: string; email_norm: string; display_name: string; deleted: boolean;
    id: string; status: string; decided_at: Date | null;
  }>(
    `SELECT s.submitted_by_account AS owner_id, a.email_norm, a.display_name, a.deleted, s.id, s.status, s.decided_at
     FROM (SELECT sub.id, sub.status, sub.decided_at, sub.submitted_by AS submitted_by_account,
                  EXTRACT(YEAR FROM sub.submitted_at) AS yr
           FROM submissions sub) s
     JOIN accounts a ON a.id = s.submitted_by_account
     WHERE s.yr = $1 ORDER BY s.decided_at, s.id`,
    [season],
  );
  interface OwnerStat { email: string; name: string; deleted: boolean; counted: number; accepted: number; rejected: number; reversed: number; streak: number; earliestAccepted: Date | null }
  const byOwner = new Map<string, OwnerStat>();
  for (const r of rows) {
    const stat = byOwner.get(r.owner_id) ?? { email: r.email_norm, name: r.display_name, deleted: r.deleted, counted: 0, accepted: 0, rejected: 0, reversed: 0, streak: 0, earliestAccepted: null };
    stat.counted += 1;
    if (r.status === 'accepted' || r.status === 'reversed') stat.accepted += r.status === 'accepted' ? 1 : 0;
    if (r.status === 'rejected') stat.rejected += 1;
    if (r.status === 'reversed') { stat.reversed += 1; stat.accepted += 0; }
    if (r.status === 'accepted' && (!stat.earliestAccepted || r.decided_at! < stat.earliestAccepted)) stat.earliestAccepted = r.decided_at;
    byOwner.set(r.owner_id, stat);
  }
  // Streak: run of decided submissions ending at the newest; accepted and reversed both count.
  for (const [ownerId] of byOwner) {
    const own = rows.filter((r) => r.owner_id === ownerId);
    let streak = 0;
    for (let i = own.length - 1; i >= 0; i--) {
      const r = own[i]!;
      if (r.status === 'pending') continue;
      if (r.status === 'rejected') break;
      streak += 1;
    }
    byOwner.get(ownerId)!.streak = streak;
  }
  const items = [...byOwner.entries()].map(([ownerId, stat]) => {
    const acceptedEffective = stat.accepted;
    const standing = acceptedEffective >= 15 && stat.streak >= 10 ? 'True tape' : acceptedEffective >= 10 ? 'Steady tape' : 'New tape';
    return { owner_id: ownerId, owner_email: stat.email, owner_name: stat.deleted ? 'Former account' : stat.name, counted: stat.counted, accepted: acceptedEffective, rejected: stat.rejected, reversed: stat.reversed, streak: stat.streak, standing };
  }).sort((x, y) => {
    if (y.accepted !== x.accepted) return y.accepted - x.accepted;
    const xe = byOwner.get(x.owner_id)!.earliestAccepted?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const ye = byOwner.get(y.owner_id)!.earliestAccepted?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (xe !== ye) return xe - ye;
    return x.owner_email.localeCompare(y.owner_email);
  }).map((row, i) => ({ rank: i + 1, owner_email: row.owner_email, owner_name: row.owner_name, counted: row.counted, accepted: row.accepted, rejected: row.rejected, reversed: row.reversed, streak: row.streak, standing: row.standing }));
  json(res, 200, { season, items });
});
