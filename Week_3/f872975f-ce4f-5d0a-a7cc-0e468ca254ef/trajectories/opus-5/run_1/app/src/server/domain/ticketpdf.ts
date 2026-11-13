import { PiecePlacement } from '../../shared/geometry';
import { InvoiceLine } from '../../shared/money';
import { renderTextPdf } from '../services/pdf';

export interface CutTicketFacts {
  ticketId: string;
  boardTag: string;
  makerName: string;
  pieces: PiecePlacement[];
  cuts_mm: number[];
  take_mm: number;
  offcut_mm: number | null;
  lines: InvoiceLine[];
}

function dollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `${whole.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}`;
}

/** The only fields the stored cut ticket shows, as extractable text. */
export function renderCutTicketPdf(facts: CutTicketFacts): Buffer {
  const lines: string[] = [
    `Cut ticket ${facts.ticketId}`,
    `Board ${facts.boardTag}`,
    `Maker ${facts.makerName}`,
    'Pieces',
    ...facts.pieces.map((piece) => `${piece.label} ${piece.length_mm} mm at ${piece.start_mm} mm`),
    `Cuts ${facts.cuts_mm.map((cut) => `${cut} mm`).join(', ')}`,
    `Take ${facts.take_mm} mm`,
    `Planned offcut ${facts.offcut_mm === null ? 'none' : `${facts.offcut_mm} mm`}`,
    'Invoice lines',
    ...facts.lines.map((line) => `${line.label} $${dollars(line.amount_cents)}`)
  ];
  return renderTextPdf(lines);
}
