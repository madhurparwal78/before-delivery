import type { ServerResponse } from 'node:http';
import { FLAVOURS } from '../../shared/catalogue.js';
import { availableStock } from '../db/ledger.js';
import { followRealtime, getUser, publishStockLevel } from '../services/pocketbase.js';
import { firstName } from './reviews.js';

type LiveEvent =
  | { name: 'stock'; data: { flavour: string; stock_left: number } }
  | { name: 'review'; data: { flavour: string; review: unknown } };

const listeners = new Set<ServerResponse>();

export function addLiveListener(res: ServerResponse): void {
  listeners.add(res);
  res.on('close', () => listeners.delete(res));
}

function broadcast(event: LiveEvent): void {
  const frame = `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const listener of listeners) listener.write(frame);
}

/**
 * Pushes the ledger's current counts into PocketBase, which is the realtime feed
 * behind `GET /api/live`. A PocketBase outage only pauses the feed.
 */
export async function publishStockLevels(): Promise<void> {
  try {
    const available = await availableStock();
    for (const flavour of FLAVOURS) {
      await publishStockLevel(flavour.slug, available.get(flavour.slug) ?? 0);
    }
  } catch {
    /* the feed pauses while PocketBase is unreachable */
  }
}

export function startLiveFeed(): void {
  followRealtime((change) => {
    if (change.collection === 'stock_levels') {
      broadcast({
        name: 'stock',
        data: {
          flavour: String(change.record.flavour),
          stock_left: Number(change.record.stock_left ?? 0),
        },
      });
      return;
    }
    if (change.record.status !== 'approved') return;
    void getUser(String(change.record.user)).then((author) => {
      broadcast({
        name: 'review',
        data: {
          flavour: String(change.record.flavour),
          review: {
            id: String(change.record.id),
            rating: Number(change.record.rating),
            body: String(change.record.body),
            author_first_name: firstName(author?.name ?? ''),
            created_at: String(change.record.created),
          },
        },
      });
    });
  });

  const keepAlive = setInterval(() => {
    for (const listener of listeners) listener.write(': keep-alive\n\n');
  }, 20_000);
  keepAlive.unref();
}
