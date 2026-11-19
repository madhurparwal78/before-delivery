/**
 * The club's own media: twelve original avatars drawn from shapes, a house
 * mark, a licence manifest, and the upload pipeline that stores whatever
 * arrives as a 256 by 256 PNG.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fail } from './http.js';

export const AVATAR_SIZE = 256;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const ROOT = path.resolve(import.meta.dirname, '..');
export const MEDIA_DIR = path.join(ROOT, 'public', 'media');
const AVATAR_DIR = path.join(MEDIA_DIR, 'avatars');

// Twelve pairs of warm, dark-club colours; each avatar is its own drawing.
const PALETTE = [
  ['#2f241c', '#8fc46b'], ['#241f2e', '#c9a227'], ['#1d2a26', '#6bbfa3'],
  ['#2e1f1f', '#e0855a'], ['#1f2630', '#7fa8d9'], ['#2a2318', '#d4b483'],
  ['#231d2b', '#b088d9'], ['#1c2b1f', '#9fd36b'], ['#2b1f26', '#e07a9a'],
  ['#20262b', '#8fd4d4'], ['#2b2a1c', '#d9cf6b'], ['#262026', '#c98fd4'],
];

function motif(index, ink) {
  const c = 128;
  switch (index % 12) {
    case 0: return `<circle cx="${c}" cy="${c}" r="60" fill="none" stroke="${ink}" stroke-width="14"/><circle cx="${c}" cy="${c}" r="20" fill="${ink}"/>`;
    case 1: return `<rect x="68" y="68" width="120" height="120" fill="none" stroke="${ink}" stroke-width="14" transform="rotate(45 ${c} ${c})"/>`;
    case 2: return `<path d="M128 56 L196 192 L60 192 Z" fill="none" stroke="${ink}" stroke-width="14" stroke-linejoin="round"/>`;
    case 3: return `<path d="M60 196 L60 108 L128 60 L196 108 L196 196" fill="none" stroke="${ink}" stroke-width="14" stroke-linejoin="round"/>`;
    case 4: return `<g stroke="${ink}" stroke-width="16" stroke-linecap="round"><path d="M70 96 H186"/><path d="M70 128 H186"/><path d="M70 160 H186"/></g>`;
    case 5: return `<g fill="${ink}"><circle cx="96" cy="96" r="22"/><circle cx="160" cy="96" r="22"/><circle cx="96" cy="160" r="22"/><circle cx="160" cy="160" r="22"/></g>`;
    case 6: return `<path d="M128 58 C180 92 180 164 128 198 C76 164 76 92 128 58 Z" fill="none" stroke="${ink}" stroke-width="14"/>`;
    case 7: return `<g stroke="${ink}" stroke-width="14" fill="none"><path d="M64 192 L128 64 L192 192"/><path d="M92 140 H164"/></g>`;
    case 8: return `<g fill="${ink}"><rect x="64" y="64" width="56" height="56"/><rect x="136" y="136" width="56" height="56"/></g><g fill="none" stroke="${ink}" stroke-width="12"><rect x="136" y="64" width="56" height="56"/><rect x="64" y="136" width="56" height="56"/></g>`;
    case 9: return `<g fill="none" stroke="${ink}" stroke-width="13"><circle cx="128" cy="100" r="36"/><path d="M68 196 C68 150 188 150 188 196"/></g>`;
    case 10: return `<g stroke="${ink}" stroke-width="15" stroke-linecap="round"><path d="M72 184 L184 72"/><path d="M72 72 L184 184"/></g>`;
    default: return `<g fill="none" stroke="${ink}" stroke-width="14"><path d="M128 60 L188 128 L128 196 L68 128 Z"/><path d="M128 104 L152 128 L128 152 L104 128 Z" fill="${ink}"/></g>`;
  }
}

function avatarSvg(index) {
  const [ground, ink] = PALETTE[index % PALETTE.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="${ground}"/>
  <rect x="10" y="10" width="236" height="236" rx="28" fill="none" stroke="${ink}" stroke-width="6" opacity="0.45"/>
  ${motif(index, ink)}
</svg>`;
}

function houseSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#1b1512"/>
  <g fill="none" stroke="#f3efe9" stroke-width="12" stroke-linejoin="round">
    <path d="M52 200 V110 L128 54 L204 110 V200 Z"/>
    <path d="M104 200 V148 H152 V200"/>
  </g>
  <g fill="#8fc46b"><circle cx="128" cy="104" r="16"/></g>
</svg>`;
}

async function sha256File(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Draw the avatars onto disk if they are not already there and write the
 * licence manifest beside them.
 */
