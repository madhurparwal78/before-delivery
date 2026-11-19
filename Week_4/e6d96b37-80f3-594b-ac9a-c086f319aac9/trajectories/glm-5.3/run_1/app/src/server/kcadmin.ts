import { createHmac } from "node:crypto";
import { request } from "undici";
import type { FlanEnv } from "../shared/env.js";
import { Keycloak } from "./keycloak.js";

export interface KcUser {
  id: string;
  username: string;
  enabled: boolean;
  requiredActions?: string[];
  attributes?: Record<string, string[]>;
}

export interface ProvisionedUser {
  userId: string;
  totpSecret: string;
}

const ALPHABET32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(secret: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function totpCode(secret: string, periodSeconds: number, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / periodSeconds);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", Buffer.from(base32Decode(secret))).update(buf).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export class KeycloakAdmin {
  private token: string | null = null;
  private tokenExpires = 0;

  constructor(private env: FlanEnv, private kc: Keycloak) {}

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    this.token = await this.kc.serviceToken();
    this.tokenExpires = Date.now() + 50_000;
    return this.token;
  }

  private async api(path: string, method: string, body?: unknown): Promise<unknown> {
    const token = await this.ensureToken();
    const url = `${this.env.KEYCLOAK_URL}/admin/realms/${this.env.KEYCLOAK_REALM}${path}`;
    const res = await request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      bodyTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
      headersTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
    });
    if (res.statusCode >= 500) {
      await res.body.dump();
      throw new Error(`keycloak admin ${res.statusCode}`);
    }
    if (res.statusCode >= 400) {
      const text = await res.body.text();
      if (res.statusCode === 409) return null;
      throw new Error(`keycloak admin ${res.statusCode}: ${text.slice(0, 200)}`);
    }
    if (res.statusCode === 204) return null;
    return res.body.json().catch(() => null);
  }

  async available(): Promise<boolean> {
    try {
      await this.ensureToken();
      return true;
    } catch {
      return false;
    }
  }

  async ensureClient(): Promise<void> {
    await this.api("/clients", "POST", {
      clientId: this.env.AUTH_CLIENT_ID,
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: true,
      serviceAccountsEnabled: true,
      redirectUris: [`${this.env.APP_PUBLIC_URL}/auth/callback`],
      webOrigins: [this.env.APP_PUBLIC_URL],
      secret: this.env.AUTH_CLIENT_SECRET,
    });
  }

  async ensureRealmRoles(): Promise<void> {
    await this.api("/roles", "POST", { name: "flan-dealer" });
    await this.api("/roles", "POST", { name: "flan-counterpart" });
  }

  async ensureRequiredActions(): Promise<void> {
    for (const alias of ["VERIFY_EMAIL", "UPDATE_PROFILE", "UPDATE_PASSWORD", "VERIFY_PROFILE"]) {
      await this.api(`/authentication/required-actions/${alias}`, "PUT", { alias, enabled: false });
    }
  }

  async getUserByUsername(username: string): Promise<KcUser | null> {
    const found = (await this.api(`/users?username=${encodeURIComponent(username)}&exact=true`, "GET")) as KcUser[];
    if (!Array.isArray(found) || found.length === 0) return null;
    return found[0];
  }

  async findRealmRole(name: "flan-dealer" | "flan-counterpart"): Promise<{ id: string; name: string }> {
    const roles = (await this.api("/roles", "GET")) as { id: string; name: string }[];
    const role = roles.find((r) => r.name === name);
    if (!role) throw new Error(`realm role ${name} missing`);
    return role;
  }

  async ensureUser(username: string, password: string, role: "flan-dealer" | "flan-counterpart" | null, namespace: string): Promise<KcUser> {
    await this.api("/users", "POST", {
      username,
      enabled: true,
      email: `${username}@flan.invalid`,
      emailVerified: true,
      credentials: [{ type: "password", value: password, temporary: false }],
      attributes: { flan_namespace: [namespace] },
      requiredActions: [],
    });
    let user = await this.getUserByUsername(username);
    if (!user) throw new Error(`user ${username} not created`);
    await this.api(`/users/${user.id}/reset-password`, "PUT", { type: "password", value: password, temporary: false });
    if (role) {
      const realmRole = await this.findRealmRole(role);
      await this.api(`/users/${user.id}/role-mappings/realm`, "POST", [realmRole]);
    }
    user = await this.getUserByUsername(username);
    if (!user) throw new Error(`user ${username} missing after setup`);
    return user;
  }

  async setRequiredActions(userId: string, actions: string[]): Promise<void> {
    await this.api(`/users/${userId}`, "PUT", { requiredActions: actions });
  }

  async hasOtpCredential(userId: string): Promise<boolean> {
    const creds = (await this.api(`/users/${userId}/credentials`, "GET")) as { type: string }[];
    return Array.isArray(creds) && creds.some((c) => c.type === "otp");
  }

  async disableUser(userId: string): Promise<void> {
    await this.api(`/users/${userId}`, "PUT", { enabled: false });
  }

  async setPassword(userId: string, password: string): Promise<void> {
    await this.api(`/users/${userId}/reset-password`, "PUT", { type: "password", value: password, temporary: false });
  }
}
