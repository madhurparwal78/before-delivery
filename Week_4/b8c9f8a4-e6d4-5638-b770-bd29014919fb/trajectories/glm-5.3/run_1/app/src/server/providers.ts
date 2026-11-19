import type { Config } from './db.js';

export type PdfFailure = { kind: 'render_failed' } | { kind: 'store_failed' };

/** Render HTML to PDF through Gotenberg. */
export async function renderPdf(cfg: Config, html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  const reply = await fetch(`${cfg.gotenbergUrl}/forms/chromium/convert/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!reply.ok) throw new Error('render failed');
  const bytes = Buffer.from(await reply.arrayBuffer());
  if (bytes.length < 100 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('render failed');
  return bytes;
}

export type AlertMessage = 'New viewing claim' | 'New offer' | 'Offer about to lapse';

/** Push one content-free alert to ntfy. */
export async function sendAlert(cfg: Config, message: AlertMessage): Promise<boolean> {
  const topic = 'open-bonnet-owner';
  const url = `${cfg.ntfy.url}/${topic}`;
  try {
    const headers: Record<string, string> = { Title: 'Open Bonnet' };
    const auth = Buffer.from(`${cfg.ntfy.username}:${cfg.ntfy.password}`).toString('base64');
    headers.Authorization = `Basic ${auth}`;
    const reply = await fetch(url, { method: 'POST', body: message, headers, signal: AbortSignal.timeout(3_000) });
    return reply.status >= 200 && reply.status < 300;
  } catch {
    return false;
  }
}
