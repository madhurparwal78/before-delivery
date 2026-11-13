import type { PaperSize } from '../shared/types.js';
import { config } from './config.js';
import { printingUnavailable } from './http/errors.js';

const TIMEOUT_MS = 10_000;

const PAPER: Record<PaperSize, { width: string; height: string }> = {
  A4: { width: '210mm', height: '297mm' },
  Letter: { width: '8.5in', height: '11in' },
};

/** Renders a pack sheet through Gotenberg's Chromium HTML-to-PDF conversion. */
export async function renderPdf(html: string, paperSize: PaperSize): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', PAPER[paperSize].width);
  form.append('paperHeight', PAPER[paperSize].height);
  form.append('marginTop', '0.6in');
  form.append('marginBottom', '0.6in');
  form.append('marginLeft', '0.6in');
  form.append('marginRight', '0.6in');

  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw printingUnavailable();
  }
  if (!response.ok) throw printingUnavailable();
  return Buffer.from(await response.arrayBuffer());
}
