import type { FlanEnv } from "../shared/env.js";
import { request } from "undici";
import { copyFor } from "../shared/feedback.js";

export type RegisterError =
  | { kind: "timeout" }
  | { kind: "unreachable" }
  | { kind: "server" }
  | { kind: "busy"; retryAfter: number }
  | { kind: "malformed" }
  | { kind: "missing" };

export class RegisterError2 extends Error {
  constructor(public detail: RegisterError) {
    super("register error");
  }
}

export function isRegisterError(e: unknown): e is RegisterError2 {
  return e instanceof RegisterError2;
}


export interface VarietyRecord {
  reference: string;
  issue: string;
  mintmark: string;
  revision: number;
  image_path: string;
}

export interface AlbumRecord {
  set: string;
  title: string;
  revision: number;
  holes: { label: string; reference: string; mintmark: string }[];
}

export class Register {
  constructor(private env: FlanEnv) {}

  private async get(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    try {
      const res = await request(url, {
        method: "GET",
        bodyTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
        headersTimeout: this.env.FLAN_PROVIDER_TIMEOUT_MS,
      });
      const body = await res.body.text();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        headers[k] = Array.isArray(v) ? v[0] : (v as string);
      }
      return { status: res.statusCode, body, headers };
    } catch {
      throw new RegisterError2({ kind: "unreachable" });
    }
  }

  async variety(reference: string): Promise<VarietyRecord> {
    const url = `${this.env.WIREMOCK_URL}/catalog/varieties?reference=${encodeURIComponent(reference)}`;
    const res = await this.get(url).catch(() => {
      throw new RegisterError2({ kind: "timeout" });
    });
    if (res.status === 429) {
      const retryAfter = Number.parseInt(res.headers["retry-after"] ?? String(this.env.FLAN_CATALOG_RETRY_S), 10);
      throw new RegisterError2({ kind: "busy", retryAfter: Number.isFinite(retryAfter) ? retryAfter : this.env.FLAN_CATALOG_RETRY_S });
    }
    if (res.status === 404) {
      throw new RegisterError2({ kind: "missing" });
    }
    if (res.status >= 500) {
      throw new RegisterError2({ kind: "server" });
    }
    if (res.status !== 200) {
      throw new RegisterError2({ kind: "server" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new RegisterError2({ kind: "malformed" });
    }
    if (!validVariety(parsed, reference)) {
      throw new RegisterError2({ kind: "malformed" });
    }
    return parsed;
  }

  async album(set: string): Promise<AlbumRecord> {
    const url = `${this.env.WIREMOCK_URL}/catalog/albums?set=${encodeURIComponent(set)}`;
    const res = await this.get(url).catch(() => {
      throw new RegisterError2({ kind: "timeout" });
    });
    if (res.status === 429) {
      throw new RegisterError2({ kind: "busy", retryAfter: this.env.FLAN_CATALOG_RETRY_S });
    }
    if (res.status >= 500 || res.status !== 200) {
      throw new RegisterError2({ kind: "server" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new RegisterError2({ kind: "malformed" });
    }
    if (!validAlbum(parsed, set, this.env.FLAN_ALBUM_MAX_HOLES)) {
      throw new RegisterError2({ kind: "malformed" });
    }
    return parsed;
  }

  async image(path: string): Promise<{ body: string; contentType: string }> {
    const url = `${this.env.WIREMOCK_URL}${path}`;
    const res = await this.get(url).catch(() => {
      throw new RegisterError2({ kind: "timeout" });
    });
    if (res.status !== 200) {
      throw new RegisterError2({ kind: "server" });
    }
    return { body: res.body, contentType: res.headers["content-type"] ?? "image/svg+xml" };
  }
}

function validVariety(v: unknown, reference: string): v is VarietyRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.reference === "string" &&
    r.reference === reference &&
    typeof r.issue === "string" &&
    typeof r.mintmark === "string" &&
    typeof r.revision === "number" &&
    Number.isInteger(r.revision) &&
    r.revision > 0 &&
    typeof r.image_path === "string" &&
    r.image_path.startsWith("/catalog/images/")
  );
}

function validAlbum(v: unknown, set: string, maxHoles: number): v is AlbumRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.set !== set || typeof r.title !== "string" || !Number.isInteger(r.revision)) return false;
  if (!Array.isArray(r.holes) || r.holes.length > maxHoles) return false;
  for (const h of r.holes) {
    if (typeof h !== "object" || h === null) return false;
    const hh = h as Record<string, unknown>;
    if (typeof hh.label !== "string" || typeof hh.reference !== "string" || typeof hh.mintmark !== "string") return false;
  }
  return true;
}

export function registerErrorToHttp(detail: RegisterError): { status: number; code: string; message: string; retryAfter?: number } {
  switch (detail.kind) {
    case "busy":
      return { status: 429, code: "catalog_busy", message: copyFor("F_CATALOG_RATE"), retryAfter: detail.retryAfter };
    case "malformed":
      return { status: 502, code: "catalog_malformed", message: copyFor("F_CATALOG_BAD") };
    case "missing":
      return { status: 502, code: "catalog_missing", message: copyFor("F_CATALOG_MISSING") };
    default:
      return { status: 503, code: "catalog_unavailable", message: copyFor("F_CATALOG_WAIT") };
  }
}
