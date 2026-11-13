import { pool } from './db.js';
import { emitFor } from './events.js';
import { writeLedgerEntry } from './ledger.js';
import { parseStrike } from './grantJson.js';
import { centsString } from './vesting.js';
import { divRoundHalfUp } from './decimal.js';
import { HttpError } from './errors.js';

interface Submission {
  person_id: string;
  holder_name: string;
  shares: bigint;
  sequence: number;
  class: string;
}

export function allocate(cap: bigint, subs: Submission[]): Map<string, { allocation: bigint; proceeds: bigint }> {
  const total = subs.reduce((a, s) => a + s.shares, 0n);
  const out = new Map<string, { allocation: bigint; proceeds: bigint }>();
  if (total <= cap) {
    for (const s of subs) out.set(s.person_id, { allocation: s.shares, proceeds: 0n });
    return out;
  }
  const floors = subs.map((s) => (s.shares * cap) / total);
  let leftover = cap - floors.reduce((a, b) => a + b, 0n);
  const order = [...subs.keys()].sort((a, b) => subs[a]!.sequence - subs[b]!.sequence);
  for (const idx of order) {
    if (leftover <= 0n) break;
    floors[idx]! += 1n;
    leftover -= 1n;
  }
  subs.forEach((s, i) => out.set(s.person_id, { allocation: floors[i]!, proceeds: 0n }));
  return out;
}

/** Closes the tender and allocates pro rata in whole shares, moving shares on the ledger. */
export async function allocateTender(tenderId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const t = await client.query(
        'SELECT * FROM tenders WHERE id = $1 FOR UPDATE',
        [tenderId],
      );
      const tender = t.rows[0] as
        | { id: string; title: string; price_per_share: string; share_cap: string; closes_at: Date; state: string }
        | undefined;
      if (!tender || tender.state !== 'open') {
        await client.query('COMMIT');
        return;
      }
      const subs = await client.query(
        'SELECT s.person_id, p.name AS holder_name, s.shares, s.sequence FROM tender_submissions s JOIN people p ON p.id = s.person_id WHERE s.tender_id = $1 ORDER BY s.sequence',
        [tenderId],
      );
      const classes = await client.query<{ person_id: string; class: string }>(
        'SELECT person_id, class FROM share_holdings',
      );
      const classMap = new Map<string, string>();
      for (const h of classes.rows) if (!classMap.has(h.person_id)) classMap.set(h.person_id, h.class);

      const subs2: Submission[] = subs.rows.map((s: { person_id: string; holder_name: string; shares: string; sequence: string }) => ({
        person_id: s.person_id,
        holder_name: s.holder_name,
        shares: BigInt(s.shares),
        sequence: Number(s.sequence),
        class: classMap.get(s.person_id) ?? 'Common',
      }));
      const cap = BigInt(tender.share_cap);
      const allocs = allocate(cap, subs2);
      const priceDec = parseStrike(tender.price_per_share);

      const buyer = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM people WHERE email = 'harbourline@harbourline.example'",
      );
      const buyerRow = buyer.rows[0];

      await client.query("UPDATE tenders SET state = 'allocated' WHERE id = $1", [tenderId]);
      for (const s of subs2) {
        const alloc = allocs.get(s.person_id)!.allocation;
        const proceeds = divRoundHalfUp(alloc * priceDec.unscaled, 10n ** BigInt(priceDec.scale), 2).unscaled;
        allocs.get(s.person_id)!.proceeds = proceeds;
        await client.query(
          'INSERT INTO tender_allocations (tender_id, person_id, allocation, proceeds_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (tender_id, person_id) DO UPDATE SET allocation = $3, proceeds_cents = $4',
          [tenderId, s.person_id, alloc, proceeds],
        );
        if (alloc > 0n) {
          // Move the shares from the seller to Harbourline in the seller's class.
          await client.query(
            'UPDATE share_holdings SET shares = shares - $1 WHERE person_id = $2 AND class = $3',
            [alloc, s.person_id, s.class],
          );
          await client.query(
            `INSERT INTO share_holdings (person_id, class, shares) VALUES ($1,$2,$3)
             ON CONFLICT (person_id, class) DO UPDATE SET shares = share_holdings.shares + $3`,
            [buyerRow?.id ?? 'PER-011', s.class, alloc],
          );
          await writeLedgerEntry(client, {
            holder_id: s.person_id, holder_name: s.holder_name, kind: 'tender_transfer', class: s.class,
            shares_delta: -Number(alloc), options_delta: 0, reference: tenderId,
          });
          await writeLedgerEntry(client, {
            holder_id: buyerRow?.id ?? 'PER-011', holder_name: buyerRow?.name ?? 'Harbourline Secondary Partners',
            kind: 'tender_transfer', class: s.class, shares_delta: Number(alloc), options_delta: 0, reference: tenderId,
          });
        }
        await emitFor(client, s.person_id, 'tender_closed', { tender_id: tenderId, allocation: Number(alloc), proceeds: centsString(proceeds) });
      }
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) {
        await emitFor(client, a.id, 'tender_closed', { tender_id: tenderId });
        await emitFor(client, a.id, 'cap_table_changed', {});
      }
      const investors = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'investor' AND access = 'active'");
      for (const i of investors.rows) await emitFor(client, i.id, 'cap_table_changed', {});
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } finally {
    client.release();
  }
}

export { HttpError };
