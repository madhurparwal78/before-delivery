export type RefusalClass = 'metadata' | 'loopback' | 'private' | 'link-local' | 'shared' | 'reserved';

interface Cidr4 {
  bytes: [number, number, number, number];
  prefix: number;
}

function cidr4(text: string): Cidr4 {
  const [address, prefix] = text.split('/');
  const parsed = parseIpv4(address ?? '');
  if (!parsed) throw new Error(`bad cidr ${text}`);
  return { bytes: parsed, prefix: Number(prefix) };
}

export function parseIpv4(text: string): [number, number, number, number] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return [bytes[0] as number, bytes[1] as number, bytes[2] as number, bytes[3] as number];
}

/** Parses an IPv6 literal (without brackets) into its 16 bytes. */
export function parseIpv6(text: string): number[] | null {
  let input = text;
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const tail = input.slice(lastColon + 1);
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hex = `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    input = `${input.slice(0, lastColon + 1)}${hex}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? (halves[0] as string).split(':').filter((p) => p !== '') : [];
  const tail = halves.length === 2 && halves[1] ? (halves[1] as string).split(':').filter((p) => p !== '') : [];
  const groups: number[] = [];
  for (const group of [...head, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  }
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (head.length + tail.length > 7) return null;
  const middle = 8 - head.length - tail.length;
  for (const group of head) groups.push(parseInt(group, 16));
  if (halves.length === 2) for (let i = 0; i < middle; i += 1) groups.push(0);
  for (const group of tail) groups.push(parseInt(group, 16));
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

function inCidr4(bytes: readonly number[], range: Cidr4): boolean {
  let remaining = range.prefix;
  for (let i = 0; i < 4; i += 1) {
    if (remaining <= 0) return true;
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((bytes[i] as number) & mask) !== ((range.bytes[i] as number) & mask)) return false;
    remaining -= take;
  }
  return true;
}

function inPrefix6(bytes: readonly number[], prefixHex: string, prefixLength: number): boolean {
  const target = parseIpv6(prefixHex);
  if (!target) return false;
  let remaining = prefixLength;
  for (let i = 0; i < 16; i += 1) {
    if (remaining <= 0) return true;
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((bytes[i] as number) & mask) !== ((target[i] as number) & mask)) return false;
    remaining -= take;
  }
  return true;
}

const LOOPBACK_4 = [cidr4('127.0.0.0/8')];
const PRIVATE_4 = [cidr4('10.0.0.0/8'), cidr4('172.16.0.0/12'), cidr4('192.168.0.0/16')];
const LINK_LOCAL_4 = [cidr4('169.254.0.0/16')];
const SHARED_4 = [cidr4('100.64.0.0/10')];
const RESERVED_4 = [
  cidr4('0.0.0.0/8'),
  cidr4('224.0.0.0/3'),
  cidr4('192.0.0.0/24'),
  cidr4('192.0.2.0/24'),
  cidr4('192.88.99.0/24'),
  cidr4('198.18.0.0/15'),
  cidr4('198.51.100.0/24'),
  cidr4('203.0.113.0/24'),
];

function classifyIpv4(bytes: readonly number[]): RefusalClass | null {
  if (bytes[0] === 169 && bytes[1] === 254 && bytes[2] === 169 && bytes[3] === 254) return 'metadata';
  if (LOOPBACK_4.some((range) => inCidr4(bytes, range))) return 'loopback';
  if (PRIVATE_4.some((range) => inCidr4(bytes, range))) return 'private';
  if (LINK_LOCAL_4.some((range) => inCidr4(bytes, range))) return 'link-local';
  if (SHARED_4.some((range) => inCidr4(bytes, range))) return 'shared';
  if (RESERVED_4.some((range) => inCidr4(bytes, range))) return 'reserved';
  return null;
}

function classifyIpv6(bytes: readonly number[]): RefusalClass | null {
  const mapped = inPrefix6(bytes, '::ffff:0:0', 96);
  if (mapped) return classifyIpv4(bytes.slice(12));
  if (inPrefix6(bytes, 'fd00:ec2::254', 128)) return 'metadata';
  if (inPrefix6(bytes, '::1', 128)) return 'loopback';
  if (inPrefix6(bytes, 'fc00::', 7)) return 'private';
  if (inPrefix6(bytes, 'fe80::', 10)) return 'link-local';
  if (inPrefix6(bytes, '::', 128)) return 'reserved';
  if (inPrefix6(bytes, '2001:db8::', 32)) return 'reserved';
  if (!inPrefix6(bytes, '2000::', 3)) return 'reserved';
  return null;
}

/** Classes an IP address, in the published order. `null` means a public address. */
export function classifyAddress(address: string): RefusalClass | null {
  const v4 = parseIpv4(address);
  if (v4) return classifyIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6) return classifyIpv6(v6);
  return 'reserved';
}

export function isIpLiteral(host: string): boolean {
  if (parseIpv4(host)) return true;
  if (host.startsWith('[') && host.endsWith(']')) return parseIpv6(host) !== null;
  return false;
}
