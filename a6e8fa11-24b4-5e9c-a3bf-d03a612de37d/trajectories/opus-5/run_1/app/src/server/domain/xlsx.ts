import { CellValue, NumberFormat, formatSerialDate, generalNumberText, isError } from '../../shared/values';
import { XmlNode, escapeXml, findChild, findChildren, parseXml } from './xml';
import { ZipEntry, readZipEntry, writeZip } from './zip';

export interface ImportedCell {
  input: string;
  numberFormat: NumberFormat;
  bold: boolean;
}

export interface ImportedSheet {
  name: string;
  cells: Map<string, ImportedCell>;
}

interface StyleInfo {
  numberFormat: NumberFormat;
  bold: boolean;
  isDate: boolean;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58]);

function mapFormatCode(code: string): { numberFormat: NumberFormat; isDate: boolean } {
  const trimmed = code.trim();
  if (/[yd]/i.test(trimmed) && /[ym]/i.test(trimmed) && !trimmed.includes('%')) {
    return { numberFormat: 'date', isDate: true };
  }
  if (trimmed === '0') return { numberFormat: '0', isDate: false };
  if (trimmed === '0.0') return { numberFormat: '0.0', isDate: false };
  if (trimmed === '0.00') return { numberFormat: '0.00', isDate: false };
  if (trimmed === '0.000') return { numberFormat: '0.000', isDate: false };
  if (trimmed === '0.0%' || trimmed === '0.00%' || trimmed === '0%') return { numberFormat: '0.0%', isDate: false };
  return { numberFormat: 'general', isDate: false };
}

function readStyles(xml: string): StyleInfo[] {
  const root = parseXml(xml);
  const styleSheet = findChild(root, 'styleSheet');
  if (!styleSheet) return [];
  const customFormats = new Map<number, string>();
  const numFmts = findChild(styleSheet, 'numFmts');
  for (const numFmt of numFmts ? findChildren(numFmts, 'numFmt') : []) {
    customFormats.set(Number(numFmt.attrs.numFmtId), numFmt.attrs.formatCode ?? '');
  }
  const boldFonts: boolean[] = [];
  const fonts = findChild(styleSheet, 'fonts');
  for (const font of fonts ? findChildren(fonts, 'font') : []) {
    boldFonts.push(findChild(font, 'b') !== undefined);
  }
  const styles: StyleInfo[] = [];
  const cellXfs = findChild(styleSheet, 'cellXfs');
  for (const xf of cellXfs ? findChildren(cellXfs, 'xf') : []) {
    const numFmtId = Number(xf.attrs.numFmtId ?? '0');
    const code = customFormats.get(numFmtId);
    const mapped = code !== undefined ? mapFormatCode(code) : { numberFormat: 'general' as NumberFormat, isDate: false };
    const isDate = mapped.isDate || BUILTIN_DATE_FORMATS.has(numFmtId);
    const builtin = numFmtId === 1 ? '0' : numFmtId === 2 ? '0.00' : null;
    styles.push({
      numberFormat: isDate ? 'date' : builtin ?? mapped.numberFormat,
      bold: boldFonts[Number(xf.attrs.fontId ?? '0')] ?? false,
      isDate,
    });
  }
  return styles;
}

function readSharedStrings(xml: string): string[] {
  const root = parseXml(xml);
  const sst = findChild(root, 'sst');
  if (!sst) return [];
  return findChildren(sst, 'si').map((si) => {
    const direct = findChild(si, 't');
    if (direct) return direct.text;
    return findChildren(si, 'r')
      .map((run) => findChild(run, 't')?.text ?? '')
      .join('');
  });
}

export interface XlsxReadLimits {
  maxCells: number;
  maxColumns: number;
  maxRows: number;
}

export type XlsxReadResult =
  | { ok: true; sheets: ImportedSheet[] }
  | { ok: false; reason: 'too_many_cells' | 'unsupported_file' };

function entryByName(entries: ZipEntry[], name: string): ZipEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

function cellRefParts(ref: string): { column: number; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { column, row: Number(match[2]) };
}

