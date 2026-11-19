import { config, PACKET_RENDER_TIMEOUT_MS, SERVICE_PROBE_MS } from '../config.js';

let up = false;
let lastProbe = 0;

export async function probeGotenberg(): Promise<boolean> {
  if (Date.now() - lastProbe < SERVICE_PROBE_MS) return up;
  lastProbe = Date.now();
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    up = response.ok;
  } catch {
    up = false;
  }
  return up;
}

/** Renders one HTML document to PDF bytes, or throws when the service does not answer. */
export async function renderPdf(html: string, footerHtml: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('files', new Blob([footerHtml], { type: 'text/html' }), 'footer.html');
  form.append('marginTop', '0.4');
  form.append('marginBottom', '0.7');
  form.append('marginLeft', '0.4');
  form.append('marginRight', '0.4');
  form.append('printBackground', 'true');

  const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(PACKET_RENDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    up = false;
    throw new Error(`gotenberg answered ${response.status}`);
  }
  up = true;
  return Buffer.from(await response.arrayBuffer());
}
