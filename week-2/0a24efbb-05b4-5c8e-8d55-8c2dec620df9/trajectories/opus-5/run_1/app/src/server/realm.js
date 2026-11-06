import { SEEDED_PASSWORD } from '../shared/constants.js';
import { foldWorkAddress, splitName } from '../shared/text.js';
import { config } from './config.js';
import { SEEDED_PEOPLE } from './seed.js';

const TOKEN_ENDPOINT = `${config.authIssuerUrl}/protocol/openid-connect/token`;
const REGISTRATIONS_ENDPOINT = `${config.authIssuerUrl}/protocol/openid-connect/registrations`;
const REQUEST_TIMEOUT_MS = 8000;

export const REALM_OK = 'ok';
export const REALM_REFUSED = 'refused';
export const REALM_UNREACHABLE = 'unreachable';

function timeout() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function decodeClaims(accessToken) {
  const payload = accessToken.split('.')[1];
  if (!payload) return {};
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Asks the realm to check a password. The realm is the only place a password is held
 * or checked, so this is the whole of password verification.
 */
export async function exchangePassword(workAddress, password) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.authClientId,
    client_secret: config.authClientSecret,
    scope: 'openid',
    username: workAddress,
    password,
  });
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: timeout(),
    });
  } catch {
    return { outcome: REALM_UNREACHABLE };
  }
  if (response.status === 200) {
    const payload = await response.json();
    return { outcome: REALM_OK, claims: decodeClaims(payload.access_token) };
  }
  if (response.status === 400 || response.status === 401) {
    await response.text();
    return { outcome: REALM_REFUSED };
  }
  await response.text();
  return { outcome: REALM_UNREACHABLE };
}

function formActionOf(html) {
  const match = html.match(/action="([^"]*login-actions\/registration[^"]*)"/);
  if (!match) return null;
  return match[1].replace(/&amp;/g, '&').replace(/&#x3D;/g, '=');
}

/** Registers one seeded account through the realm's own self-registration pages. */
async function registerAccount(person) {
  const query = new URLSearchParams({
    client_id: config.authClientId,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: `${config.publicUrl}/login`,
  });
  const page = await fetch(`${REGISTRATIONS_ENDPOINT}?${query}`, { redirect: 'manual', signal: timeout() });
  const html = await page.text();
  const action = formActionOf(html);
  if (!action) return false;
  const cookies = page.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

  const { firstName, lastName } = splitName(person.name);
  const form = new URLSearchParams({
    firstName,
    lastName,
    email: person.work_address,
    username: person.work_address,
    password: SEEDED_PASSWORD,
    'password-confirm': SEEDED_PASSWORD,
  });
  const submitted = await fetch(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies },
    body: form,
    redirect: 'manual',
    signal: timeout(),
  });
  await submitted.text();
  return submitted.status < 500;
}

/**
 * Makes sure each seeded person exists in the realm with the seeded password.
 * An account that can already exchange it needs nothing and is never registered twice.
 */
export async function reconcileRealmAccounts() {
  let reachable = true;
  for (const person of SEEDED_PEOPLE) {
    const probe = await exchangePassword(foldWorkAddress(person.work_address), SEEDED_PASSWORD);
    if (probe.outcome === REALM_OK) continue;
    if (probe.outcome === REALM_UNREACHABLE) return false;
    try {
      await registerAccount(person);
    } catch {
      return false;
    }
    const again = await exchangePassword(foldWorkAddress(person.work_address), SEEDED_PASSWORD);
    if (again.outcome !== REALM_OK) reachable = false;
  }
  return reachable;
}
