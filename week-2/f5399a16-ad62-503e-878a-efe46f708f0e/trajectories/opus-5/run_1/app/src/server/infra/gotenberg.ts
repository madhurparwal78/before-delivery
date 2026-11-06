import { config } from '../config.js';

export class PdfServiceDown extends Error {}

/** HTML goes as `index.html` with styles inline and drawings as data addresses. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new PdfServiceDown('pdf service unreachable');
  }
  if (!response.ok) throw new PdfServiceDown(`pdf service said ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
