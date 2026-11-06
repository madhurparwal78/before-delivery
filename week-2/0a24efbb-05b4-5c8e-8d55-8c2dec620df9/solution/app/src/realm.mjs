import { config } from "./config.mjs";

// The Keycloak realm checks passwords and nothing else. The desk is its confidential client.

export class RealmUnavailable extends Error {}

const TIMEOUT_MS = 5000;
let discovered = null;

async function call(url, init = {}) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    if (response.status >= 500) throw new RealmUnavailable(`realm answered ${response.status}`);
    return response;
  } catch (error) {
    throw error instanceof RealmUnavailable ? error : new RealmUnavailable(error.message);
  }
}

async function tokenEndpoint() {
  if (!discovered) {
    const response = await call(`${config.issuerUrl}/.well-known/openid-configuration`);
    if (!response.ok) throw new RealmUnavailable(`discovery answered ${response.status}`);
    discovered = await response.json();
  }
  return discovered.token_endpoint;
}

function claimsOf(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

/**
 * Exchange a work address and password with the realm. Answers the token's `{email, subject}`, or null when the
 * realm refuses them; throws RealmUnavailable when the realm cannot be reached.
 */
export async function exchangePassword(workAddress, password) {
  const response = await call(await tokenEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: workAddress,
      password,
      scope: "openid",
    }),
  });
  if (!response.ok) return null;
  const claims = claimsOf((await response.json()).access_token);
  return { email: String(claims.email ?? claims.preferred_username ?? ""), subject: claims.sub ?? null };
}

/** Register one account through the realm's own self-registration form. */
async function register(person, password) {
  const start = new URL(`${config.issuerUrl}/protocol/openid-connect/registrations`);
  start.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: `${config.publicUrl}/login`,
  }).toString();
  const page = await call(start);
  const cookie = page.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
  const action = (await page.text()).match(/action="([^"]*login-actions\/registration[^"]*)"/)?.[1];
  if (!action) throw new RealmUnavailable("the realm offered no registration form");
  const space = person.name.indexOf(" ");
  await call(action.replaceAll("&amp;", "&"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({
      firstName: person.name.slice(0, space),
      lastName: person.name.slice(space + 1),
      email: person.workAddress,
      username: person.workAddress,
      password,
      "password-confirm": password,
    }),
  });
}

/** Make sure every seeded person can exchange the seeded password; true once all of them can. */
export async function reconcileAccounts(people, password) {
  for (const person of people) {
    if (await exchangePassword(person.workAddress, password)) continue;
    await register(person, password);
    if (!(await exchangePassword(person.workAddress, password))) return false;
  }
  return true;
}
