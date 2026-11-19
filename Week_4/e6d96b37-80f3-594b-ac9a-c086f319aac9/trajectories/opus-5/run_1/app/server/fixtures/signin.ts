import { randomBytes } from 'node:crypto';
import { app, limits, providers } from '../config.ts';
import { KeycloakDown, authorizeUrl, exchangeCode, type IdentityClaims } from '../providers/keycloak.ts';

/**
 * Drives Keycloak's own sign-in pages server-side, so a seeded role gets a
 * genuine Keycloak session and real browser cookies. The grading seed hands
 * those cookies back as a Playwright storage state.
 */

export interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
}

export interface StorageState {
  cookies: StorageCookie[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

class CookieJar {
  private readonly byHost = new Map<string, Map<string, StorageCookie>>();

  absorb(host: string, headers: string[]): void {
    let jar = this.byHost.get(host);
    if (!jar) {
      jar = new Map();
      this.byHost.set(host, jar);
    }
    for (const header of headers) {
      const [pair, ...attributes] = header.split(';');
      const at = pair?.indexOf('=') ?? -1;
      if (!pair || at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      let path = '/';
      let httpOnly = false;
      let sameSite: StorageCookie['sameSite'] = 'Lax';
      for (const attribute of attributes) {
        const [rawKey, rawValue] = attribute.split('=');
        const key = rawKey?.trim().toLowerCase();
        if (key === 'path' && rawValue) path = rawValue.trim();
        if (key === 'httponly') httpOnly = true;
        if (key === 'samesite' && rawValue) {
          const normalised = rawValue.trim().toLowerCase();
          sameSite = normalised === 'strict' ? 'Strict' : normalised === 'none' ? 'None' : 'Lax';
        }
      }
      if (value === '') {
        jar.delete(name);
        continue;
      }
      jar.set(name, {
        name,
        value,
        domain: host,
        path,
        expires: -1,
        httpOnly,
        secure: false,
        sameSite,
      });
    }
  }

  header(host: string): string {
    const jar = this.byHost.get(host);
    if (!jar || jar.size === 0) return '';
    return [...jar.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  all(): StorageCookie[] {
    return [...this.byHost.values()].flatMap((jar) => [...jar.values()]);
  }
}

function setCookieHeaders(response: Response): string[] {
  const getter = response.headers.getSetCookie?.bind(response.headers);
  if (getter) return getter();
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

function formAction(html: string): string | null {
  const match = /<form[^>]*\baction="([^"]+)"/i.exec(html);
  if (!match?.[1]) return null;
  return match[1].replace(/&amp;/g, '&');
}

async function step(
  jar: CookieJar,
  target: string,
  init: { method: 'GET' | 'POST'; body?: URLSearchParams } = { method: 'GET' },
): Promise<{ status: number; location: string | null; html: string; url: URL }> {
  const url = new URL(target);
  const headers: Record<string, string> = { accept: 'text/html' };
  const cookie = jar.header(url.host);
  if (cookie) headers['cookie'] = cookie;
  if (init.body) headers['content-type'] = 'application/x-www-form-urlencoded';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.providerTimeoutMs * 10);
  let reply: Response;
  try {
    reply = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch {
    throw new KeycloakDown();
  } finally {
    clearTimeout(timer);
  }

  jar.absorb(url.host, setCookieHeaders(reply));
  const location = reply.headers.get('location');
  const html = location ? '' : await reply.text().catch(() => '');
  return { status: reply.status, location, html, url };
}

export interface SignedIn {
  claims: IdentityClaims;
  cookies: StorageCookie[];
}

/**
 * Signs one seeded identity in through Keycloak's browser flow with their
 * password alone, which is level 1 and carries no step-up proof.
 */
export async function signInThroughKeycloak(
  username: string,
  password: string,
): Promise<SignedIn> {
  const jar = new CookieJar();
  const redirectUri = `${app.publicUrl}/auth/callback`;
  const start = authorizeUrl({
    state: randomBytes(12).toString('base64url'),
    nonce: randomBytes(12).toString('base64url'),
    redirectUri,
    stepUp: false,
  });

  let current = await step(jar, start);
  for (let hop = 0; hop < 6 && current.location; hop += 1) {
    const next = new URL(current.location, current.url);
    if (next.origin === new URL(app.publicUrl).origin) break;
    current = await step(jar, next.toString());
  }

  const action = formAction(current.html);
  if (!action) throw new KeycloakDown();

  let posted = await step(jar, new URL(action, current.url).toString(), {
    method: 'POST',
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });

  let code: string | null = null;
  for (let hop = 0; hop < 8; hop += 1) {
    if (posted.location) {
      const next = new URL(posted.location, posted.url);
      if (next.origin === new URL(app.publicUrl).origin) {
        code = next.searchParams.get('code');
        break;
      }
      posted = await step(jar, next.toString());
      continue;
    }
    // A required-action or interstitial page is submitted as it stands.
    const nextAction = formAction(posted.html);
    if (!nextAction) break;
    posted = await step(jar, new URL(nextAction, posted.url).toString(), {
      method: 'POST',
      body: new URLSearchParams(),
    });
  }
  if (!code) throw new KeycloakDown();

  const { claims } = await exchangeCode(code, redirectUri);
  return { claims, cookies: jar.all() };
}

/** Builds the Playwright storage state for one signed-in role. */
export function storageStateFor(
  keycloakCookies: StorageCookie[],
  appSessionId: string,
): StorageState {
  const appUrl = new URL(app.publicUrl);
  const keycloakHost = new URL(providers.keycloak.url).hostname;
  return {
    cookies: [
      ...keycloakCookies.map((cookie) => ({
        ...cookie,
        domain: cookie.domain.split(':')[0] ?? keycloakHost,
      })),
      {
        name: 'flan_session',
        value: appSessionId,
        domain: appUrl.hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
}
