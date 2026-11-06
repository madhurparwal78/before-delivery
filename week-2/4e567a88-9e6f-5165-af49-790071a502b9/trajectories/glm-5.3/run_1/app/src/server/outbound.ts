// Outbound HTTP under the published address rules: only http/https, only public addresses.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class AddressRefusedError extends Error {}
export class FetchFailedError extends Error {}
export class TooLargeError extends Error {}

export interface OutboundOptions {
  allowedHosts: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

interface FetchedResponse {
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/** True when the host is exempt by OUTBOUND_ALLOWED_HOSTS (exact, case-insensitive). */
function isExempt(host: string, allowedHosts: string[]): boolean {
  const bare = host.split(":")[0].toLowerCase();
  return allowedHosts.includes(bare);
}

/** Parse an IPv6 literal (after bracket stripping) to eight numeric groups. */
function parseV6(ip: string): number[] | null {
  const normalized = (() => {
    try {
      return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      return null;
    }
  })();
  if (!normalized) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const parts = s.split(":").filter((p) => p !== "");
    const groups: number[] = [];
    for (const p of parts) {
      if (p.includes(".")) {
        // Trailing IPv4 dotted part occupies two groups.
        const v4 = p.split(".").map((n) => Number(n));
        if (v4.length !== 4 || v4.some((n) => n < 0 || n > 255)) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      groups.push(Number.parseInt(p, 16));
    }
    return groups;
  };
  if (halves.length === 1) {
    const groups = parseGroups(normalized);
    if (!groups || groups.length !== 8) return null;
    return groups;
  }
  const left = parseGroups(halves[0]);
  const right = parseGroups(halves[1]);
  if (!left || !right || left.length + right.length > 7) return null;
  const zeros = new Array(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

function forbiddenV6Groups(g: number[]): boolean {
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) return true; // ::1 loopback
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    // IPv4-mapped: check the embedded IPv4 address.
    return forbiddenV4(`${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`);
  }
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] !== 0) return true; // other IPv4-translated/embedded
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function ipLiteralIsForbidden(ip: string): boolean {
  // Only canonical IPv4/IPv6 dotted/colon forms; decimal/octal/hex IPv4 must be refused.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const parts = v4.slice(1).map((d) => Number(d));
    if (parts.some((p) => p < 0 || p > 255)) return true;
    return forbiddenV4(parts.join("."));
  }
  if (!ip.includes(":")) return true; // a bare number is not an address we accept
  const groups = parseV6(ip);
  if (!groups) return true; // unparseable forms are refused
  return forbiddenV6Groups(groups);
}

function forbiddenV4(addr: string): boolean {
  const o = addr.split(".").map((n) => Number(n));
  const [a, b] = o;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + broadcast + reserved
  return false;
}


async function resolveChecked(hostname: string): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare === "localhost") throw new AddressRefusedError("localhost refused");
  if (isIP(bare)) {
    if (ipLiteralIsForbidden(bare)) throw new AddressRefusedError(`address refused: ${bare}`);
    return [bare];
  }
  const records = await dnsLookup(bare, { all: true, verbatim: true });
  if (records.length === 0) throw new FetchFailedError(`no address for ${bare}`);
  for (const r of records) {
    if (ipLiteralIsForbidden(r.address)) throw new AddressRefusedError(`address refused: ${r.address}`);
  }
  return records.map((r) => r.address);
}

/** Options shared by image fetch and webhook delivery. */
export interface OutboundRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Buffer;
  followRedirects: number;
  maxBytes: number;
  timeoutMs: number;
}

export class Outbound {
  constructor(private allowedHosts: string[]) {}

  /** Refuse the address without any request when it is not public. */
  async checkAddress(url: string): Promise<void> {
    const parsed = this.parse(url);
    if (!isExempt(parsed.hostname, this.allowedHosts)) {
      await resolveChecked(parsed.hostname);
    }
  }

  private parse(url: string): { protocol: string; host: string; hostname: string; port: string; path: string } {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new AddressRefusedError("not a url");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new AddressRefusedError("protocol refused");
    return {
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      path: `${u.pathname}${u.search}`,
    };
  }

  /**
   * Perform the request under the address rules. Every redirect target is re-checked.
   * Resolves with the final response. Non-2xx statuses resolve so callers can decide.
   */
  async fetch(req: OutboundRequest): Promise<FetchedResponse> {
    return this.fetchStep(req, req.followRedirects, 0);
  }

  private async fetchStep(req: OutboundRequest, redirectsLeft: number, depth: number): Promise<FetchedResponse> {
    if (depth > 3 + req.followRedirects + 1) throw new FetchFailedError("too many hops");
    const parsed = this.parse(req.url);
    const exempt = isExempt(parsed.hostname, this.allowedHosts);
    let ips: string[] = [];
    if (!exempt) {
      ips = await resolveChecked(parsed.hostname);
    }
    const isTls = parsed.protocol === "https:";
    const port = parsed.port || (isTls ? "443" : "80");
    return new Promise<FetchedResponse>((resolve, reject) => {
      const r = (isTls ? httpsRequest : httpRequest)(
        {
          host: ips[0] ?? parsed.hostname,
          port,
          method: req.method,
          path: parsed.path,
          headers: { ...req.headers, host: parsed.host },
          timeout: req.timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            const location = res.headers.location;
            res.resume();
            if (redirectsLeft <= 0 || !location) {
              resolve({ status, body: Buffer.alloc(0), headers: res.headers });
              return;
            }
            const next = new URL(location, req.url).toString();
            this.fetchStep({ ...req, url: next, method: "GET", body: undefined }, redirectsLeft - 1, depth + 1)
              .then(resolve, reject);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.byteLength;
            if (size > req.maxBytes) {
              r.destroy();
              reject(new TooLargeError("too large"));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve({ status, body: Buffer.concat(chunks), headers: res.headers }));
          res.on("error", () => reject(new FetchFailedError("read failed")));
        },
      );
      r.on("timeout", () => {
        r.destroy();
        reject(new FetchFailedError("timeout"));
      });
      r.on("error", (e) => {
        reject(e instanceof AddressRefusedError ? e : new FetchFailedError(String(e)));
      });
      if (req.body) r.end(req.body);
      else r.end();
    });
  }
}
