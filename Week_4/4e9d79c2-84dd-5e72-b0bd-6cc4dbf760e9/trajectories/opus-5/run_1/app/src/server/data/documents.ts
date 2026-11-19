import { inTransaction, makeId, one, query } from '../db.js';
import { ukDateOf } from '../../domain/time.js';

export type DocumentKind = 'quote' | 'confirmationLetter' | 'invoice' | 'creditNote' | 'seatPlan';
export const DOCUMENT_KINDS: DocumentKind[] = ['quote', 'confirmationLetter', 'invoice', 'creditNote', 'seatPlan'];

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  quote: 'Quote',
  confirmationLetter: 'Confirmation letter',
  invoice: 'Invoice',
  creditNote: 'Credit note',
  seatPlan: 'Seat plan',
};

export type DocumentState = 'waiting' | 'rendering' | 'stored';

export type HistoryEntry = { at: string; who: string; what: string };

export type DocumentRecord = {
  id: string;
  kind: DocumentKind;
  hireId: string;
  state: DocumentState;
  number: string | null;
  objectKey: string | null;
  customerName: string;
  createdAt: number;
  history: HistoryEntry[];
};

type DocumentRow = {
  id: string;
  kind: DocumentKind;
  hire_id: string;
  state: DocumentState;
  number: string | null;
  object_key: string | null;
  customer_name: string;
  created_at: string;
  history: HistoryEntry[];
};

const COLUMNS = 'id, kind, hire_id, state, number, object_key, customer_name, created_at, history';

function fromRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    kind: row.kind,
    hireId: row.hire_id,
    state: row.state,
    number: row.number,
    objectKey: row.object_key,
    customerName: row.customer_name,
    createdAt: Number(row.created_at),
    history: row.history,
  };
}

export async function documentsOf(deskId: string): Promise<DocumentRecord[]> {
  const rows = await query<DocumentRow>(
    `select ${COLUMNS} from documents where desk_id = $1 order by created_at desc, id`,
    [deskId],
  );
  return rows.map(fromRow);
}

export async function documentById(deskId: string, id: string): Promise<DocumentRecord | null> {
  const row = await one<DocumentRow>(`select ${COLUMNS} from documents where desk_id = $1 and id = $2`, [deskId, id]);
  return row ? fromRow(row) : null;
}

export async function startDocument(
  deskId: string,
  hireId: string,
  kind: DocumentKind,
  customerName: string,
  who: string,
  at: number,
): Promise<DocumentRecord> {
  const id = makeId('DOC');
  const history: HistoryEntry[] = [{ at: new Date(at).toISOString().slice(0, 19) + 'Z', who, what: 'Started' }];
  await query(
    `insert into documents (desk_id, id, hire_id, kind, state, customer_name, created_at, history)
     values ($1,$2,$3,$4,'waiting',$5,$6,$7)`,
    [deskId, id, hireId, kind, customerName, at, JSON.stringify(history)],
  );
  return {
    id,
    kind,
    hireId,
    state: 'waiting',
    number: null,
    objectKey: null,
    customerName,
    createdAt: at,
    history,
  };
}

export async function markRendering(deskId: string, id: string, who: string): Promise<void> {
  await query(
    `update documents set state = 'rendering',
       history = history || $3::jsonb where desk_id = $1 and id = $2`,
    [
      deskId,
      id,
      JSON.stringify([{ at: new Date().toISOString().slice(0, 19) + 'Z', who, what: 'Rendering' }]),
    ],
  );
}

export function documentObjectKey(deskId: string, documentId: string): string {
  return `desks/${deskId}/documents/${documentId}.pdf`;
}

const NUMBERED: Record<string, string> = { invoice: 'INV', creditNote: 'CN' };

/** A number is taken only once the PDF is stored, so a failed render burns no number. */
export async function storeDocument(
  deskId: string,
  id: string,
  kind: DocumentKind,
  objectKey: string,
  who: string,
  at: number,
): Promise<DocumentRecord> {
  return inTransaction(async (client) => {
    let number: string | null = null;
    const prefix = NUMBERED[kind];
    if (prefix) {
      const year = Number(ukDateOf(at).slice(0, 4));
      const taken = await client.query<{ last: number }>(
        `insert into doc_numbers (desk_id, year, kind, last) values ($1,$2,$3,1)
         on conflict (desk_id, year, kind) do update set last = doc_numbers.last + 1 returning last`,
        [deskId, year, kind],
      );
      number = `${prefix}-${year}-${String(Number(taken.rows[0].last)).padStart(4, '0')}`;
    }
    const answer = await client.query<DocumentRow>(
      `update documents set state = 'stored', number = $3, object_key = $4,
         history = history || $5::jsonb
       where desk_id = $1 and id = $2 returning ${COLUMNS}`,
      [
        deskId,
        id,
        number,
        objectKey,
        JSON.stringify([{ at: new Date(at).toISOString().slice(0, 19) + 'Z', who, what: 'Stored' }]),
      ],
    );
    return fromRow(answer.rows[0]);
  });
}

export async function removeDocument(deskId: string, id: string): Promise<void> {
  await query('delete from documents where desk_id = $1 and id = $2', [deskId, id]);
}

export async function nextNumbers(deskId: string, at: number): Promise<{ nextInvoice: string; nextCreditNote: string }> {
  const year = Number(ukDateOf(at).slice(0, 4));
  const rows = await query<{ kind: string; last: number }>(
    'select kind, last from doc_numbers where desk_id = $1 and year = $2',
    [deskId, year],
  );
  const lastOf = (kind: string): number => Number(rows.find((row) => row.kind === kind)?.last ?? 0);
  return {
    nextInvoice: `INV-${year}-${String(lastOf('invoice') + 1).padStart(4, '0')}`,
    nextCreditNote: `CN-${year}-${String(lastOf('creditNote') + 1).padStart(4, '0')}`,
  };
}

export async function countRecentDownloads(deskId: string, since: number): Promise<number> {
  const rows = await query<{ count: string }>(
    'select count(*)::text as count from file_downloads where desk_id = $1 and at > $2',
    [deskId, since],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markDownload(deskId: string, at: number): Promise<void> {
  await query('insert into file_downloads (desk_id, at) values ($1, $2)', [deskId, at]);
}

export async function oldestDownload(deskId: string, since: number): Promise<number | null> {
  const rows = await query<{ at: string }>(
    'select at from file_downloads where desk_id = $1 and at > $2 order by at limit 1',
    [deskId, since],
  );
  return rows[0] ? Number(rows[0].at) : null;
}

export async function documentsOfHire(deskId: string, hireId: string): Promise<DocumentRecord[]> {
  const rows = await query<DocumentRow>(
    `select ${COLUMNS} from documents where desk_id = $1 and hire_id = $2 order by created_at desc, id`,
    [deskId, hireId],
  );
  return rows.map(fromRow);
}

export async function renameDocumentCustomer(deskId: string, hireId: string, name: string): Promise<void> {
  await query('update documents set customer_name = $3 where desk_id = $1 and hire_id = $2', [deskId, hireId, name]);
}
