import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.js";

type Reason = "invalid" | "credentials" | "metadata" | "loopback" | "link_local" | "private_address" | "unresolvable" | "scheme";
const ORDER: Reason[] = ["invalid", "credentials", "metadata", "loopback", "link_local", "private_address", "unresolvable", "scheme"];
const MAX_URL = 2048;

type Octets = [number, number, number, number];
const inCidr = (o: Octets, base: number, bits: number): boolean => {
  const value = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
};
const cidr = (text: string): [number, number] => {
  const [addr, bits] = text.split("/");
  const o = addr!.split(".").map(Number);
  return [(((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0), Number(bits)];
};
const PRIVATE_V4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"].map(cidr);

/** What an IPv4 address is on its own, before the allowed ranges are consulted. */
function classifyV4(o: Octets): Reason | null {
  if (o.join(".") === "169.254.169.254") return "metadata";
  if (o[0] === 127) return "loopback";
  if (o[0] === 169 && o[1] === 254) return "link_local";
  return PRIVATE_V4.some(([base, bits]) => inCidr(o, base, bits)) ? "private_address" : null;
}

const allowedV4 = (o: Octets): boolean => config.allowedCidrs.some((c) => inCidr(o, c.base, c.bits));

function parseV6(text: string): number[] | null {
  let head = text;
  let tailBytes: number[] = [];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(head);
  if (dotted) {
    tailBytes = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3]), Number(dotted[4])];
    head = head.slice(0, dotted.index) + "0:0";
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string): number[] => (s === "" ? [] : s.split(":").map((g) => parseInt(g, 16)));
  const left = groups(halves[0]!);
  const right = halves.length === 2 ? groups(halves[1]!) : [];
  const fill = 8 - left.length - right.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0 || [...left, ...right].some((g) => Number.isNaN(g) || g > 0xffff)) return null;
  const words = [...left, ...Array<number>(halves.length === 2 ? fill : 0).fill(0), ...right];
  const bytes = words.flatMap((w) => [w >> 8, w & 255]);
  if (tailBytes.length) bytes.splice(12, 4, ...tailBytes);
  return bytes;
}

/** An IPv4 address hidden inside an IPv6 one is judged as if it were the literal address. */
function embeddedV4(b: number[]): Octets | null {
  const zeros = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);
  const last = b.slice(12, 16) as Octets;
  if (zeros(0, 10) && b[10] === 255 && b[11] === 255) return last;
  if (zeros(0, 12) && last.some((x) => x !== 0) && !(zeros(12, 15) && b[15] === 1)) return last;
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return last;
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0 && b[5] === 1) return [b[6]!, b[7]!, b[9]!, b[10]!];
  if (b[0] === 0x20 && b[1] === 0x02) return [b[2]!, b[3]!, b[4]!, b[5]!];
  return null;
}

function classifyV6(b: number[]): Reason | null {
  if (b.every((x) => x === 0)) return "private_address";
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return "loopback";
  if (b[0] === 0xfd && b[1] === 0x00 && b[2] === 0x0e && b[3] === 0xc2 && b.slice(4, 14).every((x) => x === 0) && b[14] === 0x02 && b[15] === 0x54) return "metadata";
  const embedded = embeddedV4(b);
  if (embedded) return classifyAddress(embedded);
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return "link_local";
  if ((b[0]! & 0xfe) === 0xfc) return "private_address";
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return "private_address";
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return "private_address";
  return null;
}

function classifyAddress(o: Octets): Reason | null {
  const reason = classifyV4(o);
  return reason === "private_address" && allowedV4(o) ? null : reason;
}

interface Checked { reason: Reason | null; normalized: string }

const unescapeHost = (host: string): string => host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

/** The address rules of the brief, in its precedence. `reason` is null when the address may receive messages. */
export async function checkEndpointUrl(raw: string): Promise<Checked> {
  let url: URL;
  try {
    if (raw.length > MAX_URL) throw new Error("long");
    url = new URL(raw);
  } catch {
    return { reason: "invalid", normalized: raw };
  }
  if (!url.hostname) return { reason: "invalid", normalized: raw };
  const normalized = url.href;
  if (url.username || url.password) return { reason: "credentials", normalized };
  const host = unescapeHost(url.hostname);
  const found: Reason[] = [];
  let allInAllowed = true;
  if (host === "metadata.google.internal") found.push("metadata");
  else if (host === "localhost" || host.endsWith(".localhost")) found.push("loopback");
  else {
    const family = isIP(host);
    let addresses: string[];
    if (family) addresses = [host];
    else {
      try {
        addresses = (await lookup(host, { all: true })).map((a) => a.address);
      } catch {
        addresses = [];
      }
      if (addresses.length === 0) found.push("unresolvable");
    }
    for (const address of addresses) {
      const v6 = address.includes(":") ? parseV6(address) : null;
      const v4 = v6 ? embeddedV4(v6) : address.includes(":") ? null : (address.split(".").map(Number) as Octets);
      const reason = v6 ? classifyV6(v6) : classifyAddress(v4!);
      if (reason) found.push(reason);
      if (!(v4 && allowedV4(v4))) allInAllowed = false;
    }
  }
  const ranked = found.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
  if (ranked) return { reason: ranked, normalized };
  const https = url.protocol === "https:";
  const http = url.protocol === "http:";
  if (https || (http && allInAllowed)) return { reason: null, normalized };
  return { reason: "scheme", normalized };
}
