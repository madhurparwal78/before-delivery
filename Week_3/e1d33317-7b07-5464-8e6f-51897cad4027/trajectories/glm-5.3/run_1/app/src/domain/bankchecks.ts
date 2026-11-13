import { BANK_BODY_MAX, BANK_NAME_MAX } from './values.js';

const NAME_RE = /^[A-Za-z0-9 .\-_()]+$/;

export type BankKind = 'wav' | 'sfz';

export type BankCheckResult =
  | { ok: true; kind: BankKind }
  | { ok: false; stage: 'size' }
  | { ok: false; stage: 'name' }
  | { ok: false; stage: 'content' };

/**
 * The one place that decides whether an uploaded sample bank is accepted.
 * Checks run in order — size, then name, then content — and nothing reaches
 * storage or the database until every check passes.
 */
export function checkBankUpload(params: {
  fileName: string;
  bytes: Uint8Array;
}): { kind: BankKind } | { error: 'too_large' } | { error: 'bad_name' } | { error: 'unsupported_type' } {
  if (params.bytes.length > BANK_BODY_MAX) return { error: 'too_large' };
  if (!isValidBankName(params.fileName)) return { error: 'bad_name' };
  const kind = judgeContent(params.bytes, params.fileName);
  if (!kind) return { error: 'unsupported_type' };
  return { kind };
}

export function isValidBankName(name: string): boolean {
  if (name.length < 1 || name.length > BANK_NAME_MAX) return false;
  if (!NAME_RE.test(name)) return false;
  if (name.includes('..')) return false;
  const lower = name.toLowerCase();
  return lower.endsWith('.wav') || lower.endsWith('.sfz');
}

function looksWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return riff === 'RIFF' && wave === 'WAVE';
}

const SFZ_HEADERS = ['<control>', '<global>', '<master>', '<group>', '<region>', '<curve>', '<effect>', '<midi>'];

function looksSfz(bytes: Uint8Array): boolean {
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (decoded.includes('\u0000')) return false;
  // take the first token after spaces, // comments and /* */ comments
  let rest = decoded;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('//')) {
      const nl = rest.indexOf('\n');
      if (nl === -1) return false;
      rest = rest.slice(nl + 1);
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/');
      if (end === -1) return false;
      rest = rest.slice(end + 2);
      continue;
    }
    break;
  }
  const token = rest.split(/[\s<>/]/)[0] ?? '';
  return SFZ_HEADERS.includes(token.toLowerCase());
}

function judgeContent(bytes: Uint8Array, fileName: string): BankKind | null {
  const isWav = looksWav(bytes);
  const isSfz = looksSfz(bytes);
  const ext = fileName.toLowerCase().endsWith('.wav') ? 'wav' : 'sfz';
  if (ext === 'wav') return isWav ? 'wav' : null;
  return isSfz ? 'sfz' : null;
}
