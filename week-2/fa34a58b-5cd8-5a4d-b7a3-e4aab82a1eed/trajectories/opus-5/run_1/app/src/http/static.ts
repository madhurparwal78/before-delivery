import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUBLIC_DIR = join(__dirname, 'public');

const ASSETS: Record<string, { file: string; contentType: string }> = {
  '/app.js': { file: 'app.js', contentType: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', contentType: 'text/css; charset=utf-8' },
};

const FONTS: Record<string, string> = {
  '/fonts/space-grotesk-400.woff2': 'fonts/space-grotesk-latin-400-normal.woff2',
  '/fonts/space-grotesk-500.woff2': 'fonts/space-grotesk-latin-500-normal.woff2',
  '/fonts/space-grotesk-700.woff2': 'fonts/space-grotesk-latin-700-normal.woff2',
  '/fonts/ibm-plex-sans-400.woff2': 'fonts/ibm-plex-sans-latin-400-normal.woff2',
  '/fonts/ibm-plex-sans-500.woff2': 'fonts/ibm-plex-sans-latin-500-normal.woff2',
  '/fonts/jetbrains-mono-400.woff2': 'fonts/jetbrains-mono-latin-400-normal.woff2',
  '/fonts/jetbrains-mono-500.woff2': 'fonts/jetbrains-mono-latin-500-normal.woff2',
};

const cache = new Map<string, Buffer>();

export interface StaticAsset {
  body: Buffer;
  contentType: string;
}

export async function readStaticAsset(pathname: string): Promise<StaticAsset | null> {
  const asset = ASSETS[pathname];
  if (asset) return { body: await load(asset.file), contentType: asset.contentType };
  const font = FONTS[pathname];
  if (font) return { body: await load(font), contentType: 'font/woff2' };
  return null;
}

async function load(file: string): Promise<Buffer> {
  const cached = cache.get(file);
  if (cached) return cached;
  const body = await readFile(join(PUBLIC_DIR, file));
  cache.set(file, body);
  return body;
}
