import { config } from '../config';

/** The PDF bytes Gotenberg returned, or null when the render was held or failed. */
export async function renderPdf(html: string): Promise<Buffer | null> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.7');
  try {
    const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function pdfReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
