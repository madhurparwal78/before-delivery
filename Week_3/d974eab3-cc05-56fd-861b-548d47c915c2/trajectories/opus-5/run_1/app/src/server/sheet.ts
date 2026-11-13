import {
  editionLine,
  formatLine,
  notMedicineNotice,
  packLine,
  servingLine,
  sheetIngredientLine,
  sheetStepLine,
  storageLine,
} from '../shared/format';
import { ORGANISATION_NAME } from '../shared/messages';
import type { Product } from '../shared/types';
import { escapeHtml } from '../shared/escape';

const SHEET_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 2_000;
const BOUNDARY = 'vireo-pace-product-sheet-boundary';

/** The product sheet text, in the published order. */
function sheetLines(product: Product, edition: number): string[] {
  return [
    `${product.name} product information`,
    ORGANISATION_NAME,
    formatLine(product),
    servingLine(product),
    ...product.packs.map(packLine),
    'Ingredients per stick',
    ...product.ingredients.map(sheetIngredientLine),
    'How to use',
    ...product.how_to_use.map(sheetStepLine),
    storageLine(product),
    'Cautions',
    ...product.cautions,
    notMedicineNotice(product.name),
    editionLine(edition),
  ];
}

function sheetDocument(product: Product, edition: number): string {
  const notice = notMedicineNotice(product.name);
  const body = sheetLines(product, edition)
    .map(
      (line) =>
        `<p${line === notice ? ' class="notice"' : ''}>${escapeHtml(line)}</p>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(product.name)} product information</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Georgia, "Times New Roman", serif; color: #11201a; font-size: 11pt; line-height: 1.55; }
p { margin: 0 0 6pt; white-space: nowrap; }
p:first-child { font-size: 20pt; margin-bottom: 2pt; }
p.notice { font-size: 7.5pt; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function multipartBody(document: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="files"; filename="index.html"\r\n' +
        'Content-Type: text/html\r\n\r\n',
    ),
    Buffer.from(document, 'utf8'),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

/**
 * Prints the sheet from the stored product record. Each request contacts
 * Gotenberg anew, so no PDF is kept.
 */
export async function renderSheet(
  gotenbergUrl: string,
  product: Product,
  edition: number,
): Promise<Buffer | null> {
  try {
    const response = await fetch(
      `${gotenbergUrl}/forms/chromium/convert/html`,
      {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
        body: multipartBody(sheetDocument(product, edition)),
        signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function gotenbergAnswers(gotenbergUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${gotenbergUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
