import type { Response } from 'express';
import type { PublicBoxState } from '../shared/types.js';

const listeners = new Set<Response>();

export function addShelfListener(res: Response): void {
  listeners.add(res);
  res.on('close', () => listeners.delete(res));
}

function broadcast(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const listener of listeners) {
    listener.write(frame);
  }
}

export function publishBoxState(number: number, state: PublicBoxState): void {
  broadcast('box', { number, state });
}

export function publishSales(salesPaused: boolean, salesOpen: boolean): void {
  broadcast('sales', { salesPaused, salesOpen });
}