export function readXlsx(data: Buffer, entries: ZipEntry[], limits: XlsxReadLimits): XlsxReadResult {
  const workbookEntry = entryByName(entries, 'xl/workbook.xml');
  if (!workbookEntry) return { ok: false, reason: 'unsupported_file' };
  const workbookXml = readZipEntry(data, workbookEntry);
  if (!workbookXml) return { ok: false, reason: 'unsupported_file' };
  const relsEntry = entryByName(entries, 'xl/_rels/workbook.xml.rels');
  const relsXml = relsEntry ? readZipEntry(data, relsEntry) : null;
  const targets = new Map<string, string>();
  if (relsXml) {
    const relsRoot = parseXml(relsXml.toString('utf8'));
    const relationships = findChild(relsRoot, 'Relationships');
    for (const rel of relationships ? findChildren(relationships, 'Relationship') : []) {
      targets.set(rel.attrs.Id, rel.attrs.Target);
    }
  }
  const stylesEntry = entryByName(entries, 'xl/styles.xml');
  const stylesXml = stylesEntry ? readZipEntry(data, stylesEntry) : null;
  const styles = stylesXml ? readStyles(stylesXml.toString('utf8')) : [];
  const sharedEntry = entryByName(entries, 'xl/sharedStrings.xml');
  const sharedXml = sharedEntry ? readZipEntry(data, sharedEntry) : null;
  const shared = sharedXml ? readSharedStrings(sharedXml.toString('utf8')) : [];

  const workbookRoot = parseXml(workbookXml.toString('utf8'));
  const workbookNode = findChild(workbookRoot, 'workbook');
  const sheetsNode = workbookNode ? findChild(workbookNode, 'sheets') : undefined;
  const sheetNodes = sheetsNode ? findChildren(sheetsNode, 'sheet') : [];
  const sheets: ImportedSheet[] = [];
  let filled = 0;

  for (const sheetNode of sheetNodes) {
    const relId = sheetNode.attrs['r:id'] ?? sheetNode.attrs['id'];
    const target = relId ? targets.get(relId) : undefined;
    const path = target
      ? `xl/${target.replace(/^\.?\//, '').replace(/^xl\//, '')}`
      : `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const sheetEntry = entryByName(entries, path);
    const cells = new Map<string, ImportedCell>();
    if (sheetEntry) {
      const sheetXml = readZipEntry(data, sheetEntry);
      if (!sheetXml) return { ok: false, reason: 'unsupported_file' };
      const root = parseXml(sheetXml.toString('utf8'));
      const worksheet = findChild(root, 'worksheet');
      const sheetData = worksheet ? findChild(worksheet, 'sheetData') : undefined;
      for (const rowNode of sheetData ? findChildren(sheetData, 'row') : []) {
        for (const cellNode of findChildren(rowNode, 'c')) {
          const ref = (cellNode.attrs.r ?? '').toUpperCase();
          const parts = cellRefParts(ref);
          if (!parts) continue;
          const imported = importCell(cellNode, styles, shared);
          if (!imported) continue;
          if (parts.column > limits.maxColumns || parts.row > limits.maxRows) {
            return { ok: false, reason: 'too_many_cells' };
          }
          filled += 1;
          if (filled > limits.maxCells) return { ok: false, reason: 'too_many_cells' };
          cells.set(ref, imported);
        }
      }
    }
    sheets.push({ name: sheetNode.attrs.name ?? `Sheet${sheets.length + 1}`, cells });
  }
  return { ok: true, sheets };
}

function importCell(cellNode: XmlNode, styles: StyleInfo[], shared: string[]): ImportedCell | null {
  const style = styles[Number(cellNode.attrs.s ?? '-1')] ?? { numberFormat: 'general' as NumberFormat, bold: false, isDate: false };
  const type = cellNode.attrs.t ?? 'n';
  const formulaNode = findChild(cellNode, 'f');
  const valueNode = findChild(cellNode, 'v');
  const inlineNode = findChild(cellNode, 'is');
  let input: string | null = null;
  if (formulaNode && formulaNode.text.trim() !== '') {
    input = `=${formulaNode.text.trim()}`;
  } else if (type === 's') {
    const index = Number(valueNode?.text ?? '-1');
    input = shared[index] ?? '';
  } else if (type === 'inlineStr') {
    input = inlineNode ? findChild(inlineNode, 't')?.text ?? inlineNode.text : '';
  } else if (type === 'str') {
    input = valueNode?.text ?? '';
  } else if (type === 'b') {
    input = valueNode?.text === '1' ? 'TRUE' : 'FALSE';
  } else if (type === 'e') {
    input = valueNode?.text ?? '';
  } else {
    const raw = valueNode?.text;
    if (raw === undefined || raw.trim() === '') return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    input = style.isDate ? formatSerialDate(numeric) : String(numeric);
  }
  if (input === null || input === '') return null;
  const needsQuote = !formulaNode && (type === 's' || type === 'inlineStr' || type === 'str') && input.startsWith('=');
  return {
    input: needsQuote ? `'${input}` : input,
    numberFormat: style.numberFormat,
    bold: style.bold,
  };
}

