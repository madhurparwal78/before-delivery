'use strict';
const cookie = require('cookie');
const db = require('./db');
const { refusal, grantsFor, allGrantsFor } = require('./core');
const { hashPassword, verifyPassword, randomToken, nowIso } = require('./util');

const SESSION_COOKIE = 'keystone_session';
const SESSION_HOURS = 12;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_LIMIT = 5;

const OBVIOUS_PASSWORDS = ['keystonetables', 'northbankmutual', 'passwordpassword', 'claimsworkspace'];
const TIER_NAMES = ['starter', 'team', 'scale', 'regulated'];
const DEPARTMENT_SLUGS = ['claims', 'underwriting', 'actuarial'];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const SIGNIN_REFUSAL = () => refusal(401, 'Email or password is wrong.', 'email');
const EMAIL_REFUSAL = () => refusal(422, 'This email cannot be used.', 'email');

function readCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  try {
    return cookie.parse(header);
  } catch {
    return {};
  }
}

function presentedToken(req) {
  const header = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(header)) {
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (token) return token;
  }
  const cookies = readCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  return null;
}

/**
 * Resolve the session a request presents. A session carries the account it
 * belongs to and nothing a grant decides, so grants are read separately on
 * every request.
 */
async function resolveSession(req) {
  const token = presentedToken(req);
  if (!token) return null;
  const session = await db.one(
    'SELECT id, value, account, created_at, expires_at FROM sessions WHERE value = $1',
    [token]
  );
  if (!session) return null;
  // The lifetime boundary is exclusive: refused at expires_at and after it.
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;
  const account = await db.one(
    'SELECT id, email, display_name, department, tier FROM accounts WHERE email = $1',
    [session.account]
  );
  if (!account) return null;
  return { session, account };
}

/** Attach `req.auth` for every request, page or interface alike. */
function sessionMiddleware() {
  return async function (req, res, next) {
    try {
      req.auth = await resolveSession(req);
      if (req.auth) {
        req.auth.grants = await grantsFor(req.auth.account.email);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function roleOnFromAuth(auth, department) {
  if (!auth) return null;
  const g = (auth.grants || []).find((x) => x.department === department);
  return g ? g.role : null;
}

function requireSession(req) {
  if (!req.auth) throw refusal(401, 'This address needs a session.', 'session');
  return req.auth;
}

async function createSession(email) {
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_HOURS * 3600 * 1000);
  const value = randomToken(27);
  await db.query(
    'INSERT INTO sessions (value, account, created_at, expires_at) VALUES ($1,$2,$3,$4)',
    [value, email, created.toISOString(), expires.toISOString()]
  );
  return { value, created_at: created.toISOString(), expires_at: expires.toISOString() };
}

function setSessionCookie(res, value) {
  res.append(
    'Set-Cookie',
    cookie.serialize(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_HOURS * 3600,
    })
  );
}

function clearSessionCookie(res) {
  res.append(
    'Set-Cookie',
    cookie.serialize(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  );
}

async function recordAttempt(email, outcome) {
  await db.query('INSERT INTO login_attempts (email, attempted_at, outcome) VALUES ($1,$2,$3)', [
    email,
    nowIso(),
    outcome,
  ]);
}

/**
 * Refused-attempt count for one work email inside the window, counted from
 * after its last successful sign-in. Keyed on the email alone.
 */
async function throttleState(email) {
  const since = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
  const rows = await db.all(
    `SELECT attempted_at, outcome FROM login_attempts
     WHERE email = $1 AND attempted_at >= $2 ORDER BY attempted_at ASC, id ASC`,
    [email, since]
  );
  const refused = [];
  for (const r of rows) {
    if (r.outcome === 'succeeded') refused.length = 0;
    else refused.push(r.attempted_at);
  }
  if (refused.length < THROTTLE_LIMIT) return { throttled: false };
  const oldest = new Date(refused[refused.length - THROTTLE_LIMIT]).getTime();
  const retryMs = oldest + THROTTLE_WINDOW_MS - Date.now();
  return { throttled: true, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) };
}

async function login(req, res) {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const state = await throttleState(email);
  if (state.throttled) {
    res.set('Retry-After', String(state.retryAfter));
    throw refusal(429, 'Too many refused sign-in attempts for this email.', 'email', {
      retry_after: state.retryAfter,
    });
  }

  const account = await db.one(
    'SELECT email, display_name, department, tier, password_hash FROM accounts WHERE email = $1',
    [email]
  );
  if (!account || !verifyPassword(password, account.password_hash)) {
    await recordAttempt(email, 'refused');
    throw SIGNIN_REFUSAL();
  }

  await recordAttempt(email, 'succeeded');
  const session = await createSession(account.email);
  setSessionCookie(res, session.value);
  const grants = await allGrantsFor(account.email);
  res.status(200).json({
    token: session.value,
    access_token: session.value,
    expires_at: session.expires_at,
    account: {
      email: account.email,
      display_name: account.display_name,
      department: account.department,
      tier: account.tier,
    },
    role_grants: grants.map((g) => ({
      account: g.account,
      department: g.department,
      role: g.role,
      authorises_from: g.authorises_from,
    })),
  });
}

async function signup(req, res) {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const tier = typeof body.tier === 'string' ? body.tier.trim() : body.tier;
  const department = typeof body.department === 'string' ? body.department.trim().toLowerCase() : '';
  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim()
      ? body.display_name.trim()
      : email.split('@')[0];

  // One refusal for a malformed address and for one already recorded alike.
  if (!email || !EMAIL_SHAPE.test(email) || email.length > 254) throw EMAIL_REFUSAL();
  const held = await db.one('SELECT 1 FROM accounts WHERE email = $1', [email]);
  if (held) throw EMAIL_REFUSAL();

  if (password.length < 12) {
    throw refusal(422, 'A password is at least 12 characters long.', 'password');
  }
  if (OBVIOUS_PASSWORDS.includes(password.toLowerCase())) {
    throw refusal(422, 'That password is too obvious to use.', 'password');
  }

  if (!TIER_NAMES.includes(tier)) {
    throw refusal(422, 'A sign up names one of the four tiers.', 'tier');
  }
  if (!DEPARTMENT_SLUGS.includes(department)) {
    throw refusal(422, 'A sign up names one of the three departments.', 'department');
  }

  // A sign up creates no role grant and opens no session.
  const created = await db.one(
    `INSERT INTO accounts (email, display_name, department, tier, password_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, display_name, department, tier`,
    [email, displayName, department, tier, hashPassword(password), nowIso()]
  );
  res.status(201).json({
    id: String(created.id),
    email: created.email,
    display_name: created.display_name,
    department: created.department,
    tier: created.tier,
    role_grants: [],
  });
}

async function logout(req, res) {
  const auth = requireSession(req);
  await db.query('DELETE FROM sessions WHERE value = $1', [auth.session.value]);
  clearSessionCookie(res);
  res.status(204).end();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_HOURS,
  OBVIOUS_PASSWORDS,
  TIER_NAMES,
  DEPARTMENT_SLUGS,
  EMAIL_SHAPE,
  sessionMiddleware,
  resolveSession,
  roleOnFromAuth,
  requireSession,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  login,
  signup,
  logout,
  throttleState,
  SIGNIN_REFUSAL,
};
