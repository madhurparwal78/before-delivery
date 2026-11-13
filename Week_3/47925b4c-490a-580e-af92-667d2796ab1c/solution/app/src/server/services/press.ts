import { config } from '../config.js';

export class PressUnavailable extends Error {}

const PRESS_LIMIT_MILLISECONDS = 20_000;
const PDF_SIGNATURE = '%PDF-';

/** Renders the rig sheet HTML into a PDF. Anything but a PDF in time is a failure. */
export async function renderPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  let response: Response;
  try {
    response = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(PRESS_LIMIT_MILLISECONDS),
    });
  } catch {
    throw new PressUnavailable('the press did not answer');
  }
  const payload = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new PressUnavailable(`the press answered ${response.status}`);
  if (payload.subarray(0, PDF_SIGNATURE.length).toString('latin1') !== PDF_SIGNATURE) {
    throw new PressUnavailable('the press did not answer with a PDF');
  }
  return payload;
}
