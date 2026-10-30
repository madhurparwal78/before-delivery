import type { PoolClient } from 'pg';
import { rows } from '../db.js';
import { ACCESSORY_LINE_CAP, BUILD_LINE_CAP, BUILD_TOTAL_CAP } from './cart.js';

interface MergeLine {
  id: number;
  type: string;
  build_code: string | null;
  sku: string;
  quantity: number;
}

function sameItem(a: MergeLine, b: MergeLine): boolean {
  return a.type === b.type && (a.type === 'build' ? a.build_code === b.build_code : a.sku === b.sku);
}

/** Merges the guest cart into the account cart, then empties the guest cart. */
export async function mergeGuestCart(client: PoolClient, guestCartId: number, accountCartId: number, at: Date): Promise<void> {
  if (guestCartId === accountCartId) return;

  const lineSql = 'SELECT id, type, build_code, sku, quantity FROM cart_lines WHERE cart_id = $1 ORDER BY id';
  const guestLines = await rows<MergeLine>(client, lineSql, [guestCartId]);
  const accountLines = await rows<MergeLine>(client, lineSql, [accountCartId]);

  interface Merged {
    accountId: number | null;
    line: MergeLine;
    accountQuantity: number;
    guestQuantity: number;
    guestOrder: number;
  }

  const merged: Merged[] = accountLines.map((line) => ({
    accountId: Number(line.id),
    line,
    accountQuantity: line.quantity,
    guestQuantity: 0,
    guestOrder: -1,
  }));

  guestLines.forEach((guest, index) => {
    const existing = merged.find((m) => sameItem(m.line, guest));
    if (existing) {
      existing.guestQuantity += guest.quantity;
      existing.guestOrder = index;
    } else {
      merged.push({ accountId: null, line: guest, accountQuantity: 0, guestQuantity: guest.quantity, guestOrder: index });
    }
  });

  for (const entry of merged) {
    const cap = entry.line.type === 'build' ? BUILD_LINE_CAP : ACCESSORY_LINE_CAP;
    const wanted = Math.min(cap, entry.accountQuantity + entry.guestQuantity);
    entry.guestQuantity = wanted - entry.accountQuantity;
  }

  const buildEntries = merged.filter((m) => m.line.type === 'build');
  let buildTotal = buildEntries.reduce((sum, m) => sum + m.accountQuantity + m.guestQuantity, 0);
  const newestGuestFirst = buildEntries
    .filter((m) => m.guestQuantity > 0)
    .sort((a, b) => b.guestOrder - a.guestOrder);
  for (const entry of newestGuestFirst) {
    if (buildTotal <= BUILD_TOTAL_CAP) break;
    const reduceBy = Math.min(entry.guestQuantity, buildTotal - BUILD_TOTAL_CAP);
    entry.guestQuantity -= reduceBy;
    buildTotal -= reduceBy;
  }

  for (const entry of merged) {
    const total = entry.accountQuantity + entry.guestQuantity;
    if (entry.accountId !== null) {
      if (total !== entry.accountQuantity) {
        await client.query('UPDATE cart_lines SET quantity = $2 WHERE id = $1', [entry.accountId, total]);
      }
    } else if (total > 0) {
      await client.query(
        'INSERT INTO cart_lines (cart_id, type, build_code, sku, quantity, added_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [accountCartId, entry.line.type, entry.line.build_code, entry.line.sku, total, at],
      );
    }
  }

  const codeSql = 'SELECT code FROM cart_codes WHERE cart_id = $1 ORDER BY id';
  const accountCodes = await rows<{ code: string }>(client, codeSql, [accountCartId]);
  const guestCodes = await rows<{ code: string }>(client, codeSql, [guestCartId]);
  let codeCount = accountCodes.length;
  for (const { code } of guestCodes) {
    if (codeCount >= 2) break;
    if (accountCodes.some((c) => c.code === code)) continue;
    await client.query('INSERT INTO cart_codes (cart_id, code, added_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
      accountCartId,
      code,
      at,
    ]);
    codeCount += 1;
  }

  await client.query('DELETE FROM cart_lines WHERE cart_id = $1', [guestCartId]);
  await client.query('DELETE FROM cart_codes WHERE cart_id = $1', [guestCartId]);
}
