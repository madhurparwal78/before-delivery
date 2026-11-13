import { env } from '../env.js';

/** Documents are rendered from HTML by the document service. */

export class DocumentsUnavailable extends Error {}

export async function renderPdf(html: string, timeoutMs = 30_000): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.7');
  form.append('marginTop', '0.6');
  form.append('marginBottom', '0.6');
  form.append('marginLeft', '0.6');
  form.append('marginRight', '0.6');
  form.append('printBackground', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new DocumentsUnavailable(`convert ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (error instanceof DocumentsUnavailable) throw error;
    throw new DocumentsUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function documentsAreUp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${env.gotenbergUrl}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
