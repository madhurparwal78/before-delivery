// The one receipt-comparison decision.
import { loadConfig } from './config';
import type { PurchaseView } from './purchases';

export interface GameReceipt {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  purchased_at: string;
  status: 'paid' | 'partly_refunded' | 'refunded';
}

export interface LookupResult {
  available: boolean;
  receipts: GameReceipt[];
  purchases: { receipt_id: string; on_game_server: boolean | null; differences: string[] }[];
}

interface WireReceipt {
  receipt_id?: unknown;
  item?: unknown;
  amount_minor?: unknown;
  currency?: unknown;
  purchased_at?: unknown;
  status?: unknown;
}

const DIFFERENCE_FIELDS = ['item', 'amount', 'currency', 'status'] as const;

export function compareReceipts(receipts: GameReceipt[], purchases: PurchaseView[]): { receipt_id: string; on_game_server: boolean; differences: string[] }[] {
  const byId = new Map(receipts.map((receipt) => [receipt.receipt_id, receipt]));
  return purchases.map((purchase) => {
    const listed = byId.get(purchase.receipt_id);
    if (!listed) return { receipt_id: purchase.receipt_id, on_game_server: false, differences: [] };
    const differing: Partial<Record<(typeof DIFFERENCE_FIELDS)[number], boolean>> = {
      item: listed.item !== purchase.item,
      amount: listed.amount_minor !== purchase.amount_minor,
      currency: listed.currency !== purchase.currency,
      status: listed.status !== purchase.status,
    };
    const differences = DIFFERENCE_FIELDS.filter((field) => differing[field]).map(String);
    return { receipt_id: purchase.receipt_id, on_game_server: true, differences };
  });
}

function validReceipt(raw: WireReceipt): GameReceipt | null {
  if (typeof raw?.receipt_id !== 'string' || typeof raw.item !== 'string' || typeof raw.currency !== 'string') return null;
  if (typeof raw.amount_minor !== 'number' || !Number.isInteger(raw.amount_minor)) return null;
  if (typeof raw.purchased_at !== 'string') return null;
  const status = raw.status;
  if (status !== 'paid' && status !== 'partly_refunded' && status !== 'refunded') return null;
  return { receipt_id: raw.receipt_id, item: raw.item, amount_minor: raw.amount_minor, currency: raw.currency, purchased_at: raw.purchased_at, status };
}

export async function lookupReceipts(gameSlug: string, playerId: string, purchases: PurchaseView[]): Promise<LookupResult> {
  const base = `${loadConfig().wiremockUrl}/v1/games/${encodeURIComponent(gameSlug)}/players/${encodeURIComponent(playerId)}/receipts`;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 3000);
  const collected: GameReceipt[] = [];
  const asked = new Set<string>();
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const url = cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
      let response: Response;
      try {
        response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      } catch {
        return unavailable(purchases);
      }
      if (response.status === 404) {
        if (page > 0) return unavailable(purchases);
        return { available: true, receipts: [], purchases: purchases.map((purchase) => ({ receipt_id: purchase.receipt_id, on_game_server: false, differences: [] })) };
      }
      if (!response.ok) return unavailable(purchases);
      const text = await response.text();
      let body: { receipts?: unknown; next_cursor?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        return unavailable(purchases);
      }
      if (!Array.isArray(body.receipts)) return unavailable(purchases);
      const pageReceipts: GameReceipt[] = [];
      for (const raw of body.receipts) {
        const receipt = validReceipt(raw as WireReceipt);
        if (!receipt) return unavailable(purchases);
        pageReceipts.push(receipt);
      }
      collected.push(...pageReceipts);
      const next = body.next_cursor;
      if (next === undefined || next === null) break;
      if (typeof next !== 'string' || next === '') return unavailable(purchases);
      if (asked.has(next)) return unavailable(purchases);
      if (page === 4) return unavailable(purchases);
      asked.add(next);
      cursor = next;
    }
    return { available: true, receipts: collected, purchases: compareReceipts(collected, purchases) };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return unavailable(purchases);
    return unavailable(purchases);
  } finally {
    clearTimeout(deadline);
  }
}

function unavailable(purchases: PurchaseView[]): LookupResult {
  return { available: false, receipts: [], purchases: purchases.map((purchase) => ({ receipt_id: purchase.receipt_id, on_game_server: null, differences: [] })) };
}
