/** The monthly sanitation PDF, rendered at the moment it is stored. */
import { addMonths, monthLabel } from '../../shared/calendar.js';
import { db } from '../db/pool.js';
import { monthStartInstant } from '../domain/time.js';
import type { Kitchen } from '../domain/types.js';
import { entriesBetween } from '../store/sanitation.js';
import { localDateOf, localTimeOf } from '../domain/time.js';
import { renderPdf, type PdfLine } from './pdf.js';

export async function renderSanitationPdf(kitchen: Kitchen, month: string): Promise<Buffer> {
  const from = monthStartInstant(kitchen.timeZone, month);
  const to = monthStartInstant(kitchen.timeZone, addMonths(month, 1));
  const entries = await entriesBetween(db(), kitchen.id, from, to);
  const lines: PdfLine[] = [
    { text: `${kitchen.name} sanitation log`, bold: true, size: 14 },
    { text: monthLabel(month), bold: true, size: 11 },
    { text: '' },
    { text: 'Date Time Area Task Sanitizer Initials Notes Logged by', bold: true },
  ];
  for (const entry of entries.slice().reverse()) {
    const ppm = entry.sanitizerPpm === null ? '-' : `${entry.sanitizerPpm} ppm`;
    lines.push({
      text:
        `${localDateOf(kitchen.timeZone, entry.loggedAtMs)} ` +
        `${localTimeOf(kitchen.timeZone, entry.loggedAtMs)} | ${entry.area} | ${entry.task} | ` +
        `${ppm} | ${entry.initials} | ${entry.notes} | ${entry.loggedBy}`,
    });
  }
  if (entries.length === 0) lines.push({ text: 'No entries logged this month.' });
  return renderPdf(lines);
}
