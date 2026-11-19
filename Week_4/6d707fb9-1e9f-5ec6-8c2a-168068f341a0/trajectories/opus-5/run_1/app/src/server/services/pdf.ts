import { randomBytes } from 'node:crypto';
import { config } from '../config';

export class DossierServiceDown extends Error {}

const TIMEOUT_MS = 20000;

/** The dossier's HTML goes to Gotenberg as index.html and comes back as a PDF. */
export async function renderPdf(html: string): Promise<Buffer> {
  const boundary = `fio${randomBytes(12).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, Buffer.from(html, 'utf8'), tail]);

  let answer: Response;
  try {
    answer = await fetch(`${config.gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DossierServiceDown('the dossier service did not answer');
  }
  if (!answer.ok) throw new DossierServiceDown(`the dossier service answered ${answer.status}`);
  return Buffer.from(await answer.arrayBuffer());
}
