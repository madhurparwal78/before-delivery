/**
 * The dispatch note. One is rendered by the server and stored in MinIO at each dispatch.
 * It is English throughout, uses the English money format, and its figures are the ones
 * read back from the current Kill Bill invoice and payment.
 */

import {
  carriageAmountLine,
  paidLine,
  partAmountLine,
  partLine,
  partNumberLine,
  totalLine,
} from '../shared/copy';

export interface DispatchNoteFigures {
  reference: string;
  bookletNumber: number;
  partName: string;
  partNumber: string;
  quantity: number;
  band: string;
  partLineMinor: number;
  carriageMinor: number;
  totalMinor: number;
  paidMinor: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** It holds no owner name, email, postcode or description. */
export function renderDispatchNote(figures: DispatchNoteFigures): Buffer {
  const lines = [
    `Claim ${figures.reference}`,
    partLine(figures.bookletNumber, figures.partName, 'en-GB'),
    partNumberLine(figures.partNumber, 'en-GB'),
    partAmountLine(figures.partLineMinor, 'en-GB'),
    carriageAmountLine(figures.band, figures.carriageMinor, 'en-GB'),
    totalLine(figures.totalMinor, 'en-GB'),
    paidLine(figures.paidMinor, 'en-GB'),
    `Quantity ${figures.quantity}`,
  ];

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Dispatch note ${escapeHtml(figures.reference)}</title></head>
<body>
<h1>Dispatch note</h1>
${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n')}
</body>
</html>
`;
  return Buffer.from(html, 'utf8');
}
