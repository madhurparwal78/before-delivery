const UPLOAD_ESCAPES: readonly [RegExp, string][] = [
  [/%22/gi, '"'],
  [/%0d/gi, '\r'],
  [/%0a/gi, '\n'],
];

/**
 * Form-data libraries write a double quote, a carriage return and a line feed in the
 * `filename` parameter percent-encoded. Exactly those three sequences are decoded back.
 */
export function decodeUploadFileName(filenameParameter: string): string {
  return UPLOAD_ESCAPES.reduce((name, [pattern, character]) => name.replace(pattern, character), filenameParameter);
}

export function fileNameProblem(fileName: string): string | null {
  const bytes = Buffer.byteLength(fileName, 'utf8');
  if (fileName.length === 0) return 'The file name is empty.';
  if (bytes > 255) return 'The file name is longer than 255 bytes.';
  if (fileName.includes('/') || fileName.includes('\\')) return 'The file name contains a path separator.';
  if (/[\u0000-\u001f\u007f]/.test(fileName)) return 'The file name contains a control character.';
  return null;
}

const UNRESERVED = new Set("!#$&+-.^_`|~".split(''));

function isUnreserved(character: string): boolean {
  return /^[A-Za-z0-9]$/.test(character) || UNRESERVED.has(character);
}

function asciiFallback(fileName: string): string {
  return [...fileName]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (character === '"' || character === '\\') return '_';
      return code >= 0x20 && code <= 0x7e ? character : '_';
    })
    .join('');
}

function encodedFileName(fileName: string): string {
  let encoded = '';
  for (const character of fileName) {
    if (isUnreserved(character)) {
      encoded += character;
      continue;
    }
    for (const byte of Buffer.from(character, 'utf8')) {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return encoded;
}

export function contentDisposition(fileName: string): string {
  return `attachment; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodedFileName(fileName)}`;
}
