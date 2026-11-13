import { config, RENDER_TIMEOUT_MS } from './config.js';

/** The renderer failed on anything but a 2xx answer whose body starts with %PDF-. */
export class RendererDown extends Error {}

const PDF_SIGNATURE = '%PDF-';

export async function renderHtmlToPdf(html: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.5in');
  form.append('paperHeight', '11in');
  form.append('marginTop', '0');
  form.append('marginBottom', '0');
  form.append('marginLeft', '0');
  form.append('marginRight', '0');
  form.append('printBackground', 'true');
  form.append('preferCssPageSize', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new RendererDown('renderer could not be reached');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new RendererDown('renderer refused the request');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const head = Buffer.from(bytes.slice(0, PDF_SIGNATURE.length)).toString('latin1');
  if (head !== PDF_SIGNATURE) throw new RendererDown('renderer did not return a PDF');
  return bytes;
}

/** The page count read from the PDF itself. */
export function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  return [...text.matchAll(/\/Type\s*\/Page(?![s])/g)].length;
}
