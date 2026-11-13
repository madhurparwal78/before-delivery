import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type AddressReason =
  | 'invalid'
  | 'credentials'
  | 'metadata'
  | 'loopback'
  | 'link_local'
  | 'private_address'
  | 'unresolvable'
  | 'scheme';

export const ADDRESS_MESSAGE = "That address can't receive price messages. Use a public https address.";

export const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function v4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!/^\d{1,3}$/.test(p) || n > 255) return null;
    v = v * 256 + n;
  }
  return v >>> 0;
}

function inCidr4(addr: number, cidr: [string, number]): boolean {
  const base = v4ToLong(cidr[0]);
  if (base === null) return false;
  const mask = cidr[1] === 0 ? 0 : (0xffffffff << (32 - cidr[1])) >>> 0;
  return (addr & mask) === (base & mask);
}

/** Numeric forms read as their real address: decimal, octal, hex, IPv4-mapped IPv6. */
function parseIpv4Literal(host: string): string | null {
  if (isIP(host) === 4) return host;
  // dotted forms with octal/hex components
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host)) {
    const parts = host.split('.');
    if (parts.every((p) => /^0[xX]/.test(p) || /^0[0-7]*$/.test(p) || /^[1-9]\d*$/.test(p) || p === '0')) {
      const nums = parts.map((p) => {
        if (/^0[xX]/.test(p)) return parseInt(p, 16);
        if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
        return Number(p);
      });
      if (nums.every((n) => n >= 0 && n <= 255)) return nums.join('.');
      return null;
    }
    return null;
  }
  return null;
}

/** Expand an IPv6 literal to 8 hextets; returns null when not IPv6. */
export function expandIpv6(host: string): number[] | null {
  const bare = host.replace(/^\[|\]$/g, '');
  if (!bare.includes(':')) return null;
  let h = bare;
  // IPv4-mapped tail
  const lastColon = h.lastIndexOf(':');
  const tail = h.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4Literal(tail);
    if (!v4) return null;
    const n = v4ToLong(v4);
    if (n === null) return null;
    h = h.slice(0, lastColon + 1) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  // embedded 6to4 / NAT64 handled by caller through group extraction
  if (h.includes('::')) {
    const parts = h.split('::');
    if (parts.length > 2) return null;
    const left = parts[0] === '' ? [] : parts[0].split(':');
    const right = parts[1] === '' ? [] : parts[1].split(':');
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    h = [...left, ...new Array(fill).fill('0'), ...right].join(':');
  }
  const groups = h.split(':');
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** The IPv4 address embedded in an IPv6 form, when there is one. */
function embeddedV4(groups: number[]): { addr: number } | null {
  // IPv4-compatible ::/96 and NAT64 64:ff9b::/96: the last 32 bits.
  if (groups.slice(0, 6).every((g) => g === 0)) {
    if (!(groups[6] === 0 && groups[7] === 0)) return { addr: ((groups[6] << 16) | groups[7]) >>> 0 };
  }
  // IPv4-mapped ::ffff:0:0/96.
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    return { addr: ((groups[6] << 16) | groups[7]) >>> 0 };
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return { addr: ((groups[6] << 16) | groups[7]) >>> 0 };
  }
  // NAT64 64:ff9b:1::/48 (RFC 6052 section 2.2 for a /48 prefix): the first two
  // IPv4 bytes fill bits 48-63, bits 64-71 are zero, the last two bytes fill
  // bits 72-87.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) {
    if (groups[6] === 0 && groups[7] === 0 && (groups[4] & 0xff00) === 0) {
      const b1 = (groups[3] >> 8) & 0xff;
      const b2 = groups[3] & 0xff;
      const b3 = groups[4] & 0xff;
      const b4 = (groups[5] >> 8) & 0xff;
      return { addr: ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >>> 0 };
    }
  }
  // 6to4 2002::/16: bits 16-47, the two hextets after 2002.
  if (groups[0] === 0x2002) {
    return { addr: ((groups[1] << 16) | groups[2]) >>> 0 };
  }
  return null;
}

function v6GroupsPrivate(groups: number[]): boolean {
  // ::, fc00::/7, Teredo 2001::/32, documentation 2001:db8::/32
  if (groups.every((g) => g === 0)) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0 && groups[6] === 0) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  return false;
}

function v6GroupsLoopback(groups: number[]): boolean {
  return groups.every((g, i) => (i === 7 ? g === 1 : g === 0));
}

function v6GroupsLinkLocal(groups: number[]): boolean {
  return (groups[0] & 0xffc0) === 0xfe80;
}

function v4Classify(addr: number, allowedCidrs: string[]): 'metadata' | 'loopback' | 'link_local' | 'private_address' | null {
  if (addr === v4ToLong('169.254.169.254')) return 'metadata';
  const lo = v4ToLong('127.0.0.0')!;
  if ((addr >>> 24) === (lo >>> 24)) return 'loopback';
  if (inCidr4(addr, ['169.254.0.0', 16])) return 'link_local';
  for (const [base, bits] of PRIVATE_V4) {
    if (inCidr4(addr, [base, bits])) {
      const exempt = allowedCidrs.some((c) => {
        const [b, n] = c.split('/');
        const baseN = v4ToLong(b.trim());
        const bitsN = Number(n ?? 32);
        if (baseN === null || Number.isNaN(bitsN)) return false;
        return inCidr4(addr, [b.trim(), bitsN]);
      });
      if (exempt) return null;
      return 'private_address';
    }
  }
  return null;
}

const METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);

/** The published endpoint address rules, checked in the published order. */
export async function checkEndpointAddress(
  rawUrl: string,
  allowedCidrs: string[],
  dnsLookup: (h: string) => Promise<string[]> = defaultLookup
): Promise<{ ok: true; normalised: string } | { ok: false; reason: AddressReason; normalised: string | null }> {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return { ok: false, reason: 'invalid', normalised: null };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid', normalised: null };
  }
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'credentials', normalised: null };

  const host = u.hostname.replace(/\.$/, '');
  const isV6Literal = host.includes(':') || host.startsWith('[');
  const normalised = `${u.protocol}//${u.host.toLowerCase()}${u.pathname === '' ? '/' : u.pathname}${u.search}`;

  // metadata by name
  const hostNoDot = host.replace(/\.$/, '');
  if (METADATA_HOSTS.has(hostNoDot) || hostNoDot.endsWith('.metadata.google.internal')) {
    return { ok: false, reason: 'metadata', normalised };
  }

  let groups: number[] | null = null;
  let v4: number | null = null;
  if (isV6Literal) {
    groups = expandIpv6(host);
    if (!groups) return { ok: false, reason: 'invalid', normalised };
    if (v6GroupsLoopback(groups)) return { ok: false, reason: 'loopback', normalised };
    if (v6GroupsLinkLocal(groups)) return { ok: false, reason: 'link_local', normalised };
    if (v6GroupsPrivate(groups)) return { ok: false, reason: 'private_address', normalised };
    const emb = embeddedV4(groups);
    if (emb) v4 = emb.addr;
  } else {
    const lit = parseIpv4Literal(host);
    if (lit) {
      const n = v4ToLong(lit);
      if (n !== null) v4 = n;
    }
  }

  if (v4 !== null) {
    const cls = v4Classify(v4, allowedCidrs);
    if (cls === 'metadata') return { ok: false, reason: 'metadata', normalised };
    if (cls === 'loopback') return { ok: false, reason: 'loopback', normalised };
    if (cls === 'link_local') return { ok: false, reason: 'link_local', normalised };
    if (cls === 'private_address') return { ok: false, reason: 'private_address', normalised };
  }

  // loopback by name
  if (!isV6Literal && !v4) {
    const lower = host.toLowerCase();
    if (lower === 'localhost' || lower.endsWith('.localhost')) {
      return { ok: false, reason: 'loopback', normalised };
    }
  }

  // resolve hostnames; every address must pass
  if (!isV6Literal && v4 === null) {
    let addrs: string[];
    try {
      addrs = await dnsLookup(host);
    } catch {
      return { ok: false, reason: 'unresolvable', normalised };
    }
    if (addrs.length === 0) return { ok: false, reason: 'unresolvable', normalised };
    for (const a of addrs) {
      if (isIP(a) === 4) {
        const n = v4ToLong(a);
        if (n !== null) {
          const cls = v4Classify(n, allowedCidrs);
          if (cls) return { ok: false, reason: cls, normalised };
        }
      } else if (isIP(a) === 6) {
        const g = expandIpv6(a);
        if (g) {
          const emb = embeddedV4(g);
          if (emb) {
            const cls = v4Classify(emb.addr, allowedCidrs);
            if (cls) return { ok: false, reason: cls, normalised };
          } else {
            if (v6GroupsLoopback(g)) return { ok: false, reason: 'loopback', normalised };
            if (v6GroupsLinkLocal(g)) return { ok: false, reason: 'link_local', normalised };
            if (v6GroupsPrivate(g)) return { ok: false, reason: 'private_address', normalised };
          }
        }
      }
    }
  }

  if (u.protocol !== 'https:') {
    const httpOk = hostIsAllowedHttp(host, v4, allowedCidrs);
    if (!httpOk) return { ok: false, reason: 'scheme', normalised };
  }

  return { ok: true, normalised };
}

function hostIsAllowedHttp(host: string, v4: number | null, allowed: string[]): boolean {
  if (v4 !== null) {
    return allowed.some((c) => {
      const [b, n] = c.split('/');
      const baseN = v4ToLong(b.trim());
      const bitsN = Number(n ?? 32);
      if (baseN === null || Number.isNaN(bitsN)) return false;
      return inCidr4(v4, [b.trim(), bitsN]);
    });
  }
  // a hostname is never inside a listed range
  return false;
}

/** URL identity for `endpoint_exists`: parsed and normalised. */
export function normaliseUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl.trim());
    let host = u.host.toLowerCase();
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      host = u.hostname.toLowerCase();
    }
    return `${u.protocol}//${host}${u.pathname === '' ? '/' : u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

async function defaultLookup(h: string): Promise<string[]> {
  const r = await lookup(h, { all: true });
  return r.map((x) => x.address);
}
