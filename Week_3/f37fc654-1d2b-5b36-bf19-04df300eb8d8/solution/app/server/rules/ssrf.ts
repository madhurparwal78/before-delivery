// Reference-image fetching (brief: Business rules › Reference images), adapted from kit/modules/ssrf_guard.
// Every address a host resolves to must be public; the connection goes to the checked address and
// each redirect hop is checked again before it is contacted.
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { imageKind } from "./content.js";

const V4_REFUSED: readonly [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** An IPv4 literal in any inet_aton spelling (decimal, octal, hex, 1–4 parts) as a 32-bit number. */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (/^0x[0-9a-f]+$/i.test(p)) nums.push(parseInt(p.slice(2), 16));
    else if (/^0[0-7]*$/.test(p)) nums.push(parseInt(p, 8));
    else if (/^[1-9][0-9]*$/.test(p)) nums.push(Number(p));
    else return null;
  }
  const last = nums.pop();
  if (last === undefined || nums.some((n) => n > 255) || last >= 256 ** (4 - nums.length)) return null;
  return nums.reduce((acc, n, i) => acc + n * 256 ** (3 - i), 0) + last;
}

function v4Public(n: number): boolean {
  return !V4_REFUSED.some(([base, len]) => {
    const size = 2 ** (32 - len);
    return Math.floor(n / size) === Math.floor((parseIPv4(base) ?? 0) / size);
  });
}

function parseIPv6(host: string): number[] | null {
  let s = host.replace(/^\[|\]$/g, "").split("%")[0];
  if (!net.isIPv6(s)) return null;
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v = parseIPv4(tail[1]) ?? 0;
    s = s.slice(0, -tail[1].length) + `${Math.floor(v / 65536).toString(16)}:${(v % 65536).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array<string>(8 - a.length - b.length).fill("0");
  return [...a, ...fill, ...b].map((w) => parseInt(w, 16));
}

function v6Public(w: number[]): boolean {
  const zeros = (n: number): boolean => w.slice(0, n).every((x) => x === 0);
  const v4At = (i: number): number => w[i] * 65536 + w[i + 1];
  if (zeros(8) || (zeros(7) && w[7] === 1)) return false;
  if (zeros(5) && w[5] === 0xffff) return v4Public(v4At(6));
  if (zeros(6)) return v4Public(v4At(6));
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return false;
  return true;
}

/** Whether an IP literal is public; null when `host` is a name rather than an address. */
function isPublicAddress(host: string): boolean | null {
  if (host.includes(":")) {
    const words = parseIPv6(host);
    return words ? v6Public(words) : null;
  }
  const n = parseIPv4(host);
  return n === null ? null : v4Public(n);
}

const MAX_BYTES = 12_582_912;
const MAX_REDIRECTS = 3;

type ReferenceImage =
  | { ok: true; sourceUrl: string; contentType: "image/jpeg" | "image/png"; bytes: Buffer }
  | { ok: false; reason: "unsafe" | "failed" };

interface Hop {
  status: number;
  location: string | null;
  bytes: Buffer;
}

function requestPinned(url: URL, address: string, family: number, deadline: number): Promise<Hop> {
  const lookup: LookupFunction = (_host, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: "GET", lookup, timeout: Math.max(1, deadline - Date.now()) }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, location: res.headers.location ?? null, bytes: Buffer.alloc(0) });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) req.destroy(new Error("too large"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, location: null, bytes: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error("timeout")), Math.max(1, deadline - Date.now()));
    req.on("close", () => clearTimeout(timer));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function checkedAddress(url: URL): Promise<{ address: string; family: number } | "unsafe" | "failed"> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unsafe";
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const literal = isPublicAddress(host);
  if (literal !== null) return literal ? { address: host, family: host.includes(":") ? 6 : 4 } : "unsafe";
  if (host === "localhost" || host.endsWith(".localhost")) return "unsafe";
  let found: { address: string; family: number }[];
  try {
    found = await dns.lookup(host, { all: true });
  } catch {
    return "failed";
  }
  if (!found.length) return "failed";
  if (found.some((a) => !isPublicAddress(a.address))) return "unsafe";
  return found[0];
}

export async function fetchReferenceImage(address: string): Promise<ReferenceImage> {
  const deadline = Date.now() + 10_000;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = await checkedAddress(url);
    if (target === "unsafe" || target === "failed") return { ok: false, reason: target };
    let answer: Hop;
    try {
      answer = await requestPinned(url, target.address, target.family, deadline);
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      try {
        url = new URL(answer.location, url);
      } catch {
        return { ok: false, reason: "failed" };
      }
      continue;
    }
    if (answer.status !== 200) return { ok: false, reason: "failed" };
    const kind = imageKind(answer.bytes);
    return kind ? { ok: true, sourceUrl: address, contentType: kind, bytes: answer.bytes } : { ok: false, reason: "failed" };
  }
  return { ok: false, reason: "failed" };
}
