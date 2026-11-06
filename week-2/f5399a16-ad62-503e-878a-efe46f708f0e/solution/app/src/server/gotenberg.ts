// PDFs from HTML, with styles inline and drawings as data addresses; it never fetches anything.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COPY } from '../shared/copy';
import { config } from './config';
import { unavailable } from './http';

const fontPath = (name: string) => fileURLToPath(new URL(`../public/fonts/${name}`, import.meta.url));

function face(family: string, weight: number, file: string): string {
  const data = readFileSync(fontPath(file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
}

const FONT_CSS = [
  face('Libre Franklin', 700, 'libre-franklin-latin-700-normal.woff2'),
  face('Source Serif 4', 400, 'source-serif-4-latin-400-normal.woff2'),
].join('');

function pdfDown(): ReturnType<typeof unavailable> {
  return unavailable(COPY.pdfDown);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function renderPdf(bodyCss: string, bodyHtml: string): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}${bodyCss}</style></head><body>${bodyHtml}</body></html>`;
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    if (response.status !== 200) throw pdfDown();
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw pdfDown();
  }
}
