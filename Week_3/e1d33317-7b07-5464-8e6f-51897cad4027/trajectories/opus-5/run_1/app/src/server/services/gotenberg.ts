import { config } from '../config.js';

const RENDER_TIMEOUT_MS = 20000;

export interface PdfPage {
  html: string;
}

/** Turns the stored part pages into the part PDF, one printed page per part page. */
export async function renderPartPdf(pages: PdfPage[]): Promise<Buffer | null> {
  const form = new FormData();
  const body = pages
    .map((page, index) => `<section class="page${index === 0 ? ' first' : ''}">${page.html}</section>`)
    .join('\n');
  const document = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: 9in 12in; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  .page { width: 9in; height: 12in; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page svg { display: block; width: 9in; height: 12in; }
</style></head><body>${body}</body></html>`;
  form.append('files', new Blob([document], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '9in');
  form.append('paperHeight', '12in');
  form.append('marginTop', '0');
  form.append('marginBottom', '0');
  form.append('marginLeft', '0');
  form.append('marginRight', '0');
  form.append('printBackground', 'true');
  try {
    const response = await fetch(
      new URL('/forms/chromium/convert/html', config.gotenbergUrl).toString(),
      { method: 'POST', body: form, signal: AbortSignal.timeout(RENDER_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}
