import { config } from '../config';
import { ProviderDownError, timeoutSignal } from './providers';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders one line per entry of `lines`, each as its own text line in the PDF. */
export async function renderPdf(lines: string[]): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice</title><style>
@page { size: Letter; margin: 18mm; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #11180f; }
div { white-space: nowrap; line-height: 1.6; }
</style></head><body>${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</body></html>`;

  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');

  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw new ProviderDownError('gotenberg', String(error));
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new ProviderDownError('gotenberg', `convert returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function pdfServiceReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, { signal: timeoutSignal() });
    return response.ok;
  } catch {
    return false;
  }
}
