import type { BookSide, MarketKind, Outcome, OrderSide } from './types.js';

export const EVENT_SCALE = 100;

/**
 * One book per market. Pair buys are bids and sells are asks at their own price; on an event the
 * book is the YES scale, so a NO buy at q is an ask at 100 - q.
 */
export function bookPlacement(
  kind: MarketKind,
  side: OrderSide,
  outcome: Outcome | null,
  price: number,
): { book_side: BookSide; book_price: number } {
  if (kind === 'event') {
    return outcome === 'yes'
      ? { book_side: 'bid', book_price: price }
      : { book_side: 'ask', book_price: EVENT_SCALE - price };
  }
  return side === 'buy' ? { book_side: 'bid', book_price: price } : { book_side: 'ask', book_price: price };
}

/** What this member pays or receives per unit when a fill executes at book price `bookPrice`. */
export function memberPrice(kind: MarketKind, outcome: Outcome | null, bookPrice: number): number {
  if (kind === 'event' && outcome === 'no') return EVENT_SCALE - bookPrice;
  return bookPrice;
}

export function crosses(incoming: BookSide, incomingPrice: number, restingPrice: number): boolean {
  return incoming === 'bid' ? restingPrice <= incomingPrice : restingPrice >= incomingPrice;
}
