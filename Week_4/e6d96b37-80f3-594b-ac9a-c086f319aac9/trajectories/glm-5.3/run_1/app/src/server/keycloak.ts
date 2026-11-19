import type { FlanEnv } from "../shared/env.js";
import { request } from "undici";

export class KeycloakError extends Error {
  constructor(public kind: "unavailable" | "rejected") {
    super(kind === "unavailable" ? "keycloak unavailable" : "keycloak rejected");
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export interface UserInfo {
  sub: string;
  preferred_username: string;
  acr: string;
  namespace: string;
  flan_dealer: boolean;
  flan_counterpart: boolean;
}

export class Keycloak {
  constructor(private env: FlanEnv) {}

  get realmUrl(): string {
    return `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}`;
  }

  realmAuthEndpoint(): string {
    return `${this.realmUrl}/protocol/openid-connect/auth`;
  }

  private async tokenRequest(params: Record<string, string>, path: string, basic = true): Promise<TokenResponse> {
    const url = `${this.realmUrl}/protocol/openid-connect/${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (basic) {
      const credentials = Buffer.from(`${this.env.AUTH_CLIENT_ID}:${this.env.AUTH_CLIENT_SECRET}`).toString("base64");
      headers.Authorization = `Basic ${credentials}`;
    }
    const res = await request(url, {
      method: "POST",
      body: new URLSearchParams(params).toString(),
      headers,
      bodyTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
      headersTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
    });
    if (res.statusCode >= 500) {
      await res.body.dump();
      throw new KeycloakError("unavailable");
    }
    if (res.statusCode !== 200) {
      await res.body.dump();
      throw new KeycloakError("rejected");
    }
    return (await res.body.json()) as TokenResponse;
  }

  async serviceToken(): Promise<string> {
    return (await this.tokenRequest({ grant_type: "client_credentials" }, "token")).access_token;
  }

  async codeToken(code: string, redirectUri: string): Promise<{ access_token: string } | null> {
    try {
      const res = await this.tokenRequest(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        },
        "token",
      );
      return { access_token: res.access_token };
    } catch (err) {
      if (err instanceof KeycloakError && err.kind === "rejected") return null;
      throw err;
    }
  }

  async userinfo(token: string): Promise<UserInfo | null> {
    try {
      const res = await request(`${this.realmUrl}/protocol/openid-connect/token/introspect`, {
        method: "POST",
        body: new URLSearchParams({ token }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${this.env.AUTH_CLIENT_ID}:${this.env.AUTH_CLIENT_SECRET}`).toString("base64")}`,
        },
        bodyTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
        headersTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
      });
      if (res.statusCode !== 200) {
        await res.body.dump();
        return null;
      }
      const raw = (await res.body.json()) as Record<string, unknown>;
      if (raw.active !== true) return null;
      const roles = (raw.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
      const username = String(raw.preferred_username ?? "");
      const role = roles.includes("flan-dealer") ? "dealer" : roles.includes("flan-counterpart") ? "counterpart" : "outsider";
      // Seed identities are named <ns>-dealer / <ns>-counterpart / <ns>-outsider.
      const suffix = `-${role}`;
      const namespace = username.endsWith(suffix) ? username.slice(0, -suffix.length) : "";
      return {
        sub: String(raw.sub ?? ""),
        preferred_username: username,
        acr: String(raw.acr ?? "1"),
        namespace,
        flan_dealer: role === "dealer",
        flan_counterpart: role === "counterpart",
      };
    } catch {
      return null;
    }
  }

  async admin(path: string, method: string, body: unknown, token: string): Promise<unknown> {
    const url = `${this.env.KEYCLOAK_URL}/admin/realms/${this.env.KEYCLOAK_REALM}${path}`;
    const res = await request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      bodyTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
      headersTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
    });
    if (res.statusCode >= 500) {
      await res.body.dump();
      throw new KeycloakError("unavailable");
    }
    if (res.statusCode >= 400) {
      await res.body.dump();
      throw new KeycloakError("rejected");
    }
    return res.body.json().catch(() => ({}));
  }
}

