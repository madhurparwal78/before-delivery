const activeTypes = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
]);

/** Active types are served opaquely so a download can never run in the page. */
export function downloadContentType(storedType: string): string {
  const bare = storedType.split(';')[0]?.trim().toLowerCase() ?? '';
  return activeTypes.has(bare) ? 'application/octet-stream' : storedType;
}

const keptCharacters = new Set("!#$&+-.^_`|~".split(''));

function encodedFilename(filename: string): string {
  const bytes = Buffer.from(filename, 'utf8');
  let out = '';
  for (const byte of bytes) {
    const character = String.fromCharCode(byte);
    const isAlphanumeric =
      (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39);
    if (isAlphanumeric || keptCharacters.has(character)) out += character;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function fallbackFilename(filename: string): string {
  let out = '';
  for (const character of filename) {
    const code = character.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code <= 0x7e;
    out += printable && character !== '"' && character !== '\\' ? character : '_';
  }
  return out;
}

export function contentDisposition(filename: string): string {
  return `attachment; filename="${fallbackFilename(filename)}"; filename*=UTF-8''${encodedFilename(filename)}`;
}

/** The MinIO object key of an attachment. */
export function objectKey(workspaceSlug: string, attachmentId: string, filename: string): string {
  let safe = '';
  for (const character of filename) {
    safe += /[A-Za-z0-9._-]/.test(character) ? character : '_';
  }
  return `${workspaceSlug}/${attachmentId}/${safe}`;
}
