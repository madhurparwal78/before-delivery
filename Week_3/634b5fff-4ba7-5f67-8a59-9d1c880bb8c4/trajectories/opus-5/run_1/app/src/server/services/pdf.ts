import { config } from '../config.js';

export class PdfUnreachable extends Error {}

/** Renders HTML to a real PDF with a text layer. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.7');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new PdfUnreachable(`gotenberg ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof PdfUnreachable) throw error;
    throw new PdfUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}
