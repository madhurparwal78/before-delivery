import { FormData as UndiciFormData, request } from 'undici';

/**
 * Gotenberg client. Renders a pack sheet HTML document to PDF through
 * Gotenberg's Chromium HTML-to-PDF conversion, sized to the hiker's paper.
 */

export class PrintingUnavailableError extends Error {
  constructor() {
    super('printing unavailable');
  }
}

const TIMEOUT_MS = 10_000;

/** A4 is 210×297 mm; Letter is 8.5×11 in, expressed in inches for Gotenberg. */
export const PAPER_SIZES: Readonly<Record<string, { width: string; height: string; unit: 'mm' | 'in' }>> = {
  A4: { width: '210', height: '297', unit: 'mm' },
  Letter: { width: '8.5', height: '11', unit: 'in' },
};

export async function renderPdf(gotenbergUrl: string, html: string, paperSize: string): Promise<Uint8Array> {
  const size = PAPER_SIZES[paperSize] ?? PAPER_SIZES.A4!;
  const form = new UndiciFormData();
  form.append('index.html', new File([html], 'index.html', { type: 'text/html' }));
  form.append('paperWidth', `${size.width}${size.unit}`);
  form.append('paperHeight', `${size.height}${size.unit}`);
  form.append('marginTop', '10mm');
  form.append('marginBottom', '10mm');
  form.append('marginLeft', '10mm');
  form.append('marginRight', '10mm');
  try {
    const response = await request(`${gotenbergUrl}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.body.destroy();
      throw new PrintingUnavailableError();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      chunks.push(chunk as Buffer);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new PrintingUnavailableError();
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof PrintingUnavailableError) throw error;
    throw new PrintingUnavailableError();
  }
}
