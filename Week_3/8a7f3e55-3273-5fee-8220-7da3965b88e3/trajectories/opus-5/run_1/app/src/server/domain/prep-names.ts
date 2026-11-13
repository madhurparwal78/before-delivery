import { cutToCodePoints } from './text.js';

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/gu;
const UNRESERVED_EXTRAS = new Set('!#$&+-.^_`|~'.split(''));

/**
 * A prep material's display name: the file part's name without directories or control
 * characters, cut to its first 120 code points, never normalised.
 */
export function displayNameFromUpload(rawName: string): string {
  const withoutDirectories = rawName.split(/[/\\]/u).pop() ?? '';
  const withoutControls = withoutDirectories.replace(CONTROL_CHARACTERS, '');
  const cut = cutToCodePoints(withoutControls, 120);
  return cut.length === 0 ? 'file' : cut;
}

function asciiFallback(displayName: string): string {
  let out = '';
  for (const point of displayName) {
    const code = point.codePointAt(0) ?? 0;
    const printable = point.length === 1 && code >= 0x20 && code <= 0x7e;
    out += printable && point !== '"' && point !== '\\' ? point : '_';
  }
  return out;
}

function rfc5987Encode(displayName: string): string {
  const bytes = Buffer.from(displayName, 'utf8');
  let out = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    const alphanumeric = /^[A-Za-z0-9]$/.test(char);
    if (alphanumeric || UNRESERVED_EXTRAS.has(char)) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export function contentDispositionFor(displayName: string): string {
  return `attachment; filename="${asciiFallback(displayName)}"; filename*=UTF-8''${rfc5987Encode(displayName)}`;
}
