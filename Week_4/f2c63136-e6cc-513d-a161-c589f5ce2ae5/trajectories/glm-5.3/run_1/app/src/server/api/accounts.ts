import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Errors, expectObject, requireField, type RequestContext , parseBodyWithLimit } from './context.js';
import { isValidEmail, isValidSlug, isValidUsername } from '../../shared/rules.js';

function parseBody(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  return parseBodyWithLimit(ctx);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** POST /api/signup */
export async function signup(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  const errors: Record<string, string> = {};
  const username = typeof body.username === 'string' ? body.username : '';
  const email = typeof body.email === 'string' ? body.email : '';
  const name = typeof body.name === 'string' ? body.name : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username) errors.username = 'Username is required';
  else if (!isValidUsername(username)) errors.username = 'Username is invalid';
  if (!email) errors.email = 'Email is required';
  else if (!isValidEmail(email)) errors.email = 'Email is invalid';
  if (!password) errors.password = 'Password is required';
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (!name) errors.name = 'Name is required';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const takenUser = await ctx.tx.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (takenUser.rows.length > 0) throw Errors.invalid({ username: 'Username is taken' });
  const takenEmail = await ctx.tx.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (takenEmail.rows.length > 0) throw Errors.invalid({ email: 'Email is already registered' });
  const insert = await ctx.tx.query(
    'INSERT INTO users (username, email, name, password_hash, confirmed, created_at_ms) VALUES ($1,$2,$3,$4,false,$5) RETURNING id',
    [username, email, name, hashPassword(password), ctx.clock.nowMs()],
  );
  const userId = insert.rows[0].id;
  const token = randomBytes(24).toString('hex');
  await ctx.tx.query('INSERT INTO confirm_tokens (token, user_id, used) VALUES ($1,$2,false)', [token, userId]);
  await ctx.mailer.record({
    to: email,
    subject: 'Confirm your Ridgestack account',
    body: `Welcome to Ridgestack. Confirm your account:\n\n${ctx.cfg.appPublicUrl}/confirm/${token}`,
  });
  return { status: 201, body: { status: 'confirmation_sent' } };
}

/** POST /api/confirm */
export async function confirm(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  const body = expectObject(parseBody(ctx));
  const token = typeof body.token === 'string' ? body.token : '';
  const row = await ctx.tx.query('SELECT * FROM confirm_tokens WHERE token = $1 AND used = false', [token]);
  if (row.rows.length === 0) throw Errors.notFound();
  const userId = row.rows[0].user_id;
  await ctx.tx.query('UPDATE confirm_tokens SET used = true WHERE token = $1', [token]);
  await ctx.tx.query('UPDATE users SET confirmed = true WHERE id = $1', [userId]);
  const user = await ctx.tx.query('SELECT username FROM users WHERE id = $1', [userId]);
  return { status: 200, body: { username: user.rows[0].username } };
}

/** POST /api/login */
export async function login(ctx: RequestContext): Promise<{ status: number; body: unknown; session?: string }> {
  const body = expectObject(parseBody(ctx));
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const row = await ctx.tx.query('SELECT * FROM users WHERE email = $1', [email]);
  if (row.rows.length === 0 || !verifyPassword(password, row.rows[0].password_hash)) {
    throw new (await import('./context.js')).ApiError(401, { error: 'Email or password is wrong' });
  }
  const user = row.rows[0];
  if (!user.confirmed) throw new (await import('./context.js')).ApiError(403, { error: 'Confirm your email first' });
  const token = randomBytes(24).toString('hex');
  await ctx.tx.query('INSERT INTO sessions (token, user_id, created_at_ms) VALUES ($1,$2,$3)', [token, user.id, ctx.clock.nowMs()]);
  return { status: 200, body: { username: user.username, name: user.name }, session: token };
}

/** POST /api/orgs */
export async function createOrg(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  if (!ctx.auth.user) throw Errors.unauthenticated();
  const body = expectObject(parseBody(ctx));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  const name = typeof body.name === 'string' ? body.name : '';
  const errors: Record<string, string> = {};
  if (!slug) errors.slug = 'Address is required';
  else if (!isValidSlug(slug)) errors.slug = 'Address is invalid';
  if (!name) errors.name = 'Name is required';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const taken = await ctx.tx.query('SELECT 1 FROM orgs WHERE slug = $1', [slug]);
  if (taken.rows.length > 0) throw Errors.invalid({ slug: 'Address is taken' });
  const insert = await ctx.tx.query('INSERT INTO orgs (slug, name) VALUES ($1,$2) RETURNING id', [slug, name]);
  await ctx.tx.query('INSERT INTO org_owners (org_id, user_id) VALUES ($1,$2)', [insert.rows[0].id, ctx.auth.user.id]);
  return { status: 201, body: { slug, name } };
}

/** POST /api/orgs/<org>/teams */
export async function createTeam(ctx: RequestContext, org: string): Promise<{ status: number; body: unknown }> {
  if (!ctx.auth.user) throw Errors.unauthenticated();
  const orgRow = await ctx.tx.query('SELECT * FROM orgs WHERE slug = $1', [org]);
  if (orgRow.rows.length === 0) throw Errors.notFound();
  const orgId = orgRow.rows[0].id;
  const isOwner = await ctx.tx.query('SELECT 1 FROM org_owners WHERE org_id = $1 AND user_id = $2', [orgId, ctx.auth.user.id]);
  if (isOwner.rows.length === 0) throw Errors.forbidden('Only organisation owners can do that');
  const body = expectObject(parseBody(ctx));
  const name = typeof body.name === 'string' ? body.name : '';
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Name is required';
  else if (!isValidSlug(name)) errors.name = 'Name is invalid';
  if (Object.keys(errors).length > 0) throw Errors.invalid(errors);
  const taken = await ctx.tx.query('SELECT 1 FROM teams WHERE org_id = $1 AND name = $2', [orgId, name]);
  if (taken.rows.length > 0) throw Errors.invalid({ name: 'Name is taken' });
  await ctx.tx.query('INSERT INTO teams (org_id, name) VALUES ($1,$2)', [orgId, name]);
  return { status: 201, body: { name } };
}

/** PUT /api/orgs/<org>/teams/<team>/members/<username> */
export async function addTeamMember(ctx: RequestContext, org: string, team: string, username: string): Promise<{ status: number; body: unknown }> {
  if (!ctx.auth.user) throw Errors.unauthenticated();
  const orgRow = await ctx.tx.query('SELECT * FROM orgs WHERE slug = $1', [org]);
  if (orgRow.rows.length === 0) throw Errors.notFound();
  const orgId = orgRow.rows[0].id;
  const isOwner = await ctx.tx.query('SELECT 1 FROM org_owners WHERE org_id = $1 AND user_id = $2', [orgId, ctx.auth.user.id]);
  if (isOwner.rows.length === 0) throw Errors.forbidden('Only organisation owners can do that');
  const teamRow = await ctx.tx.query('SELECT 1 FROM teams WHERE org_id = $1 AND name = $2', [orgId, team]);
  if (teamRow.rows.length === 0) throw Errors.notFound();
  const userRow = await ctx.tx.query('SELECT id FROM users WHERE username = $1', [username]);
  if (userRow.rows.length === 0) throw Errors.notFound();
  await ctx.tx.query(
    'INSERT INTO team_members (org_id, team_name, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [orgId, team, userRow.rows[0].id],
  );
  return { status: 204, body: null };
}
