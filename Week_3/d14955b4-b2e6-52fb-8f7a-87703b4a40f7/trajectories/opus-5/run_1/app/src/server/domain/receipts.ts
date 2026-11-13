import { config, limits } from '../config';
import type { Purchase, PurchaseComparison, ServerReceipt } from '../../shared/types';

/** The one place the game-server receipt walk and comparison live. */

export interface LookupResult {
  available: boolean;
  receipts: ServerReceipt[];
}

const UNAVAILABLE: LookupResult = { available: false, receipts: [] };

function readReceipt(value: unknown): ServerReceipt | null {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.receipt_id !== 'string' ||
    typeof entry.item !== 'string' ||
    typeof entry.amount_minor !== 'number' ||
    !Number.isInteger(entry.amount_minor) ||
    typeof entry.currency !== 'string' ||
    typeof entry.purchased_at !== 'string' ||
    typeof entry.status !== 'string'
  ) {
    return null;
  }
  return {
    receipt_id: entry.receipt_id,
    item: entry.item,
    amount_minor: entry.amount_minor,
    currency: entry.currency,
    purchased_at: entry.purchased_at,
    status: entry.status,
  };
}

interface PageResult {
  kind: 'page' | 'missing' | 'unavailable';
  receipts: ServerReceipt[];
  nextCursor: string | null;
}

async function askPage(
  gameSlug: string,
  playerId: string,
  cursor: string | null,
  deadline: number,
): Promise<PageResult> {
  const base = `${config.wiremockUrl}/v1/games/${encodeURIComponent(gameSlug)}/players/${encodeURIComponent(playerId)}/receipts`;
  const url = cursor === null ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { kind: 'unavailable', receipts: [], nextCursor: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: 'missing', receipts: [], nextCursor: null };
    if (!response.ok) return { kind: 'unavailable', receipts: [], nextCursor: null };
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return { kind: 'unavailable', receipts: [], nextCursor: null };
    const payload = body as Record<string, unknown>;
    if (!Array.isArray(payload.receipts)) return { kind: 'unavailable', receipts: [], nextCursor: null };
    const receipts: ServerReceipt[] = [];
    for (const entry of payload.receipts) {
      const receipt = readReceipt(entry);
      if (!receipt) return { kind: 'unavailable', receipts: [], nextCursor: null };
      receipts.push(receipt);
    }
    const next = payload.next_cursor;
    if (next !== undefined && next !== null && typeof next !== 'string') {
      return { kind: 'unavailable', receipts: [], nextCursor: null };
    }
    return {
      kind: 'page',
      receipts,
      nextCursor: typeof next === 'string' && next !== '' ? next : null,
    };
  } catch {
    return { kind: 'unavailable', receipts: [], nextCursor: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Walks the game server's pages. The record is whole or unavailable, never partial. */
export async function lookupReceipts(gameSlug: string, playerId: string): Promise<LookupResult> {
  const deadline = Date.now() + limits.lookupTimeoutMs;
  const receipts: ServerReceipt[] = [];
  const asked = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < limits.maxReceiptPages; page += 1) {
    const result = await askPage(gameSlug, playerId, cursor, deadline);
    if (result.kind === 'unavailable') return UNAVAILABLE;
    if (result.kind === 'missing') {
      return page === 0 ? { available: true, receipts: [] } : UNAVAILABLE;
    }
    receipts.push(...result.receipts);
    if (result.nextCursor === null) return { available: true, receipts };
    if (asked.has(result.nextCursor)) return UNAVAILABLE;
    asked.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return UNAVAILABLE;
}

/** Compares each signed purchase field by field with the receipt of the same id. */
export function compareReceipts(
  purchases: readonly Purchase[],
  lookup: LookupResult,
): PurchaseComparison[] {
  return purchases.map((purchase) => {
    if (!lookup.available) {
      return { receipt_id: purchase.receipt_id, on_game_server: null, differences: [] };
    }
    const receipt = lookup.receipts.find((entry) => entry.receipt_id === purchase.receipt_id);
    if (!receipt) {
      return { receipt_id: purchase.receipt_id, on_game_server: false, differences: [] };
    }
    const differences: string[] = [];
    if (receipt.item !== purchase.item) differences.push('item');
    if (receipt.amount_minor !== purchase.amount_minor) differences.push('amount');
    if (receipt.currency !== purchase.currency) differences.push('currency');
    if (receipt.status !== purchase.status) differences.push('status');
    return { receipt_id: purchase.receipt_id, on_game_server: true, differences };
  });
}
