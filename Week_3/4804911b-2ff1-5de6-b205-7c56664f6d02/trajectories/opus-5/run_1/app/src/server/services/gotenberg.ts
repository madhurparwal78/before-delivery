import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { withTimeout } from './state.js';

const RENDER_TIMEOUT_MS = 20_000;
/** A4 in inches, so every stored PDF is 595 by 842 points. */
const A4_WIDTH_IN = '8.2638889in';
const A4_HEIGHT_IN = '11.6944444in';

export class RenderFailed extends Error {}

let fontFiles: { bebas: Buffer; garamond: Buffer } | null = null;

async function fonts(): Promise<{ bebas: Buffer; garamond: Buffer }> {
  if (fontFiles !== null) return fontFiles;
  const here = dirname(fileURLToPath(import.meta.url));
  fontFiles = {
    bebas: await readFile(join(here, 'print-assets/bebas-neue.woff2')),
    garamond: await readFile(join(here, 'print-assets/eb-garamond.woff2')),
  };
  return fontFiles;
}

/** Renders one notice version. Only bytes starting `%PDF-` count as a render. */
export async function renderPdf(html: string, title: string): Promise<Buffer> {
  const { bebas, garamond } = await fonts();
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('files', new Blob([new Uint8Array(bebas)], { type: 'font/woff2' }), 'bebas-neue.woff2');
  form.append('files', new Blob([new Uint8Array(garamond)], { type: 'font/woff2' }), 'eb-garamond.woff2');
  form.append('paperWidth', A4_WIDTH_IN);
  form.append('paperHeight', A4_HEIGHT_IN);
  form.append('marginTop', '0.6in');
  form.append('marginBottom', '0.6in');
  form.append('marginLeft', '0.7in');
  form.append('marginRight', '0.7in');
  form.append('printBackground', 'true');
  form.append('metadata', JSON.stringify({ Title: title }));

  let response: Response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
          method: 'POST',
          body: form,
          signal,
        }),
      RENDER_TIMEOUT_MS,
    );
  } catch {
    throw new RenderFailed('gotenberg did not answer');
  }
  if (!response.ok) throw new RenderFailed(`gotenberg answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new RenderFailed('gotenberg returned no PDF');
  return bytes;
}
