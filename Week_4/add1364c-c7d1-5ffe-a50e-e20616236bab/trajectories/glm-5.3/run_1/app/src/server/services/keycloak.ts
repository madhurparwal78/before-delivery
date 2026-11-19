import type { Settings } from '../config.js';

/** Result of a password-grant sign-in check. */
export type SignInCheck =
  | { kind: 'ok' }
  | { kind: 'bad_credentials' }
  | { kind: 'account_disabled' }
  | { kind: 'unreachable' };

export interface KeycloakUser {
  id: string;
  username: string;
  enabled: boolean;
}

const TOKEN_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 8000;

/** Client for Keycloak admin and token endpoints, with explicit timeouts. */
export class KeycloakClient {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly settings: Settings) {}

  private adminUrl(path: string): string {
    return `${this.settings.keycloakUrl}/admin/realms/${this.settings.keycloakRealm}${path}`;
  }

  private tokenUrl(): string {
    return `${this.settings.authIssuerUrl}/protocol/openid-connect/token`;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private form(data: Record<string, string>): string {
    return Object.entries(data)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  async serviceToken(): Promise<string | null> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 5000) {
      return this.cachedToken.value;
    }
    try {
      const response = await this.fetchWithTimeout(
        this.tokenUrl(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: this.form({
            grant_type: 'client_credentials',
            client_id: this.settings.authClientId,
            client_secret: this.settings.authClientSecret
          })
        },
        TOKEN_TIMEOUT_MS
      );
      if (!response.ok) return null;
      const parsed = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!parsed.access_token) return null;
      this.cachedToken = {
        value: parsed.access_token,
        expiresAt: Date.now() + (parsed.expires_in ?? 60) * 1000
      };
      return parsed.access_token;
    } catch {
      return null;
    }
  }

  /** Check a handle and password through the `app` client's password grant. */
  async checkPassword(username: string, password: string): Promise<SignInCheck> {
    try {
      const response = await this.fetchWithTimeout(
        this.tokenUrl(),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: this.form({
            grant_type: 'password',
            client_id: this.settings.authClientId,
            client_secret: this.settings.authClientSecret,
            username,
            password
          })
        },
        TOKEN_TIMEOUT_MS
      );
      if (response.ok) return { kind: 'ok' };
      const body = (await response.json().catch(() => ({}))) as { error_description?: string; error?: string };
      const description = `${body.error ?? ''} ${body.error_description ?? ''}`;
      if (/disabled/i.test(description)) return { kind: 'account_disabled' };
      return { kind: 'bad_credentials' };
    } catch {
      return { kind: 'unreachable' };
    }
  }

  private async adminHeaders(): Promise<Record<string, string> | null> {
    const token = await this.serviceToken();
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  /** Look up a user by exact username in the shared realm. */
  async findUser(username: string): Promise<KeycloakUser | null> {
    const headers = await this.adminHeaders();
    if (!headers) return null;
    try {
      const response = await this.fetchWithTimeout(
        this.adminUrl(`/users?username=${encodeURIComponent(username)}&exact=true`),
        { headers: { Authorization: headers.Authorization } },
        CALL_TIMEOUT_MS
      );
      if (!response.ok) return null;
      const users = (await response.json()) as { id: string; username: string; enabled: boolean }[];
      const match = users.find((user) => user.username === username);
      return match ? { id: match.id, username: match.username, enabled: match.enabled } : null;
    } catch {
      return null;
    }
  }

  /** Create a user with a complete profile; returns the id, or `exists` when the username is taken. */
  async createUser(
    username: string,
    firstName: string,
    lastName: string,
    email: string,
    password: string
  ): Promise<{ id: string } | { exists: true } | { unreachable: true }> {
    const headers = await this.adminHeaders();
    if (!headers) return { unreachable: true };
    try {
      const response = await this.fetchWithTimeout(
        this.adminUrl('/users'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            username,
            firstName,
            lastName,
            email,
            emailVerified: true,
            enabled: true,
            credentials: [{ type: 'password', value: password, temporary: false }]
          })
        },
        CALL_TIMEOUT_MS
      );
      if (response.status === 409) return { exists: true };
      if (response.ok) {
        const location = response.headers.get('Location');
        if (location) {
          const id = location.split('/').filter(Boolean).pop() ?? '';
          return { id };
        }
        const found = await this.findUser(username);
        return found ? { id: found.id } : { id: '' };
      }
      const body = (await response.json().catch(() => ({}))) as { errorMessage?: string };
      if (/already exists/i.test(body.errorMessage ?? '')) return { exists: true };
      return { unreachable: true };
    } catch {
      return { unreachable: true };
    }
  }

  /** Enable or disable a user. */
  async setEnabled(username: string, enabled: boolean): Promise<boolean> {
    const user = await this.findUser(username);
    if (!user) return false;
    const headers = await this.adminHeaders();
    if (!headers) return false;
    try {
      const response = await this.fetchWithTimeout(
        this.adminUrl(`/users/${user.id}`),
        { method: 'PUT', headers, body: JSON.stringify({ enabled }) },
        CALL_TIMEOUT_MS
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /** End every session of a user (logout from all sessions). */
  async endSessions(username: string): Promise<void> {
    const user = await this.findUser(username);
    if (!user) return;
    const headers = await this.adminHeaders();
    if (!headers) return;
    try {
      await this.fetchWithTimeout(
        this.adminUrl(`/users/${user.id}/logout-all`),
        { method: 'POST', headers: { Authorization: headers.Authorization } },
        CALL_TIMEOUT_MS
      );
    } catch {
      // best effort; the Lockset session is what gates access
    }
  }
}
