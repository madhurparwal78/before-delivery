// The one stored-filename decision and the one download-header decision.

const CONTROLS = /[\u0000-\u001F\u007F"]/g;

export function cleanFilename(submitted: string): string {
  const lastSlash = Math.max(submitted.lastIndexOf('/'), submitted.lastIndexOf('\\'));
  let name = lastSlash === -1 ? submitted : submitted.slice(lastSlash + 1);
  name = name.replace(CONTROLS, '');
  name = name.trim();
  if (name.length > 120) {
    const clipped = name.slice(0, 120);
    const tail = clipped.charCodeAt(119);
    if (tail >= 0xD800 && tail <= 0xDBFF) {
      name = clipped.slice(0, 119);
    } else {
      name = clipped;
    }
    name = name.replace(/ +$/, '');
  }
  if (name === '') return 'attachment';
  return name;
}

export function contentDisposition(filename: string): string {
  const fallback = [...filename].map((character) => (character.codePointAt(0)! > 0x7E ? '_' : character)).join('');
  const bytes = Buffer.from(filename, 'utf8');
  let encoded = '';
  for (const byte of bytes) {
    if ((byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x30 && byte <= 0x39) || '!#$&+-.^_`|~'.includes(String.fromCharCode(byte))) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// The one upload type detection.
export function detectType(bytes: Buffer): 'image/png' | 'image/jpeg' | 'text/plain' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length === 0 || bytes.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'text/plain';
  } catch {
    return null;
  }
}
