import { byteLength, countCharacters } from './text';

export const keyMessage = "This key can't be stored.";
export const metadataMessage = 'User metadata is limited to 2,048 bytes in total.';
export const tagsMessage = 'Up to 10 tags; keys 1 to 128 characters, values up to 256.';
export const scriptedSvgMessage = 'SVG files with scripts are not accepted.';

export function isValidObjectKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  const bytes = byteLength(key);
  if (bytes < 1 || bytes > 1024) return false;
  if (key.startsWith('/')) return false;
  if (key.includes('\\')) return false;
  for (const character of key) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return !key.split('/').some((segment) => segment === '.' || segment === '..');
}

export function metadataBytes(metadata: Record<string, string>): number {
  return Object.entries(metadata).reduce((total, [name, value]) => total + byteLength(name) + byteLength(value), 0);
}

export function isValidMetadata(metadata: Record<string, string>): boolean {
  return metadataBytes(metadata) <= 2048;
}

export function isValidTags(tags: Record<string, string>): boolean {
  const names = Object.keys(tags);
  if (names.length > 10) return false;
  return names.every((name) => {
    const nameLength = countCharacters(name);
    const valueLength = countCharacters(tags[name]);
    return nameLength >= 1 && nameLength <= 128 && valueLength <= 256;
  });
}

/** Parses `x-amz-tagging` style URL query encoding, rejecting duplicate keys. */
export function parseTagging(value: string): Record<string, string> | null {
  const tags: Record<string, string> = {};
  if (value.trim() === '') return tags;
  for (const pair of value.split('&')) {
    const index = pair.indexOf('=');
    const rawName = index < 0 ? pair : pair.slice(0, index);
    const rawValue = index < 0 ? '' : pair.slice(index + 1);
    let name: string;
    let tagValue: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      tagValue = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (name === '' || name in tags) return null;
    tags[name] = tagValue;
  }
  return tags;
}

const htmlStarts = ['<!doctype html', '<html', '<head', '<body', '<script'];

export interface ContentJudgement {
  contentType: string;
  scriptedSvg: boolean;
}

/** The recorded content type is judged from the bytes as well as the declared header. */
export function judgeContent(declared: string | undefined, bytes: Buffer): ContentJudgement {
  const head = bytes.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const lowered = head.toLowerCase();
  if (htmlStarts.some((start) => lowered.startsWith(start))) return { contentType: 'text/html', scriptedSvg: false };
  const text = bytes.toString('utf8');
  const looksSvg = /<svg[\s>]/i.test(lowered) || (/^<\?xml/.test(lowered) && /<svg[\s>]/i.test(text.toLowerCase()));
  if (looksSvg) {
    const scripted =
      /<script[\s>]/i.test(text) || /\s+on[a-z-]+\s*=/i.test(text) || /javascript:/i.test(text);
    return { contentType: 'image/svg+xml', scriptedSvg: scripted };
  }
  const trimmed = (declared ?? '').split(';')[0].trim();
  return { contentType: trimmed === '' ? 'application/octet-stream' : trimmed, scriptedSvg: false };
}

const riskyTypes = [
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'text/ecmascript',
];

export function isRiskyType(contentType: string): boolean {
  const base = contentType.split(';')[0].trim().toLowerCase();
  return riskyTypes.includes(base) || base.endsWith('/javascript');
}

const safeFilenameBytes = new Set(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&+-.^_`|~'.split('').map((character) => character.charCodeAt(0)),
);

/** The download filename, as a safely encoded two-part Content-Disposition value. */
export function contentDisposition(key: string): string {
  const segment = key.split('/').pop() ?? key;
  const encoded = Array.from(Buffer.from(segment, 'utf8'))
    .map((byte) => (safeFilenameBytes.has(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
  const fallback = Array.from(segment)
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code > 0x7f || code <= 0x1f || code === 0x7f || character === '"' || character === '\\') return '_';
      return character;
    })
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function downloadHeaders(key: string): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': contentDisposition(key),
  };
}
