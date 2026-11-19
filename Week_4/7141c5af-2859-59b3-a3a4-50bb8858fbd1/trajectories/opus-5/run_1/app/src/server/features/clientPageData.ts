/**
 * The one reading of a client page, used by the server-rendered page and by
 * the page's own endpoint, so both say exactly the same thing.
 */
import type { App } from '../app.ts';
import { directionOf, type Language } from '../../shared/language.ts';
import { instantText, type Town } from '../domain/time.ts';
import { presentEstimate, type Row } from '../present.ts';
import { TOWN_NAMES } from '../../shared/clientCopy.ts';

export interface ClientPageFacts {
  pageId: string;
  token: string;
  deskId: string;
  pieceId: string;
  language: Language;
  town: Town;
  clientName: string;
  pieceTitle: string;
  dueDate: string | null;
  endsAtMs: number;
  sentAtMs: number;
  estimateId: string | null;
  material: { name: string; code: string; lot: string | null } | null;
  amounts: {
    material: string;
    labour: string;
    subtotal: string;
    tax: string;
    total: string;
    milestones: string[];
  } | null;
  notes: { kind: string; note: string }[];
  hasBefore: boolean;
  hasAfter: boolean;
  answer: { seatHeightCm: string; typed: string; answeredAtMs: number } | null;
  signOff: { typedName: string; atMs: number } | null;
}

export type ClientPageLookup =
  | { kind: 'live'; facts: ClientPageFacts; row: Row }
  | { kind: 'ended'; language: Language; row: Row }
  | { kind: 'missing' };

export async function lookupClientPage(app: App, token: string): Promise<ClientPageLookup> {
  const row = await app.db.one<Row>(
    `SELECT cp.*, p.title, p.due_date, p.id AS piece_id, p.desk_id,
            c.name AS client_name, c.town, c.language, c.state AS client_state
       FROM client_pages cp
       JOIN pieces p ON p.id = cp.piece_id
       JOIN clients c ON c.id = p.client_id
      WHERE cp.token = $1`,
    [token],
  );
  // From `erasing` on, a private page answers as unknown and never as ended.
  if (!row || row.client_state === 'erasing' || row.client_state === 'erased') {
    return { kind: 'missing' };
  }
  const language = String(row.language) as Language;
  const endsAtMs = new Date(row.ends_at as string).getTime();
  if (row.state === 'ended' || app.now() >= endsAtMs) return { kind: 'ended', language, row };

  const estimate = await app.db.one<Row>(
    `SELECT * FROM estimates WHERE piece_id = $1 AND state IN ('open','signedOff')
      ORDER BY version DESC LIMIT 1`,
    [row.piece_id],
  );
  const material = estimate?.material_code
    ? await app.db.one<Row>(`SELECT name FROM materials WHERE desk_id = $1 AND code = $2`, [
        row.desk_id,
        estimate.material_code,
      ])
    : null;
  const notes = await app.db.query<Row>(
    `SELECT kind, note FROM pins WHERE piece_id = $1 AND signed = true
      ORDER BY (y)::numeric, (x)::numeric, id`,
    [row.piece_id],
  );
  const sides = await app.db.query<Row>(
    `SELECT DISTINCT side FROM photographs WHERE piece_id = $1 AND state = 'stored'`,
    [row.piece_id],
  );

  let amounts: ClientPageFacts['amounts'] = null;
  if (estimate) {
    const display = presentEstimate(estimate).display as {
      material: string;
      labour: string;
      subtotal: string;
      tax: string;
      total: string;
      milestones: string[];
    };
    amounts = {
      material: display.material,
      labour: display.labour,
      subtotal: display.subtotal,
      tax: display.tax,
      total: display.total,
      milestones: display.milestones,
    };
  }

  return {
    kind: 'live',
    row,
    facts: {
      pageId: String(row.id),
      token,
      deskId: String(row.desk_id),
      pieceId: String(row.piece_id),
      language,
      town: String(row.town) as Town,
      clientName: String(row.client_name),
      pieceTitle: String(row.title),
      dueDate: row.due_date === null ? null : String(row.due_date),
      endsAtMs,
      sentAtMs: new Date(row.sent_at as string).getTime(),
      estimateId: estimate ? String(estimate.id) : null,
      material: estimate?.material_code
        ? {
            name: material ? String(material.name) : '',
            code: String(estimate.material_code),
            lot: estimate.lot === null ? null : String(estimate.lot),
          }
        : null,
      amounts,
      notes: notes.map((n) => ({ kind: String(n.kind), note: String(n.note) })),
      hasBefore: sides.some((s) => s.side === 'before'),
      hasAfter: sides.some((s) => s.side === 'after'),
      answer:
        row.answered_at === null
          ? null
          : {
              seatHeightCm: String(row.seat_height),
              typed: String(row.seat_height_text),
              answeredAtMs: new Date(row.answered_at as string).getTime(),
            },
      signOff:
        estimate && estimate.signed_at
          ? {
              typedName: String(estimate.signed_by),
              atMs: new Date(estimate.signed_at as string).getTime(),
            }
          : null,
    },
  };
}

/** The page body, which holds only the published keys. */
export function clientPageBody(facts: ClientPageFacts): Record<string, unknown> {
  return {
    language: facts.language,
    dir: directionOf(facts.language),
    clientName: facts.clientName,
    pieceTitle: facts.pieceTitle,
    dueDate: facts.dueDate,
    endsAt: instantText(facts.endsAtMs),
    estimateId: facts.estimateId,
    material: facts.material,
    estimate: facts.amounts,
    notes: facts.notes,
    answer: facts.answer
      ? {
          seatHeightCm: facts.answer.seatHeightCm,
          typed: facts.answer.typed,
          answeredAt: instantText(facts.answer.answeredAtMs),
        }
      : null,
    signOff: facts.signOff
      ? { typedName: facts.signOff.typedName, at: instantText(facts.signOff.atMs) }
      : null,
    town: TOWN_NAMES[facts.town]?.[facts.language] ?? facts.town,
  };
}
