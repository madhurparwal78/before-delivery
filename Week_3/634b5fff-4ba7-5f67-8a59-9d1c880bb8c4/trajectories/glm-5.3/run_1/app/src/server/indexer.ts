import { publicIndex, staffIndex, searchUp } from './search.js';
import { query } from './db.js';
import type { TalePassage } from './tale.js';

/** Index the passages once (idempotent). */
export async function indexPassages(passages: TalePassage[]): Promise<void> {
  const docs = passages.map((p) => ({
    id: `p-${p.passageId}`,
    kind: 'passage' as const,
    passageId: p.passageId,
    chapter: p.chapter,
    text: p.text,
  }));
  await publicIndex.addDocuments(docs, { primaryKey: 'id' });
}

/** A box leaves the public index when it sells and returns when available. */
export async function reindexBox(number: number, plate: string, state: string): Promise<void> {
  const sold = !['available', 'held'].includes(state);
  if (sold) {
    await publicIndex.deleteDocument(`b-${number}`);
  } else {
    await publicIndex.addDocuments([{ id: `b-${number}`, kind: 'box', number, plate }], { primaryKey: 'id' });
  }
  await syncStaffBox(number);
}

export async function syncStaffBox(number: number): Promise<void> {
  const rows = await query<{ number: number; plate: string; box_state: string; recipient: string | null; reference: string | null }>(
    `SELECT b.number, b.plate, b.box_state,
            COALESCE(o.gift_recipient_name, o.buyer_name) AS recipient, o.reference
       FROM boxes b LEFT JOIN orders o ON o.number = b.number
      WHERE b.number = $1
      ORDER BY o.created_at DESC NULLS LAST LIMIT 1`,
    [number],
  );
  if (rows.length === 0) return;
  const r = rows[0];
  await staffIndex.addDocuments([{
    id: `b-${number}`,
    number: r.number,
    plate: r.plate,
    state: r.box_state,
    recipientName: r.recipient,
    reference: r.reference,
  }], { primaryKey: 'id' });
}

/** Rebuild both indexes from the database (used on serve and after outages). */
export async function rebuildIndexes(passages: TalePassage[]): Promise<void> {
  if (!(await searchUp())) return;
  await indexPassages(passages);
  const rows = await query<{ number: number; plate: string; box_state: string }>('SELECT number, plate, box_state FROM boxes');
  const publicDocs = rows.filter((r) => ['available', 'held'].includes(r.box_state))
    .map((r) => ({ id: `b-${r.number}`, kind: 'box' as const, number: r.number, plate: r.plate }));
  await publicIndex.addDocuments(publicDocs, { primaryKey: 'id' });
  const staffRows = await query<{ number: number; plate: string; box_state: string; recipient: string | null; reference: string | null }>(
    `SELECT DISTINCT ON (b.number) b.number, b.plate, b.box_state,
            COALESCE(o.gift_recipient_name, o.buyer_name) AS recipient, o.reference
       FROM boxes b LEFT JOIN orders o ON o.number = b.number
      ORDER BY b.number, o.created_at DESC NULLS LAST`,
  );
  await staffIndex.addDocuments(staffRows.map((r) => ({
    id: `b-${r.number}`,
    number: r.number,
    plate: r.plate,
    state: r.box_state,
    recipientName: r.recipient,
    reference: r.reference,
  })), { primaryKey: 'id' });
}

/** Fallback staff search straight from Postgres. */
export async function staffSearchFallback(q: string): Promise<{ number: number; plate: string; state: string; recipientName: string | null; reference: string | null }[]> {
  const asNum = Number(q);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 240) {
    return query(`SELECT DISTINCT ON (b.number) b.number, b.plate, b.box_state AS state,
            COALESCE(o.gift_recipient_name, o.buyer_name) AS "recipientName", o.reference
       FROM boxes b LEFT JOIN orders o ON o.number = b.number
      WHERE b.number = $1 ORDER BY b.number, o.created_at DESC NULLS LAST`, [asNum]);
  }
  return query(`SELECT DISTINCT ON (b.number) b.number, b.plate, b.box_state AS state,
          COALESCE(o.gift_recipient_name, o.buyer_name) AS "recipientName", o.reference
     FROM boxes b LEFT JOIN orders o ON o.number = b.number
    WHERE b.plate = $1 OR lower(COALESCE(o.gift_recipient_name, o.buyer_name)) LIKE $2
    ORDER BY b.number, o.created_at DESC NULLS LAST`,
    [q.toLowerCase(), `%${q.toLowerCase()}%`]);
}
