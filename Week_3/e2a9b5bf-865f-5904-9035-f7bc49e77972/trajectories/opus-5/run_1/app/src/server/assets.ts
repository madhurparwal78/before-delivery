import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));
export const publicDir = resolve(serverDir, '..', 'public');

/** Only these files are ever served from disk. */
const SERVED: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
  '/sw.js': 'text/javascript; charset=utf-8',
  '/fonts/sora-400.woff2': 'font/woff2',
  '/fonts/sora-600.woff2': 'font/woff2',
};

export interface Asset {
  bytes: Uint8Array;
  contentType: string;
}

const cache = new Map<string, Asset>();

export async function readAsset(pathname: string): Promise<Asset | null> {
  const contentType = SERVED[pathname];
  if (!contentType) return null;
  const cached = cache.get(pathname);
  if (cached) return cached;
  const file = join(publicDir, normalize(pathname));
  const asset: Asset = { bytes: new Uint8Array(await readFile(file)), contentType };
  cache.set(pathname, asset);
  return asset;
}

let fontCss: string | null = null;

/** Sora inlined, so the packet HTML the renderer loads fetches nothing. */
export async function inlineFontCss(): Promise<string> {
  if (fontCss !== null) return fontCss;
  const [regular, semibold] = await Promise.all([
    readFile(join(publicDir, 'fonts', 'sora-400.woff2')),
    readFile(join(publicDir, 'fonts', 'sora-600.woff2')),
  ]);
  fontCss =
    `@font-face{font-family:Sora;font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${regular.toString('base64')}) format('woff2');}` +
    `@font-face{font-family:Sora;font-style:normal;font-weight:600;src:url(data:font/woff2;base64,${semibold.toString('base64')}) format('woff2');}`;
  return fontCss;
}