export async function ensureMedia() {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const entries = [];

  for (let i = 0; i < 12; i++) {
    const key = `avatar_${String(i + 1).padStart(2, '0')}`;
    const file = path.join(AVATAR_DIR, `${key}.png`);
    try {
      await fs.access(file);
    } catch {
      const png = await sharp(Buffer.from(avatarSvg(i)))
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
      await fs.writeFile(file, png);
    }
    entries.push({ path: `/media/avatars/${key}.png`, file });
  }

  const houseFile = path.join(AVATAR_DIR, 'house.png');
  try {
    await fs.access(houseFile);
  } catch {
    const png = await sharp(Buffer.from(houseSvg()))
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
    await fs.writeFile(houseFile, png);
  }
  entries.push({ path: '/media/avatars/house.png', file: houseFile });

  const manifest = {
    note: 'Every asset the club serves is original work made for it, drawn from shapes in this repository. Nothing is fetched from another origin at run time.',
    generator: 'src/media.js',
    assets: [],
  };
  for (const entry of entries) {
    const stat = await fs.stat(entry.file);
    manifest.assets.push({
      path: entry.path,
      bytes: stat.size,
      sha256: await sha256File(entry.file),
      licence: 'CC0-1.0',
      author: 'Gambit Hall Club',
      origin: 'original work, drawn in this repository',
    });
  }
  manifest.assets.push({
    path: '(none)',
    note: 'The board, the piece sets, the icons and the six sounds carry no files: the board and pieces are drawn in the page from theme colours, the icons are inline line drawings, and the sounds are synthesised by the browser from the Web Audio API. The fonts are a serif and a system sans stack, which need no file.',
    licence: 'CC0-1.0',
    author: 'Gambit Hall Club',
  });
  await fs.writeFile(path.join(MEDIA_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const SIGNATURES = [
  { mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/** The type of an upload, recognised by the file's own leading bytes. */
export function sniffImage(buffer) {
  for (const signature of SIGNATURES) if (signature.test(buffer)) return signature.mime;
  return null;
}

/**
 * Whatever arrives is stored and served as a 256 by 256 PNG.  Refusals store
 * nothing: 413 above the size limit, 415 for any other type.
 */
export async function normaliseUpload(buffer, declaredName = '', declaredMime = '') {
  if (!buffer || buffer.length === 0) fail(422, 'The upload is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) fail(413, 'A picture may be at most 2 MB.');
  const sniffed = sniffImage(buffer);
  if (!sniffed) fail(415, 'A picture must be a PNG, a JPEG or a WebP.');
  const extension = String(declaredName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const allowedByName = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  if (extension && !allowedByName[extension]) fail(415, 'A picture must be a PNG, a JPEG or a WebP.');
  if (extension && allowedByName[extension] !== sniffed) {
    fail(415, 'The picture\'s name and its contents disagree.');
  }
  if (declaredMime && !['image/png', 'image/jpeg', 'image/webp'].includes(String(declaredMime).split(';')[0].trim())) {
    fail(415, 'A picture must be a PNG, a JPEG or a WebP.');
  }
  try {
    return await sharp(buffer, { limitInputPixels: 50_000_000 })
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    return fail(422, 'That picture could not be read.');
  }
}

/**
 * A minimal multipart/form-data reader for the one file field the club takes.
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!match) fail(415, 'The upload must be a multipart form.');
  const boundary = Buffer.from(`--${match[1]}`);
  const parts = [];
  let index = buffer.indexOf(boundary);
  while (index >= 0) {
    const start = index + boundary.length;
    if (buffer.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = buffer.indexOf(boundary, start);
    if (next < 0) break;
    const raw = buffer.subarray(start, next);
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = raw.subarray(0, headerEnd).toString('utf8');
      let body = raw.subarray(headerEnd + 4);
      if (body.subarray(body.length - 2).toString('latin1') === '\r\n') body = body.subarray(0, body.length - 2);
      const name = /name="([^"]*)"/i.exec(headers)?.[1] || '';
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1] || '';
      const mime = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || '';
      parts.push({ name, filename, mime, body });
    }
    index = next;
  }
  return parts;
}
