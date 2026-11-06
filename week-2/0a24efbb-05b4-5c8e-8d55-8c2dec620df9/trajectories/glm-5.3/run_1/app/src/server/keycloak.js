import { config, SEEDED_PASSWORD } from './config.js';
import { PEOPLE } from '../db/seed.js';

const issuer = config.authIssuerUrl;

function wellKnown() {
  return `${issuer}/.well-known/openid-configuration`;
}

let cachedConfig = null;
let configFetchedAt = 0;

async function realmConfig(fetchFn) {
  if (cachedConfig && Date.now() - configFetchedAt < 300000) return cachedConfig;
  const res = await fetchFn(wellKnown(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('realm config unavailable');
  cachedConfig = await res.json();
  configFetchedAt = Date.now();
  return cachedConfig;
}

/** Exchange work address and password for a token, or null on bad credentials. */
export async function passwordGrant(fetchFn, workAddress, password) {
  const cfg = await realmConfig(fetchFn);
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.authClientId,
    client_secret: config.authClientSecret,
    username: workAddress,
    password,
    scope: 'openid',
  });
  const res = await fetchFn(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { refused: true };
  }
  if (!res.ok) throw new Error('token endpoint failed');
  const data = await res.json();
  return { refused: false, token: data };
}

function splitName(name) {
  const i = name.indexOf(' ');
  if (i === -1) return { firstName: name, lastName: '' };
  return { firstName: name.slice(0, i), lastName: name.slice(i + 1) };
}

const registered = new Set();

/** Register one seeded person through the realm's self-registration. */
async function registerPerson(fetchFn, person, password) {
  const regBase = `${issuer}/protocol/openid-connect/registrations`;
  const startUrl = `${regBase}?client_id=${encodeURIComponent(config.authClientId)}&response_type=code&scope=openid&redirect_uri=${encodeURIComponent(`${config.publicUrl}/login`)}`;
  const page = await fetchFn(startUrl, { redirect: 'manual' });
  if (!page.ok && page.status !== 200) throw new Error('registration page unavailable');
  const html = await page.text();
  const cookies = (page.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
  const actionMatch = html.match(/action="([^"]*login-actions\/registration[^"]*)"/);
  if (!actionMatch) throw new Error('registration form not found');
  const action = actionMatch[1].replaceAll('&amp;', '&');
  const { firstName, lastName } = splitName(person.name);
  const form = new URLSearchParams({
    firstName,
    lastName,
    email: person.work_address,
    username: person.work_address,
    password,
    'password-confirm': password,
  });
  const res = await fetchFn(action, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: form.toString(),
    redirect: 'manual',
  });
  // Keycloak answers 200 with an error page, or a 302 on success.
  if (res.status === 302) return true;
  const text = await res.text();
  if (/already exists|email already/i.test(text) || text.includes('kc-register-form') === false) {
    // treat an already-registered account as success
    return true;
  }
  return true;
}

/** Verify one person can exchange the seeded password. */
export async function verifyAccount(fetchFn, person) {
  try {
    const out = await passwordGrant(fetchFn, person.work_address, SEEDED_PASSWORD);
    return out.refused === false;
  } catch {
    return false;
  }
}

/**
 * Make sure every seeded person exists in the realm with the seeded password.
 * Returns true when every account can exchange it.
 */
export async function reconcileRealmAccounts(fetchFn) {
  for (const person of PEOPLE) {
    let ok = await verifyAccount(fetchFn, person);
    if (!ok) {
      await registerPerson(fetchFn, person, SEEDED_PASSWORD);
      ok = await verifyAccount(fetchFn, person);
    }
    if (!ok) return false;
  }
  return true;
}
