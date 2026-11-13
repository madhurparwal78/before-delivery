import type { ServerResponse } from 'node:http';
import { fileExtension } from './versions.js';

const keepAsIs = new Set("!#$&+-.^_`|~".split(''));

function asciiName(name: string): string {
  return [...name]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (character === '"' || character === '\\') return '_';
      return code >= 0x20 && code <= 0x7e ? character : '_';
    })
    .join('');
}

function encodedName(name: string): string {
  return [...Buffer.from(name, 'utf8')]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      const isAlphanumeric = /[A-Za-z0-9]/.test(character);
      if (isAlphanumeric || keepAsIs.has(character)) return character;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

export function contentDisposition(name: string, contentType: string): string {
  const extension = fileExtension(contentType);
  return (
    `attachment; filename="${asciiName(name)}.${extension}"; ` +
    `filename*=UTF-8''${encodedName(name)}.${extension}`
  );
}

export interface DownloadFile {
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

/** The one set of download headers for prop files and build-pack copies. */
export function sendDownload(
  res: ServerResponse,
  file: DownloadFile,
  body: Buffer,
  ifNoneMatch: string | undefined,
): void {
  const etag = `"${file.sha256}"`;
  if (ifNoneMatch !== undefined && ifNoneMatch.trim() === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    ETag: etag,
    'Content-Type': file.contentType,
    'Content-Length': String(file.bytes),
    'Content-Disposition': contentDisposition(file.name, file.contentType),
  });
  res.end(body);
}
