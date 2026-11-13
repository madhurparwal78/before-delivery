import { lookup } from 'node:dns/promises';
import { config } from '../config.js';

export type RefusalReason =
  | 'invalid'
  | 'credentials'
  | 'metadata'
  | 'loopback'
  | 'link_local'
  | 'private_address'
  | 'unresolvable'
  | 'scheme';

const PRECEDENCE: RefusalReason[] = [
  'invalid',
  'credentials',
  'metadata',
  'loopback',
  'link_local',
  'private_address',
  'unresolvable',
  'scheme',
];

const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

const PRIVATE_V6 = ['::/128', 'fc00::/7', '2001::/32', '2001:db8::/32'];

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function readHextets(part: string): number[] | null {
  if (part === '') return [];
  const bytes: number[] = [];
  for (const piece of part.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
    const value = Number.parseInt(piece, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function parseIpv6(text: string): number[] | null {
  let body = text;
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1);
  if (!body.includes(':')) return null;
  const lastColon = body.lastIndexOf(':');
  const lastPart = body.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const dotted = parseIpv4(lastPart);
    if (dotted === null) return null;
    const first = ((dotted[0] << 8) | dotted[1]).toString(16);
    const second = ((dotted[2] << 8) | dotted[3]).toString(16);
    body = `${body.slice(0, lastColon + 1)}${first}:${second}`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const head = readHextets(halves[0]);
  const rest = halves.length === 2 ? readHextets(halves[1]) : [];
  if (head === null || rest === null) return null;
  if (halves.length === 2) {
    const fill = 16 - head.length - rest.length;
    if (fill < 0) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...rest];
  }
  return head.length === 16 ? head : null;
}

function inCidr(bytes: number[], cidr: string): boolean {
  const [network, lengthText] = cidr.split('/');
  const prefix = Number(lengthText);
  const target = bytes.length === 4 ? parseIpv4(network) : parseIpv6(network);
  if (target === null || target.length !== bytes.length) return false;
  let remaining = prefix;
  for (let index = 0; index < bytes.length && remaining > 0; index += 1) {
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[index] & mask) !== (target[index] & mask)) return false;
    remaining -= take;
  }
  return true;
}

/** An embedded IPv4 is judged exactly as if it were the literal address. */
function embeddedIpv4(bytes: number[]): number[] | null {
  const zeros = (from: number, to: number): boolean => bytes.slice(from, to).every((byte) => byte === 0);
  if (inCidr(bytes, '2002::/16')) return bytes.slice(2, 6);
  if (inCidr(bytes, '64:ff9b::/96')) return bytes.slice(12, 16);
  if (inCidr(bytes, '64:ff9b:1::/48') && bytes[8] === 0) {
    return [bytes[6], bytes[7], bytes[9], bytes[10]];
  }
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12, 16);
  if (zeros(0, 12) && !zeros(12, 16)) return bytes.slice(12, 16);
  return null;
}

function allowed(bytes: number[]): boolean {
  return config.allowedEndpointCidrs.some((cidr) => {
    const network = cidr.split('/')[0];
    const isV4 = network.includes('.');
    if (isV4 !== (bytes.length === 4)) return false;
    return inCidr(bytes, cidr);
  });
}

interface AddressJudgement {
  reason: RefusalReason | null;
  inAllowedRange: boolean;
}

function judgeAddress(raw: number[]): AddressJudgement {
  let bytes = raw;
  if (bytes.length === 16) {
    if (inCidr(bytes, 'fd00:ec2::254/128')) return { reason: 'metadata', inAllowedRange: false };
    const embedded = embeddedIpv4(bytes);
    if (embedded !== null) bytes = embedded;
  }
  if (bytes.length === 4) {
    if (inCidr(bytes, '169.254.169.254/32')) return { reason: 'metadata', inAllowedRange: false };
    if (inCidr(bytes, '127.0.0.0/8')) return { reason: 'loopback', inAllowedRange: false };
    if (inCidr(bytes, '169.254.0.0/16')) return { reason: 'link_local', inAllowedRange: false };
    const isAllowed = allowed(bytes);
    if (PRIVATE_V4.some((cidr) => inCidr(bytes, cidr)) && !isAllowed) {
      return { reason: 'private_address', inAllowedRange: false };
    }
    return { reason: null, inAllowedRange: isAllowed };
  }
  if (inCidr(bytes, '::1/128')) return { reason: 'loopback', inAllowedRange: false };
  if (inCidr(bytes, 'fe80::/10')) return { reason: 'link_local', inAllowedRange: false };
  const isAllowed = allowed(bytes);
  if (PRIVATE_V6.some((cidr) => inCidr(bytes, cidr)) && !isAllowed) {
    return { reason: 'private_address', inAllowedRange: false };
  }
  return { reason: null, inAllowedRange: isAllowed };
}

function undotted(hostname: string): string {
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
}

export interface AddressCheck {
  ok: boolean;
  reason: RefusalReason | null;
  normalisedUrl: string;
}

/** URL identity: scheme and host lower-cased, default port dropped, empty path read as `/`. */
export function normaliseUrl(url: URL): string {
  const port = url.port === '' ? '' : `:${url.port}`;
  const path = url.pathname === '' ? '/' : url.pathname;
  return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${path}${url.search}`;
}

/** The published endpoint address rules, run on save and again before each test send. */
export async function checkEndpointAddress(raw: string): Promise<AddressCheck> {
  const refuse = (reason: RefusalReason): AddressCheck => ({ ok: false, reason, normalisedUrl: '' });
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 2048) return refuse('invalid');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return refuse('invalid');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    if (url.username !== '' || url.password !== '') return refuse('credentials');
    return refuse('scheme');
  }
  if (url.username !== '' || url.password !== '') return refuse('credentials');

  const hostname = undotted(url.hostname.toLowerCase());
  const reasons: RefusalReason[] = [];
  let everyAddressAllowed = true;

  if (hostname === 'metadata.google.internal') {
    reasons.push('metadata');
  } else if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    reasons.push('loopback');
  } else {
    const literal = parseIpv4(hostname) ?? parseIpv6(hostname);
    let addresses: number[][] = [];
    if (literal !== null) {
      addresses = [literal];
    } else {
      try {
        const found = await Promise.race([
          lookup(hostname, { all: true }),
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('lookup timed out')), 2_000);
          }),
        ]);
        addresses = found
          .map((entry) => (entry.family === 4 ? parseIpv4(entry.address) : parseIpv6(entry.address)))
          .filter((entry): entry is number[] => entry !== null);
      } catch {
        return refuse('unresolvable');
      }
      if (addresses.length === 0) return refuse('unresolvable');
    }
    for (const address of addresses) {
      const judged = judgeAddress(address);
      if (judged.reason !== null) reasons.push(judged.reason);
      if (!judged.inAllowedRange) everyAddressAllowed = false;
    }
  }

  if (url.protocol === 'http:' && !everyAddressAllowed) reasons.push('scheme');
  if (reasons.length > 0) {
    const worst = PRECEDENCE.find((reason) => reasons.includes(reason));
    return refuse(worst ?? 'invalid');
  }
  return { ok: true, reason: null, normalisedUrl: normaliseUrl(url) };
}
