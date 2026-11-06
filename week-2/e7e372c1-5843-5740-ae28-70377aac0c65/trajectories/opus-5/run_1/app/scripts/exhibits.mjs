// Generates the one-page, filing-safe exhibit PDFs shipped with the app.
// The byte layout is deterministic, so every build produces the same SHA-256.

export const SEEDED_EXHIBITS = [
  {
    accession: '0002093117-26-000041',
    weekEnding: '2026-10-11',
    rows: ['401250', '6120.5', '412.375', '407782.875', '10256.625', '148250000'],
  },
  {
    accession: '0002093117-26-000044',
    weekEnding: '2026-10-18',
    rows: ['407782.875', '4980.25', '408.0625', '413171.1875', '10664.6875', '150650000'],
  },
  {
    accession: '0002093117-26-000046',
    weekEnding: '2026-10-18',
    rows: ['407782.875', '4980.25', '418.0625', '413181.1875', '10674.6875', '150650000'],
  },
  {
    accession: '0002093117-26-000049',
    weekEnding: '2026-10-25',
    rows: ['413181.1875', '0', '421.5', '413602.6875', '11096.1875', '150150000'],
  },
];

const ROW_LABELS = [
  'Beginning ETH balance',
  'ETH acquired',
  'Staking rewards',
  'Ending ETH balance',
  'Cumulative staking rewards',
  'Assumed diluted shares',
];

function escapeText(value) {
  return value.replace(/([\\()])/g, '\\$1');
}

function contentStream(spec) {
  const lines = [];
  lines.push('BT /F2 16 Tf 56 742 Td (Vellichor Holdings, Inc.) Tj ET');
  lines.push('BT /F1 11 Tf 56 722 Td (Exhibit 99.1 - Weekly holdings restatement) Tj ET');
  lines.push(`BT /F1 11 Tf 56 704 Td (Accession ${escapeText(spec.accession)}) Tj ET`);
  lines.push(`BT /F1 11 Tf 56 686 Td (Week ending ${escapeText(spec.weekEnding)}) Tj ET`);
  lines.push('0.5 w 56 672 m 540 672 l S');
  let y = 648;
  for (let i = 0; i < ROW_LABELS.length; i += 1) {
    lines.push(`BT /F1 11 Tf 56 ${y} Td (${escapeText(ROW_LABELS[i])}) Tj ET`);
    lines.push(`BT /F3 11 Tf 360 ${y} Td (${escapeText(spec.rows[i])}) Tj ET`);
    lines.push(`0.25 w 56 ${y - 8} m 540 ${y - 8} l S`);
    y -= 26;
  }
  lines.push(`BT /F1 9 Tf 56 ${y - 14} Td (Figures are preliminary and unaudited.) Tj ET`);
  return lines.join('\n') + '\n';
}

export function seededExhibitPdf(spec) {
  const content = contentStream(spec);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 792] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
