import { config } from '../config.js';

export class DocumentsUnavailable extends Error {}

export const documentsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
};

/** Renders the studio's HTML template to a PDF. */
export const renderPdf = async (html: string): Promise<Buffer> => {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.69');
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DocumentsUnavailable('gotenberg unreachable');
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new DocumentsUnavailable(`gotenberg responded ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};
