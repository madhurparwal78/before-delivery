import { config } from '../config';
import { refuse } from '../domain/errors';

const TIMEOUT_MS = 20_000;

/** Renders one HTML document to a PDF through Gotenberg. */
export const renderPdf = async (html: string): Promise<Buffer> => {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('paperWidth', '8.27');
  form.append('paperHeight', '11.69');
  form.append('marginTop', '0.4');
  form.append('marginBottom', '0.4');
  form.append('marginLeft', '0.4');
  form.append('marginRight', '0.4');
  form.append('printBackground', 'true');

  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw refuse(503, 'report_render_failed', 'The report could not be rendered');
  }

  if (!response.ok) throw refuse(503, 'report_render_failed', 'The report could not be rendered');
  return Buffer.from(await response.arrayBuffer());
};

export const gotenbergReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${config.gotenbergUrl}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
};
