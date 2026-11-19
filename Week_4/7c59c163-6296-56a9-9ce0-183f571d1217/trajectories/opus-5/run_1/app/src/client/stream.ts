import { useEffect, useRef } from 'react';
import type { Balance, Book, Fill, Market, Order } from './api.js';

export interface Trade {
  price: number;
  quantity: number;
  at: string;
}

export interface Liquidation {
  position_id: string;
  market_id: string;
  mark_price: number;
}

export interface StreamHandlers {
  book?: (book: Book) => void;
  trade?: (trade: Trade) => void;
  market?: (market: Market) => void;
  balance?: (balance: Balance) => void;
  order?: (order: Order) => void;
  fill?: (fill: Fill) => void;
  liquidation?: (event: Liquidation) => void;
}

/**
 * The market detail listens to the server stream, so balances, books, rings and orders change in
 * place without a reload.
 */
export function useStream(marketId: string | null, handlers: StreamHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const path = marketId === null ? '/api/stream' : `/api/stream?market_id=${marketId}`;
    const source = new EventSource(path);
    const bind = <T>(event: string, pick: (current: StreamHandlers) => ((value: T) => void) | undefined): void => {
      source.addEventListener(event, (message) => {
        const handler = pick(latest.current);
        if (handler === undefined) return;
        handler(JSON.parse((message as MessageEvent<string>).data) as T);
      });
    };
    bind<Book>('book', (current) => current.book);
    bind<Trade>('trade', (current) => current.trade);
    bind<Market>('market', (current) => current.market);
    bind<Balance>('balance', (current) => current.balance);
    bind<Order>('order', (current) => current.order);
    bind<Fill>('fill', (current) => current.fill);
    bind<Liquidation>('liquidation', (current) => current.liquidation);
    return () => source.close();
  }, [marketId]);
}
