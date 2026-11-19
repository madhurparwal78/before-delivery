// The crosstab CSV: the twin's header and rows exactly as the twin shows them, numbers without thousands separators.
import { buildTwin, type Twin, type TwinRow } from '../../shared/twin.ts';
import type { Cell } from '../../shared/model.ts';
import type { ExportDocument, SheetBlock } from './document.ts';

const EOL = '\r\n';
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function quoted(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A text cell that a spreadsheet could read as a formula gets a leading apostrophe. */
function textCell(text: string): string {
  return quoted(FORMULA_LEAD.test(text) ? `'${text}` : text);
}

/** The raw values behind a twin row, aligned with its heads and cells; reference and trend rows hold only labels and computed text. */
function rawOf(row: TwinRow, result: SheetBlock['result']): readonly (Cell | 'n/a')[] | null {
  if (row.mark !== null) return result.rows[row.mark] ?? null;
  return row.kind === 'total' ? result.total : null;
}

function rowLine(row: TwinRow, twin: Twin, raw: readonly (Cell | 'n/a')[] | null): string {
  const heads = row.heads.map((text, i) => (typeof raw?.[i] === 'number' ? quoted(text) : textCell(text)));
  const cells = row.cells.map((cell, i) => {
    const value = raw?.[twin.dimensions.length + i];
    return raw === null || typeof value === 'number' ? quoted(cell.text) : textCell(cell.text);
  });
  return [...heads, ...cells].join(',') + EOL;
}

function table(block: SheetBlock): string {
  const twin = buildTwin(block.result, { thousands: false });
  const header = [...twin.dimensions, ...twin.measures].map(textCell).join(',') + EOL;
  return header + twin.rows.map((row) => rowLine(row, twin, rawOf(row, block.result))).join('');
}

/** A sheet is its table; a dashboard is each sheet's table in layout order, each after a line with the sheet's name. */
export function renderCsv(document: ExportDocument): Buffer {
  const blocks = document.blocks.map((block) => (document.dashboard ? textCell(block.name) + EOL : '') + table(block));
  return Buffer.from(blocks.join(EOL), 'utf8');
}
