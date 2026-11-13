import { isCurrency } from '../shared/amount.js';
import type { Currency } from '../shared/amount.js';
import { PURCHASE_STATUSES } from '../shared/types.js';
import type { LookupBody, PurchaseBody, PurchaseStatus } from '../shared/types.js';
import { config } from './config.js';

const LOOKUP_LIMIT_MS = 3000;
const MAX_PAGES = 5;

type Receipt = LookupBody['receipts'][number];


function parseReceipt(value: unknown): Receipt | null {
  if (value === null || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.receipt_id !== 'string' || typeof r.item !== 'string' || !Number.isInteger(r.amount_minor) ||
    !isCurrency(r.currency) || typeof r.purchased_at !== 'string' || typeof r.status !== 'string' || !(PURCHASE_STATUSES as readonly string[]).includes(r.status)
  ) return null;
  return {
    receipt_id: r.receipt_id, item: r.item, amount_minor: r.amount_minor as number, currency: r.currency as Currency,
    purchased_at: r.purchased_at, status: r.status as PurchaseStatus,
  };
}

async function fetchRecord(gameSlug: string, playerId: string, signal: AbortSignal): Promise<Receipt[] | null> {
  const base = `${config.wiremockUrl}/v1/games/${encodeURIComponent(gameSlug)}/players/${encodeURIComponent(playerId)}/receipts`;
  const receipts: Receipt[] = [];
  const asked = new Set<string>();
  let cursor: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response: Response = await fetch(cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (response.status === 404) {
      await response.arrayBuffer();
      return page === 1 ? [] : null;
    }
    if (response.status !== 200) {
      await response.arrayBuffer();
      return null;
    }
    const body: unknown = await response.json();
    const list = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).receipts : undefined;
    if (!Array.isArray(list)) return null;
    for (const item of list) {
      const receipt = parseReceipt(item);
      if (!receipt) return null;
      receipts.push(receipt);
    }
    const next = (body as Record<string, unknown>).next_cursor;
    if (next === undefined || next === null) return receipts;
    if (typeof next !== 'string' || asked.has(next)) return null;
    asked.add(next);
    cursor = next;
  }
  return null;
}

function compareWithRecord(purchase: PurchaseBody, record: readonly Receipt[]): { on_game_server: boolean; differences: string[] } {
  const listed = record.find((receipt) => receipt.receipt_id === purchase.receipt_id);
  if (!listed) return { on_game_server: false, differences: [] };
  const differences: string[] = [];
  if (listed.item !== purchase.item) differences.push('item');
  if (listed.amount_minor !== purchase.amount_minor) differences.push('amount');
  if (listed.currency !== purchase.currency) differences.push('currency');
  if (listed.status !== purchase.status) differences.push('status');
  return { on_game_server: true, differences };
}

export async function lookupReceipts(gameSlug: string, playerId: string, purchases: readonly PurchaseBody[]): Promise<LookupBody> {
  let record: Receipt[] | null;
  try {
    record = await fetchRecord(gameSlug, playerId, AbortSignal.timeout(LOOKUP_LIMIT_MS));
  } catch {
    record = null;
  }
  if (record === null) {
    return {
      available: false,
      receipts: [],
      purchases: purchases.map((purchase) => ({ receipt_id: purchase.receipt_id, on_game_server: null, differences: [] })),
    };
  }
  const listing = record;
  return {
    available: true,
    receipts: listing,
    purchases: purchases.map((purchase) => ({ receipt_id: purchase.receipt_id, ...compareWithRecord(purchase, listing) })),
  };
}
