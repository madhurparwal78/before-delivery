// Apply the schema and insert the seed only where missing, safely across concurrent starts.

import type { Db } from './db';
import { SCHEMA_SQL, SEED_CLOSURES, SEED_ITEMS, SEED_LOANS, SEED_MEMBERS, SEED_STAFF, placePart } from './schema';
import { hashPassword } from './passwords';

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
  await db.exec('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  for (const [weekday, opens, closes] of [
    ['thursday', '16:00', '20:00'],
    ['saturday', '10:00', '16:00'],
    ['sunday', '12:00', '16:00'],
  ] as const) {
    await db.exec(
      'INSERT INTO opening_hours (weekday, opens, closes) VALUES ($1, $2, $3) ON CONFLICT (weekday) DO NOTHING',
      [weekday, opens, closes],
    );
  }
  for (const closure of SEED_CLOSURES) {
    await db.exec(`INSERT INTO closures (date, reason) VALUES (to_date($1, 'YYYY-MM-DD'), $2) ON CONFLICT (date) DO NOTHING`, [
      closure.date,
      closure.reason,
    ]);
  }
  for (const staff of SEED_STAFF) {
    const hash = await hashPassword(staff.password);
    await db.exec(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
      [staff.name, staff.email, hash, staff.role],
    );
  }
  const memberIds = new Map<string, number>();
  for (const member of SEED_MEMBERS) {
    const hash = await hashPassword(member.password);
    const rows = await db.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'member')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [member.name, member.email, hash],
    );
    const userId = rows[0]!.id;
    memberIds.set(member.email, userId);
    await db.exec(
      `INSERT INTO memberships (user_id, status, tier) VALUES ($1, 'pending-payment', $2) ON CONFLICT (user_id) DO NOTHING`,
      [userId, member.tier],
    );
  }

  // Items and parts, placed on the board in order.
  const existing = await db.one<{ id: number }>('SELECT id FROM items ORDER BY id LIMIT 1');
  if (existing === null) {
    const taken: { col: number; row: number; width: number; height: number }[] = [];
    const occupied = (col: number, row: number) =>
      taken.some((p) => col >= p.col && col < p.col + p.width && row >= p.row && row < p.row + p.height);
    for (const item of SEED_ITEMS) {
      const inserted = await db.query<{ id: number }>(
        `INSERT INTO items (tag, name, replacement_cost_cents, status) VALUES ($1, $2, $3, 'on-wall') RETURNING id`,
        [item.tag, item.name, item.replacement_cost_cents],
      );
      const itemId = inserted[0]!.id;
      for (const part of item.parts) {
        const spot = placePart(part.width, part.height, occupied);
        await db.exec(
          `INSERT INTO parts (item_id, name, shape, col, row, width, height, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'hung')`,
          [itemId, part.name, part.shape, spot.col, spot.row, part.width, part.height],
        );
        taken.push({ col: spot.col, row: spot.row, width: part.width, height: part.height });
      }
    }
  }

  // Loans: out, no photos, with the seed fee rules recording each item's replacement cost.
  const loanCount = await db.one<{ n: string }>('SELECT count(*)::text as n FROM loans');
  if (loanCount !== null && Number(loanCount.n) === 0) {
    let seq = 1;
    for (const loan of SEED_LOANS) {
      const memberId = memberIds.get(loan.memberEmail);
      if (memberId === undefined) continue;
      const checkout = new Date(`${loan.checkedOutAt}Z`);
      const itemRows = await db.query<{ id: number; replacement_cost_cents: number }>(
        'SELECT id, replacement_cost_cents FROM items WHERE tag = ANY($1::text[])',
        [loan.itemTags],
      );
      const costs: Record<string, number> = {};
      for (const item of itemRows) costs[String(item.id)] = item.replacement_cost_cents;
      const feeRules = { late_fee_cents: 250, damage_fee_cents: 1500, replacement_costs_cents: costs };
      const rows = await db.query<{ id: number }>(
        `INSERT INTO loans (ref, member_id, status, checked_out_at, due_date, loan_seq, fee_rules)
         VALUES ($1, $2, 'out', $3, to_date($4, 'YYYY-MM-DD'), $5, $6) RETURNING id`,
        [loan.ref, memberId, checkout, loan.dueDate, seq, JSON.stringify(feeRules)],
      );
      const loanId = rows[0]!.id;
      for (const item of itemRows) {
        await db.exec('INSERT INTO loan_items (loan_id, item_id) VALUES ($1, $2)', [loanId, item.id]);
        await db.exec(`UPDATE parts SET state = 'out' WHERE item_id = $1`, [item.id]);
        await db.exec(`UPDATE items SET status = 'out' WHERE id = $1`, [item.id]);
      }
      seq++;
    }
  }

  // Cleo's queued hold on the tile saw, position 1.
  const holdCount = await db.one<{ n: string }>('SELECT count(*)::text as n FROM holds');
  if (holdCount !== null && Number(holdCount.n) === 0) {
    const cleo = memberIds.get('cleo@members.example');
    const saw = await db.one<{ id: number }>('SELECT id FROM items WHERE tag = $1', ['PW-102']);
    if (cleo !== undefined && saw !== null) {
      await db.exec(`INSERT INTO holds (item_id, member_id, status) VALUES ($1, $2, 'queued')`, [saw.id, cleo]);
    }
  }
}