export interface ExportSheet {
  name: string;
  cells: {
    ref: string;
    column: number;
    row: number;
    input: string;
    value: CellValue;
    numberFormat: NumberFormat;
    bold: boolean;
  }[];
}

const FORMAT_CODES: Record<NumberFormat, string | null> = {
  general: null,
  '0': '0',
  '0.0': '0.0',
  '0.00': '0.00',
  '0.000': '0.000',
  '0.0%': '0.0%',
  date: 'yyyy-mm-dd',
};

const FORMAT_ORDER: NumberFormat[] = ['general', '0', '0.0', '0.00', '0.000', '0.0%', 'date'];

function styleIndex(numberFormat: NumberFormat, bold: boolean): number {
  return FORMAT_ORDER.indexOf(numberFormat) * 2 + (bold ? 1 : 0);
}

function stylesXml(): string {
  const numFmts = FORMAT_ORDER.map((format, index) =>
    FORMAT_CODES[format] ? `<numFmt numFmtId="${164 + index}" formatCode="${FORMAT_CODES[format]}"/>` : '',
  ).join('');
  const xfs = FORMAT_ORDER.flatMap((format, index) => {
    const numFmtId = FORMAT_CODES[format] ? 164 + index : 0;
    return [false, true].map(
      (bold) =>
        `<xf numFmtId="${numFmtId}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"` +
        ` applyNumberFormat="1" applyFont="1"/>`,
    );
  }).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="${FORMAT_ORDER.filter((format) => FORMAT_CODES[format]).length}">${numFmts}</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${FORMAT_ORDER.length * 2}">${xfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sheetXml(sheet: ExportSheet): string {
  const rows = new Map<number, ExportSheet['cells']>();
  for (const cell of sheet.cells) {
    const list = rows.get(cell.row);
    if (list) list.push(cell);
    else rows.set(cell.row, [cell]);
  }
  const rowXml = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((rowNumber) => {
      const cells = (rows.get(rowNumber) as ExportSheet['cells'])
        .sort((a, b) => a.column - b.column)
        .map((cell) => cellXml(cell))
        .join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

function cellXml(cell: ExportSheet['cells'][number]): string {
  const style = ` s="${styleIndex(cell.numberFormat, cell.bold)}"`;
  const formula = cell.input.startsWith('=') ? escapeXml(cell.input.slice(1)) : null;
  const value = cell.value;
  if (formula !== null) {
    if (isError(value)) return `<c r="${cell.ref}"${style} t="e"><f>${formula}</f><v>${value.err}</v></c>`;
    if (typeof value === 'number') return `<c r="${cell.ref}"${style}><f>${formula}</f><v>${value}</v></c>`;
    if (typeof value === 'boolean') {
      return `<c r="${cell.ref}"${style} t="b"><f>${formula}</f><v>${value ? 1 : 0}</v></c>`;
    }
    const text = value === null ? '' : String(value);
    return `<c r="${cell.ref}"${style} t="str"><f>${formula}</f><v>${escapeXml(text)}</v></c>`;
  }
  if (isError(value)) return `<c r="${cell.ref}"${style} t="e"><v>${value.err}</v></c>`;
  if (typeof value === 'number') return `<c r="${cell.ref}"${style}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${cell.ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  if (value === null) return '';
  return `<c r="${cell.ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    typeof value === 'string' ? value : generalNumberText(value),
  )}</t></is></c>`;
}

export function writeXlsx(sheets: ExportSheet[]): Buffer {
  const sheetFiles = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: Buffer.from(sheetXml(sheet), 'utf8'),
  }));
  const workbookSheets = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  const workbookRels = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"` +
        ` Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets
      .map(
        (_sheet, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml"` +
          ` ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `</Types>`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
        'utf8',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
          ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets>${workbookSheets}</sheets></workbook>`,
        'utf8',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `${workbookRels}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`,
        'utf8',
      ),
    },
    { name: 'xl/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
    ...sheetFiles,
  ]);
}
