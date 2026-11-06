// Outbound requests (image URL inputs, webhook registration and delivery) reach only public addresses.
// Every address a host resolves to is checked, and the connection is pinned to a checked address so DNS
// cannot change between the check and the request. Adapted from kit/modules/ssrf_guard.

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIPv6 } from "node:net";
import { config } from "../config";

type AddressKind = "public" | "loopback" | "private" | "link-local" | "metadata" | "cgnat" | "multicast" | "unspecified" | "reserved";

const V4_RANGES: ReadonlyArray<readonly [string, number, AddressKind]> = [
  ["169.254.169.254", 32, "metadata"],
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "cgnat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "reserved"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

/** An IPv4 literal in any inet_aton spelling, as an unsigned 32-bit number; null for anything else. */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (/^0x[0-9a-f]+$/i.test(part)) numbers.push(parseInt(part.slice(2), 16));
    else if (/^0[0-7]*$/.test(part)) numbers.push(parseInt(part, 8));
    else if (/^[1-9][0-9]*$/.test(part)) numbers.push(Number(part));
    else return null;
  }
  const last = numbers.pop() as number;
  if (numbers.some((n) => n > 255) || last >= 256 ** (4 - numbers.length)) return null;
  return numbers.reduce((sum, n, i) => sum + n * 256 ** (3 - i), 0) + last;
}

function v4Kind(n: number): AddressKind {
  for (const [range, length, kind] of V4_RANGES) {
    const size = 2 ** (32 - length);
    if (Math.floor(n / size) === Math.floor((parseIPv4(range) as number) / size)) return kind;
  }
  return "public";
}

function parseIPv6(host: string): number[] | null {
  let text = host.replace(/^\[|\]$/g, "").split("%")[0];
  if (!isIPv6(text)) return null;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = parseIPv4(tail[1]) as number;
    text = `${text.slice(0, -tail[1].length)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const a = head ? head.split(":") : [];
  const b = rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array<string>(8 - a.length - b.length).fill("0");
  return [...a, ...fill, ...b].map((word) => parseInt(word, 16));
}

function v6Kind(w: number[]): AddressKind {
  const v4At = (i: number): number => w[i] * 65536 + w[i + 1];
  const zeros = (n: number): boolean => w.slice(0, n).every((x) => x === 0);
  if (zeros(8)) return "unspecified";
  if (zeros(7) && w[7] === 1) return "loopback";
  if (zeros(5) && w[5] === 0xffff) return v4Kind(v4At(6));
  if (zeros(6)) return v4Kind(v4At(6));
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return v4Kind(v4At(6));
  if (w[0] === 0x2002) return v4Kind(v4At(1));
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfec0) return "private";
  if ((w[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((w[0] & 0xff00) === 0xff00) return "multicast";
  return "public";
}

function addressKind(address: string): AddressKind | null {
  if (address.includes(":")) {
    const words = parseIPv6(address);
    return words ? v6Kind(words) : null;
  }
  const n = parseIPv4(address);
  return n === null ? null : v4Kind(n);
}

/** The host exactly as written in the URL text, before WHATWG URL parsing normalises numeric forms. */
function writtenHost(text: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(text.trim());
  return (match ? match[1] : "").toLowerCase();
}

const DOTTED_QUAD = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

interface Checked {
  url: URL;
  addresses: string[];
}

export class Refused extends Error {}

/** Refuses a URL whose host is, or resolves to, anything but public addresses; returns the addresses to use. */
export async function checkAddress(text: string): Promise<Checked> {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Refused("not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Refused("scheme");
  const written = writtenHost(text);
  const literal = addressKind(written.replace(/^\[|\]$/g, "")) !== null;
  if (literal && !written.startsWith("[") && !DOTTED_QUAD.test(written)) throw new Refused("numeric host spelling");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Refused("localhost");
  if (literal) {
    if (addressKind(host) !== "public") throw new Refused("address");
    return { url, addresses: [host] };
  }
  let addresses: string[];
  try {
    addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new Refused("does not resolve");
  }
  const exempt = config.outboundAllowedHosts.includes(host);
  if (!addresses.length || (!exempt && addresses.some((a) => addressKind(a) !== "public"))) throw new Refused("address");
  return { url, addresses };
}

interface Answer {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer;
  tooLarge: boolean;
}

/** One request to an already checked URL, connected to its checked address, never following redirects. */
export function pinnedRequest(
  checked: Checked,
  options: { method: "GET" | "POST"; headers?: Record<string, string>; body?: Buffer; timeoutMs: number; maxBytes: number },
): Promise<Answer> {
  const { url, addresses } = checked;
  const address = addresses[0];
  const family = address.includes(":") ? 6 : 4;
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method,
      headers: { ...options.headers, ...(options.body ? { "Content-Length": String(options.body.length) } : {}) },
      servername: url.hostname,
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          tooLarge = true;
          response.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      const finish = (): void => resolve({
        status: response.statusCode ?? 0,
        location: response.headers.location ?? null,
        contentType: response.headers["content-type"] ?? "",
        body: Buffer.concat(chunks),
        tooLarge,
      });
      response.on("end", finish);
      response.on("close", finish);
      response.on("error", (error) => (tooLarge ? finish() : reject(error)));
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end(options.body);
  });
}
