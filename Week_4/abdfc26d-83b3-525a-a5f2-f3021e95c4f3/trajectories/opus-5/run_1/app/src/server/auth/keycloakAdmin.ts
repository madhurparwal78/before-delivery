import { config } from '../config.js';

export const REALM_ROLES: readonly string[] = ['creator', 'collector', 'founder-operator'];

export interface SeedAccount {
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly password: string;
  readonly sellerAddress: string | null;
}

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    username: 'wren.okafor',
    displayName: 'Wren Okafor',
    email: 'wren@brightmoss.example',
    roles: ['founder-operator'],
    password: 'Yard-Founder-2026',
    sellerAddress: null,
  },
  {
    username: 'ilse.marrow',
    displayName: 'Ilse Marrow',
    email: 'ilse@studio-marrow.example',
    roles: ['creator'],
    password: 'Yard-Creator-2026',
    sellerAddress: 'Studio Marrow, 12 Lindenstraat, Utrecht, Netherlands',
  },
  {
    username: 'tobi.ansel',
    displayName: 'Tobi Ansel',
    email: 'tobi@ansel-loops.example',
    roles: ['creator'],
    password: 'Yard-Creator-2026',
    sellerAddress: 'Ansel Loops, 4 Hafenweg, Bremen, Germany',
  },
  {
    username: 'odile.renn',
    displayName: 'Odile Renn',
    email: 'odile@renn-signal.example',
    roles: ['creator'],
    password: 'Yard-Creator-2026',
    sellerAddress: 'Renn Signal, 9 Rue des Lampes, Lyon, France',
  },
  {
    username: 'june.halloway',
    displayName: 'June Halloway',
    email: 'june@collectors.example',
    roles: ['collector'],
    password: 'Yard-Collector-2026',
    sellerAddress: null,
  },
  {
    username: 'pax.ferreira',
    displayName: 'Pax Ferreira',
    email: 'pax@collectors.example',
    roles: ['collector'],
    password: 'Yard-Collector-2026',
    sellerAddress: null,
  },
  {
    username: 'nell.quist',
    displayName: 'Nell Quist',
    email: 'nell@collectors.example',
    roles: ['collector'],
    password: 'Yard-Collector-2026',
    sellerAddress: null,
  },
];

const adminBase = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function serviceAccountToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) {
    return cachedToken.value;
  }
  const response = await fetch(
    `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.authClientId,
        client_secret: config.authClientSecret,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Keycloak refused the service account token (${response.status})`);
  }
  const token = (await response.json()) as TokenResponse;
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  return token.access_token;
}

async function adminRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const token = await serviceAccountToken();
  const response = await fetch(`${adminBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text() };
}

interface RoleRepresentation {
  id: string;
  name: string;
}

interface UserRepresentation {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

async function ensureRealmRoles(): Promise<Map<string, RoleRepresentation>> {
  for (const name of REALM_ROLES) {
    const existing = await adminRequest('GET', `/roles/${encodeURIComponent(name)}`);
    if (existing.status === 404) {
      await adminRequest('POST', '/roles', { name });
    }
  }
  const all = await adminRequest('GET', '/roles');
  const roles = JSON.parse(all.text) as RoleRepresentation[];
  return new Map(roles.map((role) => [role.name, role]));
}

async function findUser(username: string): Promise<UserRepresentation | null> {
  const response = await adminRequest(
    'GET',
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  const users = JSON.parse(response.text) as UserRepresentation[];
  return users[0] ?? null;
}

export interface ResolvedAccount extends SeedAccount {
  readonly id: string;
}

/**
 * Creates the realm roles and the seeded users when missing, then reports each
 * seeded user's Keycloak id. Safe to run concurrently on every instance.
 */
export async function bootstrapKeycloak(): Promise<ResolvedAccount[]> {
  const roles = await ensureRealmRoles();
  const resolved: ResolvedAccount[] = [];

  for (const account of SEED_ACCOUNTS) {
    let user = await findUser(account.username);
    if (!user) {
      const [firstName = '', lastName = ''] = account.displayName.split(' ');
      await adminRequest('POST', '/users', {
        username: account.username,
        email: account.email,
        emailVerified: true,
        enabled: true,
        firstName,
        lastName,
        credentials: [{ type: 'password', value: account.password, temporary: false }],
      });
      user = await findUser(account.username);
    }
    if (!user) {
      throw new Error(`Keycloak did not report user ${account.username} after creation`);
    }

    const wanted = account.roles
      .map((name) => roles.get(name))
      .filter((role): role is RoleRepresentation => role !== undefined)
      .map((role) => ({ id: role.id, name: role.name }));
    if (wanted.length > 0) {
      await adminRequest('POST', `/users/${user.id}/role-mappings/realm`, wanted);
    }

    resolved.push({ ...account, id: user.id });
  }

  return resolved;
}

/** A self-registered user gets creator and collector on first sign-in. */
export async function grantDefaultRoles(userId: string): Promise<void> {
  const all = await adminRequest('GET', '/roles');
  const roles = JSON.parse(all.text) as RoleRepresentation[];
  const wanted = roles
    .filter((role) => role.name === 'creator' || role.name === 'collector')
    .map((role) => ({ id: role.id, name: role.name }));
  if (wanted.length > 0) {
    await adminRequest('POST', `/users/${userId}/role-mappings/realm`, wanted);
  }
}

export async function realmRolesOfUser(userId: string): Promise<string[]> {
  const response = await adminRequest('GET', `/users/${userId}/role-mappings/realm/composite`);
  if (response.status !== 200) return [];
  const roles = JSON.parse(response.text) as RoleRepresentation[];
  return roles.map((role) => role.name).filter((name) => REALM_ROLES.includes(name));
}

export async function userProfile(userId: string): Promise<{
  username: string;
  displayName: string;
  email: string;
} | null> {
  const response = await adminRequest('GET', `/users/${userId}`);
  if (response.status !== 200) return null;
  const user = JSON.parse(response.text) as UserRepresentation;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return {
    username: user.username,
    displayName: displayName === '' ? user.username : displayName,
    email: user.email ?? '',
  };
}
