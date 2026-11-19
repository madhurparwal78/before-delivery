import { config } from '../config.js';

const TIMEOUT_MS = 20000;

export class PdfDown extends Error {}

/** Gotenberg renders every PDF from HTML this app sends as an index.html file. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.69');
  let answer: Response;
  try {
    answer = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PdfDown('the PDF service did not answer');
  }
  if (!answer.ok) throw new PdfDown(`the PDF service answered ${answer.status}`);
  return Buffer.from(await answer.arrayBuffer());
}
