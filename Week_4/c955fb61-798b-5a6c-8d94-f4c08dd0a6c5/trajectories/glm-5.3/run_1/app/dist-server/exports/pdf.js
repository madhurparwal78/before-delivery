// A minimal PDF writer: A4 landscape, real selectable text, 20 rows a page, page numbers.
const PAGE_WIDTH = 842; // A4 landscape, points
const PAGE_HEIGHT = 595;
const MARGIN = 32;
const TITLE_SIZE = 14;
const ROW_SIZE = 12;
const ROW_LINE = 20;
const ROWS_PER_PAGE = 20;
const FOOTER_SIZE = 10;
/** PDF string with escaping, restricted to the base font's characters. */
function pdfText(value) {
    const latin = value.replace(/[^\x20-\x7E]/g, '?');
    return `(${latin.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')})`;
}
export function renderPdf(project) {
    const pageCount = Math.max(1, Math.ceil(project.items.length / ROWS_PER_PAGE));
    // Fixed object ids: 1 catalog, 2 pages tree, 3 font, then per page a stream and a page object.
    const streamIds = [];
    const pageIds = [];
    for (let i = 0; i < pageCount; i += 1) {
        streamIds.push(4 + i * 2);
        pageIds.push(5 + i * 2);
    }
    const chunks = [];
    chunks.push('%PDF-1.4\n');
    chunks.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    chunks.push(`2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>\nendobj\n`);
    chunks.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
    for (let page = 0; page < pageCount; page += 1) {
        const items = project.items.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
        const ops = [];
        ops.push('BT');
        ops.push(`/F1 ${TITLE_SIZE} Tf`);
        ops.push(`1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN - TITLE_SIZE} Tm`);
        ops.push(`${pdfText(project.name)} Tj`);
        ops.push('ET');
        ops.push('BT');
        ops.push(`/F1 ${ROW_SIZE} Tf`);
        let y = PAGE_HEIGHT - MARGIN - TITLE_SIZE - 28;
        for (const item of items) {
            const line = [String(item.row), item.name, item.start ?? '', item.end ?? '', String(item.duration), `${item.percent}%`].join(' ');
            ops.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
            ops.push(`${pdfText(line)} Tj`);
            y -= ROW_LINE;
        }
        ops.push('ET');
        ops.push('BT');
        ops.push(`/F1 ${FOOTER_SIZE} Tf`);
        ops.push(`1 0 0 1 ${MARGIN} ${MARGIN} Tm`);
        ops.push(`${pdfText(`Page ${page + 1} of ${pageCount}`)} Tj`);
        ops.push('ET');
        const stream = ops.join('\n');
        chunks.push(`${streamIds[page]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
        chunks.push(`${pageIds[page]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamIds[page]} 0 R >>\nendobj\n`);
    }
    const startxref = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk, 'latin1'), 0);
    const trailer = `trailer\n<< /Size ${4 + pageCount * 2} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
    chunks.push(trailer);
    const buffer = Buffer.from(chunks.join(''), 'latin1');
    return new Uint8Array(buffer);
}
