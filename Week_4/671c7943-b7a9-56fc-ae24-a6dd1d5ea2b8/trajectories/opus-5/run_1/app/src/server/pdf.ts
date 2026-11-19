import { config } from './config.js';
import { briefHtml } from '../render/brief.js';
import type { StoredEnquiry } from '../shared/types.js';

const RENDER_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 2000;

export async function renderBrief(enquiry: StoredEnquiry): Promise<Buffer> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([briefHtml(enquiry)], { type: 'text/html' }),
    'index.html',
  );
  form.append('preferCssPageSize', 'true');
  form.append('nativePageRanges', '1-1');
  const response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Gotenberg answered ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function pdfServiceReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
