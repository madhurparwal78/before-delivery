import { config } from '../../config.js';

export async function renderPdf(html: string): Promise<Buffer> {
  // Gotenberg takes the HTML document as a multipart "files" field.
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`gotenberg ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function gotenbergProbe(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${config.gotenbergUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
