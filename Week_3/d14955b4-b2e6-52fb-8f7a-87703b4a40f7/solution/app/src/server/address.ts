import dns from 'node:dns';
import net from 'node:net';
import { config } from './config.js';

type AddressClass = 'metadata' | 'loopback' | 'private' | 'link-local' | 'shared' | 'reserved';

const V4_RANGES: [string, number, AddressClass][] = [
  ['169.254.169.254', 32, 'metadata'],
  ['127.0.0.0', 8, 'loopback'],
  ['10.0.0.0', 8, 'private'],
  ['172.16.0.0', 12, 'private'],
  ['192.168.0.0', 16, 'private'],
  ['169.254.0.0', 16, 'link-local'],
  ['100.64.0.0', 10, 'shared'],
  ['0.0.0.0', 8, 'reserved'],
  ['192.0.0.0', 24, 'reserved'],
  ['192.0.2.0', 24, 'reserved'],
  ['198.18.0.0', 15, 'reserved'],
  ['198.51.100.0', 24, 'reserved'],
  ['203.0.113.0', 24, 'reserved'],
  ['224.0.0.0', 3, 'reserved'],
];

function v4Number(address: string): number {
  return address.split('.').reduce((total, part) => total * 256 + Number(part), 0);
}

function classifyV4(address: string): AddressClass | null {
  const value = v4Number(address);
  for (const [base, prefix, kind] of V4_RANGES) {
    const size = 2 ** (32 - prefix);
    if (Math.floor(value / size) === Math.floor(v4Number(base) / size)) return kind;
  }
  return null;
}

function v6Words(address: string): number[] {
  let text = address;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const value = v4Number(tail[1] as string);
    text = `${text.slice(0, -(tail[1] as string).length)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((word) => parseInt(word, 16));
}

function classifyV6(address: string): AddressClass | null {
  const w = v6Words(address);
  const embedded = (at: number): AddressClass | null => classifyV4(`${(w[at] as number) >> 8}.${(w[at] as number) & 255}.${(w[at + 1] as number) >> 8}.${(w[at + 1] as number) & 255}`);
  const first = w[0] as number;
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return embedded(6) ?? null;
  if (w.slice(0, 7).every((x) => x === 0)) return w[7] === 1 ? 'loopback' : 'reserved';
  if (first === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return embedded(6) ?? null;
  if (first === 0xfd00 && w[1] === 0x0ec2 && w.slice(2, 7).every((x) => x === 0) && w[7] === 0x254) return 'metadata';
  if ((first & 0xfe00) === 0xfc00) return 'private';
  if ((first & 0xffc0) === 0xfe80) return 'link-local';
  if (first === 0x2002) return embedded(1) ?? null;
  if ((first & 0xff00) === 0xff00 || (first & 0xffc0) === 0xfec0 || (first === 0x2001 && (w[1] === 0xdb8 || w[1] === 0))) return 'reserved';
  if (first === 0x100 && w.slice(1, 4).every((x) => x === 0)) return 'reserved';
  return null;
}

function classifyAddress(address: string): AddressClass | null {
  return net.isIPv6(address) ? classifyV6(address) : classifyV4(address);
}

const wiremockOrigin = new URL(config.wiremockUrl).origin;

const isOpenWebStandIn = (url: URL): boolean => url.origin === wiremockOrigin && url.pathname.startsWith('/web/');

type Resolution =
  | { ok: true; url: URL; address: string; family: 4 | 6 }
  | { ok: false; class: AddressClass | null; address: string | null; url: URL | null };

export async function resolveLink(raw: string): Promise<Resolution> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, class: null, address: null, url: null };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, class: null, address: null, url };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await dns.promises.lookup(host, { all: true })).map((entry) => entry.address);
    } catch {
      return { ok: false, class: null, address: null, url };
    }
  }
  const [address] = addresses;
  if (address === undefined) return { ok: false, class: null, address: null, url };
  if (!isOpenWebStandIn(url)) {
    for (const candidate of addresses) {
      const kind = classifyAddress(candidate);
      if (kind) return { ok: false, class: kind, address: candidate, url };
    }
  }
  return { ok: true, url, address, family: net.isIPv6(address) ? 6 : 4 };
}
